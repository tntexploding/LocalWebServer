import {randomUUID} from 'node:crypto';
import type {
  EventEnvelope,
  RuleConfig,
  ScheduledWorkflowStatus,
  WorkflowSchedule,
} from '@las/core';
import type {JsonFileStore} from '@las/storage';

const MAX_TIMER_DELAY_MS = 2_147_000_000;

interface ScheduledEntry extends ScheduledWorkflowStatus {
  timer: NodeJS.Timeout;
}

interface WorkflowSchedulerState {
  version: 1;
  lastTriggeredAt: Record<string, string>;
}

/** Schedules persisted clock-triggered workflows with explicit misfire rules. */
export class WorkflowScheduler {
  private readonly entries = new Map<string, ScheduledEntry>();
  private generation = 0;
  private state: WorkflowSchedulerState = emptyState();

  constructor(
    private readonly dispatch: (
      rule: RuleConfig,
      event: EventEnvelope,
    ) => Promise<void>,
    private readonly onError: (error: unknown, rule: RuleConfig) => void,
    private readonly stateStore?: JsonFileStore<WorkflowSchedulerState>,
    private readonly onStateError: (error: unknown) => void = () => undefined,
  ) {}

  async initialize(rules: RuleConfig[]): Promise<void> {
    if (this.stateStore) {
      try {
        this.state = normalizeState(await this.stateStore.load(emptyState()));
      } catch (error) {
        this.onStateError(error);
        this.state = emptyState();
      }
    }
    this.updateConfig(rules);
  }

  updateConfig(rules: RuleConfig[]): void {
    this.stop();
    const generation = ++this.generation;
    const ruleIds = new Set(rules.map(rule => rule.id));
    const before = Object.keys(this.state.lastTriggeredAt).length;
    this.state.lastTriggeredAt = Object.fromEntries(
      Object.entries(this.state.lastTriggeredAt).filter(([ruleId]) =>
        ruleIds.has(ruleId),
      ),
    );
    if (Object.keys(this.state.lastTriggeredAt).length !== before) {
      void this.persistState();
    }
    for (const rule of rules) {
      const schedule = scheduledTrigger(rule);
      if (!rule.enabled || !schedule) continue;
      this.arm(rule, schedule, generation);
    }
  }

  snapshot(): ScheduledWorkflowStatus[] {
    return [...this.entries.values()]
      .map(({ruleId, mode, nextRunAt, lastRunAt, timeZone}) => ({
        ruleId,
        mode,
        nextRunAt,
        lastRunAt,
        timeZone,
      }))
      .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt));
  }

  stop(): void {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
  }

  private arm(
    rule: RuleConfig,
    schedule: WorkflowSchedule,
    generation: number,
  ): void {
    const lastRunAt = this.state.lastTriggeredAt[rule.id];
    const now = new Date();
    const nextRun = nextWorkflowOccurrence(schedule, now, lastRunAt);
    if (!nextRun) return;
    const recovered =
      schedule.misfirePolicy === 'runOnce' &&
      nextRun.getTime() <= now.getTime();
    const delay = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(0, nextRun.getTime() - Date.now()),
    );
    const timer = setTimeout(() => {
      if (generation !== this.generation) return;
      if (nextRun.getTime() - Date.now() > 50) {
        this.arm(rule, schedule, generation);
        return;
      }
      this.entries.delete(rule.id);
      void this.fire(rule, schedule, generation, recovered);
    }, delay);
    timer.unref();
    this.entries.set(rule.id, {
      ruleId: rule.id,
      mode: schedule.mode,
      nextRunAt: nextRun.toISOString(),
      lastRunAt,
      timeZone:
        schedule.mode === 'daily'
          ? (schedule.timeZone ?? systemTimeZone())
          : undefined,
      timer,
    });
  }

  private async fire(
    rule: RuleConfig,
    schedule: WorkflowSchedule,
    generation: number,
    recovered: boolean,
  ): Promise<void> {
    const now = new Date();
    const triggeredAt = now.toISOString();
    this.state.lastTriggeredAt[rule.id] = triggeredAt;
    await this.persistState();
    const event: EventEnvelope = {
      id: randomUUID(),
      traceId: randomUUID(),
      time: triggeredAt,
      source: `timer.${rule.id}`,
      kind: 'timer.trigger',
      body: {ruleId: rule.id, schedule},
      meta: {
        triggerType: 'time',
        schedule,
        recovered,
      },
    };
    try {
      await this.dispatch(rule, event);
    } catch (error) {
      this.onError(error, rule);
    } finally {
      if (generation === this.generation && schedule.mode !== 'once') {
        this.arm(rule, schedule, generation);
      }
    }
  }

  private async persistState(): Promise<void> {
    if (!this.stateStore) return;
    try {
      await this.stateStore.save(this.state);
    } catch (error) {
      this.onStateError(error);
    }
  }
}

function scheduledTrigger(rule: RuleConfig): WorkflowSchedule | undefined {
  const workflow = rule.workflow;
  if (!workflow) return undefined;
  const start = workflow.nodes.find(node => node.id === workflow.startNodeId);
  return start?.type === 'trigger' && start.trigger.type === 'time'
    ? start.trigger.schedule
    : undefined;
}

