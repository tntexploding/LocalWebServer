import {JSONPath} from 'jsonpath-plus';
import type {
  EventEnvelope,
  MatchCondition,
  MatchConfig,
  RuleConfig,
  WorkflowEventFilter,
  WorkflowTrigger,
} from './types.js';

/** One explainable check performed while evaluating a rule. */
export interface RuleMatchCheck {
  field:
    | 'enabled'
    | 'trigger'
    | 'source'
    | 'kind'
    | 'template'
    | 'equals'
    | 'contains'
    | 'regex';
  matched: boolean;
  expected?: unknown;
  actual?: unknown;
  path?: string;
}

/** Returns whether every check for a rule matches an event. */
export function eventMatchesRule(
  event: EventEnvelope,
  rule: RuleConfig,
): boolean {
  return explainRuleMatch(event, rule).every(check => check.matched);
}

/** Returns the individual checks used to evaluate a rule. */
export function explainRuleMatch(
  event: EventEnvelope,
  rule: RuleConfig,
): RuleMatchCheck[] {
  const checks: RuleMatchCheck[] = [
    {
      field: 'enabled',
      matched: rule.enabled,
      expected: true,
      actual: rule.enabled,
    },
  ];
  if (!rule.enabled) return checks;

  const workflowStart = workflowTrigger(rule);
  if (!rule.when && workflowStart?.type === 'time') {
    checks.push({
      field: 'trigger',
      matched: false,
      expected: 'event',
      actual: 'time',
    });
    return checks;
  }
  const when: WorkflowEventFilter | undefined =
    rule.when ??
    (workflowStart?.type === 'event' ? workflowStart.event : undefined);
  if (!when) return checks;

  if (!when.anySource && when.source) {
    checks.push({
      field: 'source',
      matched: event.source === when.source,
      expected: when.source,
      actual: event.source,
    });
  }
  if (when.kind) {
    checks.push({
      field: 'kind',
      matched: event.kind === when.kind,
      expected: when.kind,
      actual: event.kind,
    });
  }
  if (when.template) {
    const actualTemplate = firstJsonPathValue(event, '$.meta.decoded.template');
    checks.push({
      field: 'template',
      matched: actualTemplate === when.template,
      expected: when.template,
      actual: actualTemplate,
      path: '$.meta.decoded.template',
    });
  }

  const match = when.match;
  if (!match) return checks;
  checks.push(...explainMatchConfig(event, match));
  return checks;
}

function workflowTrigger(rule: RuleConfig): WorkflowTrigger | undefined {
  if (!rule.workflow) return undefined;
  const node = rule.workflow.nodes.find(
    item => item.id === rule.workflow?.startNodeId && item.type === 'trigger',
  );
  return node?.type === 'trigger' ? node.trigger : undefined;
}

/** Returns whether an event satisfies a standalone match configuration. */
export function matchesConfig(
  event: EventEnvelope,
  match: MatchConfig,
): boolean {
  return explainMatchConfig(event, match).every(check => check.matched);
}

function explainMatchConfig(
  event: EventEnvelope,
  match: MatchConfig,
): RuleMatchCheck[] {
  const conditions = [
    ...(hasMatchOperator(match) ? [match] : []),
    ...(match.all ?? []),
  ];

  return conditions.flatMap(condition =>
    explainMatchCondition(event, condition),
  );
}

function explainMatchCondition(
  event: EventEnvelope,
  condition: MatchCondition,
): RuleMatchCheck[] {
  const checks: RuleMatchCheck[] = [];
  const value = condition.jsonPath
    ? firstJsonPathValue(event, condition.jsonPath)
    : event.body;
  if (Object.hasOwn(condition, 'equals')) {
    checks.push({
      field: 'equals',
      matched: deepEqual(value, condition.equals),
      expected: condition.equals,
      actual: value,
      path: condition.jsonPath,
    });
  }
  if (condition.contains) {
    checks.push({
      field: 'contains',
      matched: String(value ?? '').includes(condition.contains),
      expected: condition.contains,
      actual: value,
      path: condition.jsonPath,
    });
  }
  if (condition.regex) {
    checks.push({
      field: 'regex',
      matched: new RegExp(condition.regex).test(String(value ?? '')),
      expected: condition.regex,
      actual: value,
      path: condition.jsonPath,
    });
  }

  return checks;
}

function hasMatchOperator(match: MatchCondition): boolean {
  return (
    Object.hasOwn(match, 'equals') ||
    Boolean(match.contains) ||
    Boolean(match.regex)
  );
}

/** Returns the first value selected by a JSONPath expression. */
export function firstJsonPathValue(source: unknown, path: string): unknown {
  const results = JSONPath({
    path,
    json: source as string | number | boolean | object | unknown[] | null,
  });
  return Array.isArray(results) ? results[0] : results;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
