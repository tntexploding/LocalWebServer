import {randomUUID} from 'node:crypto';
import type {ActionConfig, ActionResult, EventEnvelope} from '@las/core';
import type {JsonlStore} from '@las/storage';
import type {ActionExecutor} from './actionExecutor.js';

interface QueueItem {
  run: ActionResult;
  action: ActionConfig;
  event: EventEnvelope;
}

type RunningItem = QueueItem & {
  controller: AbortController;
};

/** Limits concurrent action execution and persists lifecycle transitions. */
export class ActionQueue {
  private readonly queued: QueueItem[] = [];
  private readonly running = new Map<string, RunningItem>();
  private readonly recent = new Map<string, ActionResult>();

  constructor(
    private maxConcurrent: number,
    private readonly executor: ActionExecutor,
    private readonly runLog: JsonlStore<ActionResult>,
  ) {}

  setMaxConcurrent(value: number): void {
    this.maxConcurrent = value;
    void this.drain();
  }

  enqueue(input: {
    action: ActionConfig;
    event: EventEnvelope;
    ruleId?: string;
  }): ActionResult {
    const run: ActionResult = {
      id: randomUUID(),
      traceId: input.event.traceId,
      actionId: input.action.id,
      actionType: input.action.type,
      target: actionTarget(input.action),
      eventId: input.event.id,
      ruleId: input.ruleId,
      status: 'queued',
      queuedAt: new Date().toISOString(),
    };
    this.queued.push({run, action: input.action, event: input.event});
    this.recent.set(run.id, run);
    void this.drain();
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
      this.recent.set(runId, cancelled);
      await this.runLog.append(cancelled);
      return cancelled;
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
    const result = await this.executor.execute(
      item.action,
      item.event,
      item.controller.signal,
    );
    const finished = finalizeRun(item.run, {
      ...result,
      id: item.run.id,
      actionId: item.run.actionId,
      eventId: item.run.eventId,
      ruleId: item.run.ruleId,
      queuedAt: item.run.queuedAt,
      startedAt: item.run.startedAt ?? result.startedAt,
    });
    this.running.delete(item.run.id);
    this.recent.set(item.run.id, finished);
    await this.runLog.append(finished);
    await this.drain();
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
  if (action.type === 'send_http') return action.url;
  if (action.type === 'send_ws') return action.target;
  return action.cwd;
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
