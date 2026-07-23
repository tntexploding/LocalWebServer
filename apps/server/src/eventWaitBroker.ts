import {randomUUID} from 'node:crypto';
import {
  firstJsonPathValue,
  matchesConfig,
  type EventEnvelope,
  type WorkflowEventFilter,
} from '@las/core';

interface EventWaiter {
  filter: WorkflowEventFilter;
  resolve: (event: EventEnvelope) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abort?: () => void;
}

/** Resolves reusable action and workflow waits from the shared event stream. */
export class EventWaitBroker {
  private readonly waiters = new Map<string, EventWaiter>();

  accept(event: EventEnvelope): void {
    for (const [id, waiter] of this.waiters) {
      if (!matchesEventFilter(event, waiter.filter)) continue;
      this.finish(id);
      waiter.resolve(event);
    }
  }

  wait(
    filter: WorkflowEventFilter,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<EventEnvelope> {
    signal?.throwIfAborted();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.finish(id);
        reject(new Error(`Event wait timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      const abort = () => {
        this.finish(id);
        reject(new Error('Event wait was cancelled.'));
      };
      this.waiters.set(id, {
        filter,
        resolve,
        timer,
        signal,
        abort,
      });
      signal?.addEventListener('abort', abort, {once: true});
    });
  }

  private finish(id: string): void {
    const waiter = this.waiters.get(id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    if (waiter.abort && waiter.signal) {
      waiter.signal.removeEventListener('abort', waiter.abort);
    }
    this.waiters.delete(id);
  }
}

/** Returns whether an event satisfies an endpoint-event filter. */
export function matchesEventFilter(
  event: EventEnvelope,
  filter: WorkflowEventFilter,
): boolean {
  if (!filter.anySource && filter.source && event.source !== filter.source) {
    return false;
  }
  if (filter.kind && event.kind !== filter.kind) return false;
  if (
    filter.template &&
    firstJsonPathValue(event, '$.meta.decoded.template') !== filter.template
  ) {
    return false;
  }
  return !filter.match || matchesConfig(event, filter.match);
}
