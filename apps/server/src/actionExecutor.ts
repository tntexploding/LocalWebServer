import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execa} from 'execa';
import {
  actionConfigSchema,
  resolveWorkflowExpressions,
  type ActionConfig,
  type ActionRetryPolicy,
  type ActionResult,
  type AppConfig,
  type EventEnvelope,
  type SendWsActionConfig,
  type WorkflowExpressionContext,
} from '@las/core';
import type {MessageTemplateDecoder} from './messageTemplateDecoder.js';
import type {EventWaitBroker} from './eventWaitBroker.js';
import type {InteractionBroker} from './interactionBroker.js';

/** Sends a payload through a configured WebSocket target. */
export type WsSender = (
  target: string,
  payload: unknown,
  options?: {timeoutMs?: number; signal?: AbortSignal},
) => void | Promise<void>;

/** Executes validated command, HTTP, and WebSocket actions. */
export class ActionExecutor {
  private readonly running = new Set<string>();

  constructor(
    private readonly appConfig: AppConfig,
    private readonly sendWs: WsSender,
    private readonly messageTemplates: MessageTemplateDecoder,
    private readonly interactions: InteractionBroker,
    private readonly eventWaits: EventWaitBroker,
  ) {}

  async execute(
    action: ActionConfig,
    event: EventEnvelope,
    signal?: AbortSignal,
    context?: WorkflowExpressionContext,
  ): Promise<ActionResult> {
    const startedAt = new Date();
    const started = startedAt.toISOString();
    let executable = action;

    try {
      executable = this.resolveAction(action, event, context);
      const result = await this.runAction(executable, event, signal);
      const finishedAt = new Date();
      return {
        id: randomUUID(),
        traceId: event.traceId,
        actionId: executable.id,
        actionType: executable.type,
        target: actionTarget(executable),
        status: 'completed',
        ok: true,
        eventId: event.id,
        startedAt: started,
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        output: result.output,
        detail: result.detail,
        attempts: result.attempts,
      };
    } catch (error) {
      const finishedAt = new Date();
      const executionError = error as {
        shortMessage?: string;
        exitCode?: number;
        detail?: Record<string, unknown>;
        attempts?: number;
      };
      return {
        id: randomUUID(),
        traceId: event.traceId,
        actionId: executable.id,
        actionType: executable.type,
        target: actionTarget(executable),
        status: signal?.aborted ? 'cancelled' : 'failed',
        ok: false,
        eventId: event.id,
        startedAt: started,
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: executionError.shortMessage ?? (error as Error).message,
        exitCode: executionError.exitCode,
        detail: executionError.detail,
        attempts: executionError.attempts,
      };
    }
  }

  private resolveAction(
    action: ActionConfig,
    event: EventEnvelope,
    context?: WorkflowExpressionContext,
  ): ActionConfig {
    const expressionContext = context ?? standaloneContext(action, event);
    const resolved = resolveWorkflowExpressions(action, expressionContext, {
      onMissing: action.expressionPolicy ?? 'error',
    });
    return actionConfigSchema.parse(resolved);
  }

  private async runAction(
    action: ActionConfig,
    event: EventEnvelope,
    signal?: AbortSignal,
  ): Promise<{
    output: string;
    detail: Record<string, unknown>;
    attempts?: number;
  }> {
    signal?.throwIfAborted();

    if (action.type === 'command' || action.type === 'script') {
      const allowConcurrent =
        action.type === 'command' ? action.allowConcurrent : false;
      if (this.running.has(action.id) && allowConcurrent === false) {
        throw new Error(`Action "${action.id}" is already running.`);
      }

      this.assertAllowedCwd(action.cwd);
      this.running.add(action.id);
      try {
        const command =
          action.type === 'command' ? action.command : action.interpreter;
        const args =
          action.type === 'command'
            ? (action.args ?? [])
            : [action.script, ...(action.args ?? [])];
        const result = await execa(command, args, {
          cwd: action.cwd,
          shell: this.appConfig.security.allowShell,
          timeout: action.timeoutMs ?? 30000,
          cancelSignal: signal,
          env: {
            LAS_EVENT_ID: event.id,
            LAS_EVENT_SOURCE: event.source,
            LAS_EVENT_KIND: event.kind,
          },
        });
        return {
          output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
          detail: {
            direction: 'local',
            protocol: action.type,
            cwd: action.cwd,
            command,
            args,
          },
        };
      } finally {
        this.running.delete(action.id);
      }
    }

    if (action.type === 'notification') {
      const interaction = this.interactions.notify(
        action.title,
        action.message,
      );
      return {
        output: 'Notification queued for the local WebUI.',
        detail: {
          direction: 'local',
          interactionId: interaction.id,
          interactionType: 'notification',
        },
      };
    }

    if (action.type === 'prompt') {
      const choice = await this.interactions.prompt({
        title: action.title,
        message: action.message,
        options: action.options,
        timeoutMs: action.timeoutMs ?? 300000,
        signal,
      });
      return {
        output: choice,
        detail: {
          direction: 'local',
          choice,
          interactionType: 'prompt',
        },
      };
    }

    if (action.type === 'wait_event') {
      const received = await this.eventWaits.wait(
        action,
        action.timeoutMs ?? 300000,
        signal,
      );
      return {
        output: `Received matching event ${received.id}.`,
        detail: {
          direction: 'inbound',
          eventId: received.id,
          source: received.source,
          kind: received.kind,
          receivedEvent: received,
        },
      };
    }

    if (action.type === 'send_http') {
      const requestBody = action.template
        ? await this.messageTemplates.materialize(
            action.template,
            action.templateValues ?? {},
          )
        : action.body;
      const headers: Record<string, string> = {
        ...action.headers,
        'x-las-trace-id': event.traceId,
      };
      if (action.idempotencyKey && !hasHeader(headers, 'idempotency-key')) {
        headers['idempotency-key'] = action.idempotencyKey;
      }
      if (
        requestBody !== undefined &&
        action.method !== 'GET' &&
        !hasHeader(headers, 'content-type')
      ) {
        headers['content-type'] = 'application/json';
      }
      const attempted = await runWithRetry(
        action.retry,
        signal,
        async attempt => {
          const response = await fetchWithTimeout(
            action.url,
            {
              method: action.method,
              headers,
              body:
                requestBody === undefined || action.method === 'GET'
                  ? undefined
                  : JSON.stringify(requestBody),
            },
            action.timeoutMs ?? 15000,
            signal,
          );
          const responseBody = (await response.text()).slice(0, 2000);
          const detail = {
            direction: 'outbound',
            protocol: 'http',
            method: action.method,
            url: action.url,
            requestBody,
            template: action.template,
            statusCode: response.status,
            responseBody,
            attempt,
          };
          if (!response.ok) {
            throw new HttpActionError(
              `HTTP ${response.status} ${response.statusText}`,
              detail,
              isRetryableHttpStatus(response.status),
            );
          }
          return {
            output: `HTTP ${response.status} ${response.statusText}`,
            detail,
          };
        },
      );
      return {...attempted.value, attempts: attempted.attempts};
    }

    const attempted = await runWithRetry(
      action.retry,
      signal,
      async attempt => {
        await this.sendWs(action.target, buildWsPayload(action, event), {
          timeoutMs: action.timeoutMs ?? 10000,
          signal,
        });
        return {
          output: `Sent WebSocket message to ${action.target}`,
          detail: {
            direction: 'outbound',
            protocol: 'ws',
            target: action.target,
            body: action.body,
            attempt,
          },
        };
      },
    );
    return {
      ...attempted.value,
      attempts: attempted.attempts,
    };
  }

