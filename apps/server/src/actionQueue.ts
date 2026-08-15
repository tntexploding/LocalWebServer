import {randomUUID} from 'node:crypto';
import type {
  ActionConfig,
  ActionResult,
  EventEnvelope,
  WorkflowExpressionContext,
} from '@las/core';
import type {JsonlStore} from '@las/storage';
import {safeNetworkTarget} from './networkPolicy.js';
import type {ActionExecutor} from './actionExecutor.js';

interface QueueItem {
  run: ActionResult;
  action: ActionConfig;
  event: EventEnvelope;
  context?: WorkflowExpressionContext;
}

type RunningItem = QueueItem & {
  controller: AbortController;
};

/** Limits concurrent action execution and persists lifecycle transitions. */
export class ActionQueue {
  private readonly queued: QueueItem[] = [];
  private readonly running = new Map<string, RunningItem>();
  private readonly recent = new Map<string, ActionResult>();
  private readonly waiters = new Map<string, (result: ActionResult) => void>();

  constructor(
    private maxConcurrent: number,
    private readonly executor: ActionExecutor,
    private readonly runLog: JsonlStore<ActionResult>,
    private readonly onPersistenceError: (error: unknown) => void = () =>
      undefined,
    private readonly sanitizeResult: (
      result: ActionResult,
    ) => ActionResult = result => result,
  ) {}

  setMaxConcurrent(value: number): void {
    this.maxConcurrent = value;
    void this.drain();
  }

  enqueue(input: {
    action: ActionConfig;
    event: EventEnvelope;
    ruleId?: string;
    workflowRunId?: string;
    workflowNodeId?: string;
    context?: WorkflowExpressionContext;
  }): ActionResult {
    const run = this.queue(input);
    void this.drain();
    return run;
  }

  async enqueueAndWait(input: {
    action: ActionConfig;
    event: EventEnvelope;
    ruleId?: string;
    workflowRunId?: string;
    workflowNodeId?: string;
    context?: WorkflowExpressionContext;
    onQueued?: (run: ActionResult) => void;
    signal?: AbortSignal;
  }): Promise<ActionResult> {
    input.signal?.throwIfAborted();
    const run = this.queue(input);
    input.onQueued?.(run);
    return new Promise(resolve => {
      const abort = () => void this.cancel(run.id);
      this.waiters.set(run.id, result => {
        input.signal?.removeEventListener('abort', abort);
        resolve(result);
      });
      input.signal?.addEventListener('abort', abort, {once: true});
      if (input.signal?.aborted) abort();
      void this.drain();
    });
  }

  private queue(input: {
    action: ActionConfig;
    event: EventEnvelope;
    ruleId?: string;
    workflowRunId?: string;
    workflowNodeId?: string;
    context?: WorkflowExpressionContext;
  }): ActionResult {
    const run = this.sanitizeResult({
      id: randomUUID(),
      traceId: input.event.traceId,
      actionId: input.action.id,
      actionType: input.action.type,
      target: actionTarget(input.action),
      eventId: input.event.id,
      ruleId: input.ruleId,
      workflowRunId: input.workflowRunId,
      workflowNodeId: input.workflowNodeId,
      status: 'queued',
      queuedAt: new Date().toISOString(),
    });
    this.queued.push({
      run,
      action: input.action,
      event: input.event,
      context: input.context,
    });
    this.recent.set(run.id, run);
    return run;
  }

  async cancel(runId: string): Promise<ActionResult | undefined> {
    const queuedIndex = this.queued.findIndex(item => item.run.id === runId);
    if (queuedIndex >= 0) {
      const [item] = this.queued.splice(queuedIndex, 1);
      const cancelled = finalizeRun(item.run, {
        status: 'cancelled',
        ok: false,
        error: 'Cancelled before execution.',
      });
      const visible = this.sanitizeResult(cancelled);
      this.recent.set(runId, visible);
      await this.persistRun(cancelled);
      this.resolveWaiter(cancelled);
      return visible;
    }

    const running = this.running.get(runId);
    if (running) {
      running.controller.abort('Cancelled by user.');
      return this.recent.get(runId);
    }

    return this.recent.get(runId);
  }

