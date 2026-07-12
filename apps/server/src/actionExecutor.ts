import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execa} from 'execa';
import type {
  ActionConfig,
  ActionResult,
  AppConfig,
  EventEnvelope,
  SendWsActionConfig,
} from '@las/core';
import type {MessageTemplateDecoder} from './messageTemplateDecoder.js';

/** Sends a payload through a configured WebSocket target. */
export type WsSender = (
  target: string,
  payload: unknown,
) => void | Promise<void>;

/** Executes validated command, HTTP, and WebSocket actions. */
export class ActionExecutor {
  private readonly running = new Set<string>();

  constructor(
    private readonly appConfig: AppConfig,
    private readonly sendWs: WsSender,
    private readonly messageTemplates: MessageTemplateDecoder,
  ) {}

  async execute(
    action: ActionConfig,
    event: EventEnvelope,
    signal?: AbortSignal,
  ): Promise<ActionResult> {
    const startedAt = new Date();
    const started = startedAt.toISOString();

    try {
      const result = await this.runAction(action, event, signal);
      const finishedAt = new Date();
      return {
        id: randomUUID(),
        traceId: event.traceId,
        actionId: action.id,
        actionType: action.type,
        target: actionTarget(action),
        status: 'completed',
        ok: true,
        eventId: event.id,
        startedAt: started,
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        output: result.output,
        detail: result.detail,
      };
    } catch (error) {
      const finishedAt = new Date();
      const execaError = error as {shortMessage?: string; exitCode?: number};
      return {
        id: randomUUID(),
        traceId: event.traceId,
        actionId: action.id,
        actionType: action.type,
        target: actionTarget(action),
        status: signal?.aborted ? 'cancelled' : 'failed',
        ok: false,
        eventId: event.id,
        startedAt: started,
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: execaError.shortMessage ?? (error as Error).message,
        exitCode: execaError.exitCode,
      };
    }
  }

  private async runAction(
    action: ActionConfig,
    event: EventEnvelope,
    signal?: AbortSignal,
  ): Promise<{output: string; detail: Record<string, unknown>}> {
    signal?.throwIfAborted();

    if (action.type === 'command') {
      if (this.running.has(action.id) && action.allowConcurrent === false) {
        throw new Error(`Action "${action.id}" is already running.`);
      }

      this.assertAllowedCwd(action.cwd);
      this.running.add(action.id);
      try {
        const result = await execa(action.command, action.args ?? [], {
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
            protocol: 'command',
            cwd: action.cwd,
            command: action.command,
            args: action.args ?? [],
          },
        };
      } finally {
        this.running.delete(action.id);
      }
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
      if (
        requestBody !== undefined &&
        action.method !== 'GET' &&
        !hasHeader(headers, 'content-type')
      ) {
        headers['content-type'] = 'application/json';
      }
      const response = await fetch(action.url, {
        method: action.method,
        headers,
        signal,
        body:
          requestBody === undefined || action.method === 'GET'
            ? undefined
            : JSON.stringify(requestBody),
      });
      const responseBody = (await response.text()).slice(0, 2000);
      return {
        output: `HTTP ${response.status} ${response.statusText}`,
        detail: {
          direction: 'outbound',
          protocol: 'http',
          method: action.method,
          url: action.url,
          requestBody,
          template: action.template,
          statusCode: response.status,
          responseBody,
        },
      };
    }

    await this.sendWs(action.target, buildWsPayload(action, event));
    return {
      output: `Sent WebSocket message to ${action.target}`,
      detail: {
        direction: 'outbound',
        protocol: 'ws',
        target: action.target,
        body: action.body,
      },
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

function hasHeader(
  headers: Record<string, string>,
  headerName: string,
): boolean {
  return Object.keys(headers).some(name => name.toLowerCase() === headerName);
}

function actionTarget(action: ActionConfig): string {
  if (action.type === 'send_http') return action.url;
  if (action.type === 'send_ws') return action.target;
  return action.cwd;
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