/** Calculates the next occurrence, including optional restart catch-up. */
export function nextWorkflowOccurrence(
  schedule: WorkflowSchedule,
  now: Date,
  lastTriggeredAt?: string,
): Date | undefined {
  const last = lastTriggeredAt
    ? new Date(lastTriggeredAt).getTime()
    : undefined;
  if (schedule.mode === 'once') {
    const at = new Date(schedule.at);
    if (last !== undefined && last >= at.getTime()) return undefined;
    if (at.getTime() > now.getTime()) return at;
    return schedule.misfirePolicy === 'runOnce' ? new Date(now) : undefined;
  }
  if (schedule.mode === 'interval') {
    const start = schedule.startAt
      ? new Date(schedule.startAt).getTime()
      : undefined;
    if (start === undefined && last === undefined) {
      return new Date(now.getTime() + schedule.everyMs);
    }
    const origin = start ?? last ?? now.getTime();
    const candidate = (last ?? origin - schedule.everyMs) + schedule.everyMs;
    if (candidate > now.getTime()) return new Date(candidate);
    if (schedule.misfirePolicy === 'runOnce') return new Date(now);
    const elapsed = now.getTime() - origin;
    return new Date(
      origin + (Math.floor(elapsed / schedule.everyMs) + 1) * schedule.everyMs,
    );
  }

  const timeZone = schedule.timeZone;
  const latest = dailyOccurrence(schedule.time, now, timeZone, 'latest');
  if (
    schedule.misfirePolicy === 'runOnce' &&
    latest &&
    (last === undefined || last < latest.getTime())
  ) {
    return new Date(now);
  }
  return dailyOccurrence(schedule.time, now, timeZone, 'next');
}

function dailyOccurrence(
  time: string,
  now: Date,
  timeZone: string | undefined,
  direction: 'latest' | 'next',
): Date | undefined {
  if (!timeZone) return localDailyOccurrence(time, now, direction);
  const [hours, minutes, seconds = 0] = time.split(':').map(Number);
  const today = zonedParts(now, timeZone);
  const offsets =
    direction === 'next'
      ? Array.from({length: 8}, (_, index) => index)
      : Array.from({length: 8}, (_, index) => -index);
  for (const offset of offsets) {
    const date = addCalendarDays(today, offset);
    const candidate = zonedDateToInstant(
      {...date, hours, minutes, seconds},
      timeZone,
    );
    if (!candidate) continue;
    if (direction === 'next' && candidate.getTime() > now.getTime()) {
      return candidate;
    }
    if (direction === 'latest' && candidate.getTime() <= now.getTime()) {
      return candidate;
    }
  }
  return undefined;
}

function localDailyOccurrence(
  time: string,
  now: Date,
  direction: 'latest' | 'next',
): Date {
  const [hours, minutes, seconds = 0] = time.split(':').map(Number);
  const candidate = new Date(now);
  candidate.setHours(hours, minutes, seconds, 0);
  if (direction === 'next' && candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  if (direction === 'latest' && candidate.getTime() > now.getTime()) {
    candidate.setDate(candidate.getDate() - 1);
  }
  return candidate;
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function zonedParts(date: Date, timeZone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hours: value('hour'),
    minutes: value('minute'),
    seconds: value('second'),
  };
}

function zonedDateToInstant(
  target: ZonedDateParts,
  timeZone: string,
): Date | undefined {
  const targetValue = partsUtcValue(target);
  let guess = targetValue;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const difference = targetValue - partsUtcValue(actual);
    if (difference === 0) break;
    guess += difference;
  }
  const resolved = new Date(guess);
  return sameParts(zonedParts(resolved, timeZone), target)
    ? resolved
    : undefined;
}

function addCalendarDays(
  value: ZonedDateParts,
  offset: number,
): ZonedDateParts {
  const date = new Date(
    Date.UTC(value.year, value.month - 1, value.day + offset),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hours: value.hours,
    minutes: value.minutes,
    seconds: value.seconds,
  };
}

function partsUtcValue(value: ZonedDateParts): number {
  return Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hours,
    value.minutes,
    value.seconds,
  );
}

function sameParts(left: ZonedDateParts, right: ZonedDateParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hours === right.hours &&
    left.minutes === right.minutes &&
    left.seconds === right.seconds
  );
}

function normalizeState(value: WorkflowSchedulerState): WorkflowSchedulerState {
  if (
    value?.version !== 1 ||
    !value.lastTriggeredAt ||
    typeof value.lastTriggeredAt !== 'object'
  ) {
    return emptyState();
  }
  return {
    version: 1,
    lastTriggeredAt: Object.fromEntries(
      Object.entries(value.lastTriggeredAt).filter(
        ([, timestamp]) =>
          typeof timestamp === 'string' &&
          Number.isFinite(new Date(timestamp).getTime()),
      ),
    ),
  };
}

function emptyState(): WorkflowSchedulerState {
  return {version: 1, lastTriggeredAt: {}};
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