  status(): ActionResult[] {
    return [...this.queued.map(item => item.run), ...this.running.values()].map(
      item => ('run' in item ? item.run : item),
    );
  }

  snapshot(): {
    maxConcurrent: number;
    queued: ActionResult[];
    running: ActionResult[];
    recent: ActionResult[];
  } {
    return {
      maxConcurrent: this.maxConcurrent,
      queued: this.queued.map(item => item.run),
      running: [...this.running.values()].map(item => item.run),
      recent: [...this.recent.values()].slice(-50).reverse(),
    };
  }

  private async drain(): Promise<void> {
    while (this.running.size < this.maxConcurrent && this.queued.length > 0) {
      const item = this.queued.shift();
      if (!item) {
        return;
      }

      const controller = new AbortController();
      const runningRun: ActionResult = {
        ...item.run,
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      const running: RunningItem = {...item, run: runningRun, controller};
      this.running.set(item.run.id, running);
      this.recent.set(item.run.id, runningRun);
      void this.execute(running);
    }
  }

  private async execute(item: RunningItem): Promise<void> {
    let result: ActionResult;
    try {
      result = await this.executor.execute(
        item.action,
        item.event,
        item.controller.signal,
        item.context,
      );
    } catch (error) {
      result = {
        ...item.run,
        status: item.controller.signal.aborted ? 'cancelled' : 'failed',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const finished = finalizeRun(item.run, {
      ...result,
      id: item.run.id,
      actionId: item.run.actionId,
      eventId: item.run.eventId,
      ruleId: item.run.ruleId,
      workflowRunId: item.run.workflowRunId,
      workflowNodeId: item.run.workflowNodeId,
      queuedAt: item.run.queuedAt,
      startedAt: item.run.startedAt ?? result.startedAt,
    });
    this.running.delete(item.run.id);
    this.recent.set(item.run.id, this.sanitizeResult(finished));
    await this.persistRun(finished);
    this.resolveWaiter(finished);
    await this.drain();
  }

  private async persistRun(result: ActionResult): Promise<void> {
    try {
      await this.runLog.append(this.sanitizeResult(result));
    } catch (error) {
      try {
        this.onPersistenceError(error);
      } catch {
        // A diagnostic callback must not stop queue progress.
      }
    }
  }

  private resolveWaiter(result: ActionResult): void {
    this.waiters.get(result.id)?.(result);
    this.waiters.delete(result.id);
  }
}

/** Creates a failed result for an action that could not be queued. */
export function failedRun(
  actionId: string,
  eventId?: string,
  traceId?: string,
  error?: string,
): ActionResult {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    traceId,
    actionId,
    eventId,
    status: 'failed',
    ok: false,
    queuedAt: now,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    error,
  };
}

function actionTarget(action: ActionConfig): string {
  if (action.type === 'send_http') return safeNetworkTarget(action.url);
  if (action.type === 'send_ws') {
    return /^wss?:\/\//u.test(action.target)
      ? safeNetworkTarget(action.target)
      : action.target;
  }
  if (action.type === 'command' || action.type === 'script') return action.cwd;
  if (action.type === 'wait_event') return action.source ?? '*';
  return action.title;
}

function finalizeRun(
  base: ActionResult,
  patch: Partial<ActionResult>,
): ActionResult {
  const finishedAt = patch.finishedAt ?? new Date().toISOString();
  const startedAt = patch.startedAt ?? base.startedAt ?? finishedAt;
  return {
    ...base,
    ...patch,
    status: patch.status ?? base.status,
    startedAt,
    finishedAt,
    durationMs:
      patch.durationMs ??
      new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  };
}