  private assertAllowedCwd(cwd: string): void {
    const normalizedCwd = path.resolve(cwd).toLowerCase();
    const roots = this.appConfig.security.allowedCommandRoots.map(root =>
      path.resolve(root).toLowerCase(),
    );

    if (
      !roots.some(
        root =>
          normalizedCwd === root ||
          normalizedCwd.startsWith(`${root}${path.sep}`),
      )
    ) {
      throw new Error(`Command cwd is outside allowed roots: ${cwd}`);
    }
  }
}

class HttpActionError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown>,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'HttpActionError';
  }
}

class ActionTimeoutError extends Error {
  readonly retryable = true;

  constructor(timeoutMs: number) {
    super(`Action timed out after ${timeoutMs}ms.`);
    this.name = 'ActionTimeoutError';
  }
}

interface RetryError extends Error {
  retryable?: boolean;
  attempts?: number;
}

async function runWithRetry<T>(
  policy: ActionRetryPolicy | undefined,
  signal: AbortSignal | undefined,
  operation: (attempt: number) => Promise<T>,
): Promise<{value: T; attempts: number}> {
  const maxAttempts = policy?.maxAttempts ?? 1;
  let delayMs = policy?.initialDelayMs ?? 500;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return {value: await operation(attempt), attempts: attempt};
    } catch (error) {
      const retryError = normalizeRetryError(error);
      retryError.attempts = attempt;
      if (
        signal?.aborted ||
        retryError.retryable === false ||
        attempt >= maxAttempts
      ) {
        throw retryError;
      }
      await abortableDelay(delayMs, signal);
      delayMs = Math.min(
        policy?.maxDelayMs ?? 30000,
        Math.max(0, delayMs * (policy?.backoffMultiplier ?? 2)),
      );
    }
  }
  throw new Error('Retry loop finished unexpectedly.');
}

function normalizeRetryError(error: unknown): RetryError {
  const retryError =
    error instanceof Error
      ? error
      : new Error(String(error ?? 'Unknown error'));
  const tagged = retryError as RetryError;
  if (tagged.retryable === undefined) tagged.retryable = true;
  return tagged;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, {...init, signal: controller.signal});
  } catch (error) {
    if (timedOut) throw new ActionTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(abortReason(signal?.reason));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
  });
}

function abortReason(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error(typeof reason === 'string' ? reason : 'Action cancelled.');
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function hasHeader(
  headers: Record<string, string>,
  headerName: string,
): boolean {
  return Object.keys(headers).some(name => name.toLowerCase() === headerName);
}

function actionTarget(action: ActionConfig): string {
  if (action.type === 'send_http') return action.url;
  if (action.type === 'send_ws') return action.target;
  if (action.type === 'command' || action.type === 'script') return action.cwd;
  if (action.type === 'wait_event') return action.source ?? '*';
  return action.title;
}

function buildWsPayload(
  action: SendWsActionConfig,
  event: EventEnvelope,
): unknown {
  return {
    type: 'action.message',
    actionId: action.id,
    eventId: event.id,
    traceId: event.traceId,
    body: action.body,
  };
}

function standaloneContext(
  action: ActionConfig,
  event: EventEnvelope,
): WorkflowExpressionContext {
  return {
    trigger: event,
    inputs: {},
    nodes: {},
    last: {},
    workflow: {
      id: `manual:${action.id}`,
      runId: event.id,
      traceId: event.traceId,
      startedAt: new Date().toISOString(),
    },
  };
}
