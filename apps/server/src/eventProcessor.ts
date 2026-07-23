import {randomUUID} from 'node:crypto';
import {
  explainRuleMatch,
  type ActionConfig,
  type ActionResult,
  type EventEnvelope,
  type RuleConfig,
} from '@las/core';
import type {JsonlStore} from '@las/storage';
import {ActionQueue, failedRun} from './actionQueue.js';
import type {WorkflowExecutor} from './workflowExecutor.js';

/** Persists events, evaluates rules, and queues matching actions. */
export class EventProcessor {
  private rules: RuleConfig[] = [];
  private actions = new Map<string, ActionConfig>();

  constructor(
    private readonly events: JsonlStore<EventEnvelope>,
    private readonly runs: JsonlStore<ActionResult>,
    private readonly queue: ActionQueue,
    private readonly workflows: WorkflowExecutor,
    private readonly sanitizeEvent: (
      event: EventEnvelope,
    ) => EventEnvelope = event => event,
    private readonly sanitizeResult: (
      result: ActionResult,
    ) => ActionResult = result => result,
  ) {}

  updateConfig(rules: RuleConfig[], actions: ActionConfig[]): void {
    this.rules = rules;
    this.actions = new Map(actions.map(action => [action.id, action]));
  }

  async receive(event: EventEnvelope): Promise<ActionResult[]> {
    const evaluations = this.rules.map(rule => {
      const checks = explainRuleMatch(event, rule);
      return {
        ruleId: rule.id,
        matched: checks.every(check => check.matched),
        actions: ruleActionIds(rule),
        checks,
      };
    });
    event.meta = {...event.meta, ruleEvaluations: evaluations};
    await this.events.append(this.sanitizeEvent(event));
    this.workflows.acceptEvent(event);
    const results: ActionResult[] = [];

    for (const [index, rule] of this.rules.entries()) {
      if (!evaluations[index]?.matched) {
        continue;
      }

      if (rule.workflow) {
        results.push(this.workflows.start(rule, event));
        continue;
      }

      for (const step of rule.then ?? []) {
        const action = this.actions.get(step.action);
        if (!action) {
          const missing = failedRun(
            step.action,
            event.id,
            event.traceId,
            `Action "${step.action}" is not defined.`,
          );
          await this.runs.append(this.sanitizeResult(missing));
          results.push(missing);
          continue;
        }

        const result = this.queue.enqueue({action, event, ruleId: rule.id});
        results.push(result);
      }
    }

    return results;
  }

  async triggerWorkflow(
    rule: RuleConfig,
    event: EventEnvelope,
  ): Promise<ActionResult> {
    if (!rule.enabled || !rule.workflow) {
      throw new Error(`Rule "${rule.id}" is not an enabled workflow.`);
    }
    event.meta = {
      ...event.meta,
      scheduledRuleId: rule.id,
      ruleEvaluations: [
        {
          ruleId: rule.id,
          matched: true,
          actions: ruleActionIds(rule),
          checks: [
            {
              field: 'trigger',
              matched: true,
              expected: 'time',
              actual: 'time',
            },
          ],
        },
      ],
    };
    await this.events.append(this.sanitizeEvent(event));
    this.workflows.acceptEvent(event);
    return this.workflows.start(rule, event);
  }

  async runAction(
    actionId: string,
    event: EventEnvelope,
  ): Promise<ActionResult> {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new Error(`Unknown action: ${actionId}`);
    }

    return this.queue.enqueue({action, event});
  }

  testEvent(event: EventEnvelope): Array<{
    ruleId: string;
    matched: boolean;
    actions: string[];
    description?: string;
    checks: ReturnType<typeof explainRuleMatch>;
  }> {
    return this.rules.map(rule => {
      const checks = explainRuleMatch(event, rule);
      return {
        ruleId: rule.id,
        matched: checks.every(check => check.matched),
        actions: ruleActionIds(rule),
        description: rule.description,
        checks,
      };
    });
  }
}

function ruleActionIds(rule: RuleConfig): string[] {
  if (!rule.workflow) return (rule.then ?? []).map(step => step.action);
  return rule.workflow.nodes
    .filter(node => node.type === 'action')
    .map(node =>
      node.type === 'action' && node.action.type === 'reference'
        ? node.action.actionId
        : node.id,
    );
}

/** Creates a normalized event envelope with generated identifiers. */
export function makeEvent(input: {
  source: string;
  kind: EventEnvelope['kind'];
  traceId?: string;
  body?: unknown;
  meta?: EventEnvelope['meta'];
}): EventEnvelope {
  return {
    id: randomUUID(),
    traceId: input.traceId ?? randomUUID(),
    time: new Date().toISOString(),
    source: input.source,
    kind: input.kind,
    body: input.body,
    meta: input.meta ?? {},
  };
}
