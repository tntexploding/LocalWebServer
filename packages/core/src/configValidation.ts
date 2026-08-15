import type {
  ConfigValidationIssue,
  EndpointsConfig,
  LoadedConfig,
  WorkflowEventFilter,
  WorkflowGraph,
} from './types.js';
import {containsWorkflowExpression} from './expressions.js';

/** Optional resources used for validation beyond the four YAML documents. */
export interface ConfigValidationOptions {
  templateIds?: ReadonlySet<string>;
}

/** Error returned when individually valid documents do not form a valid set. */
export class ConfigDependencyError extends Error {
  readonly statusCode = 400;

  constructor(readonly issues: ConfigValidationIssue[]) {
    super(issues.map(issue => issue.message).join('; '));
    this.name = 'ConfigDependencyError';
  }
}

/** Finds duplicate references, invalid routes, and unreachable workflow nodes. */
export function collectConfigValidationIssues(
  config: LoadedConfig,
  options: ConfigValidationOptions = {},
): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];
  validateUniqueIds(config, issues);
  validateEndpointRoutes(config, issues);
  validateReferences(config, options, issues);
  for (const [ruleIndex, rule] of config.rules.entries()) {
    if (rule.workflow) {
      validateWorkflowGraph(rule.workflow, ruleIndex, issues);
    }
  }
  return issues;
}

/** Throws a structured error when the complete configuration is inconsistent. */
export function assertValidConfigDependencies(
  config: LoadedConfig,
  options: ConfigValidationOptions = {},
): void {
  const issues = collectConfigValidationIssues(config, options);
  if (issues.length > 0) throw new ConfigDependencyError(issues);
}

function validateUniqueIds(
  config: LoadedConfig,
  issues: ConfigValidationIssue[],
): void {
  findDuplicates(
    config.actions.map((action, index) => ({
      id: action.id,
      path: `actions[${index}].id`,
    })),
    'action',
    issues,
  );
  findDuplicates(
    config.rules.map((rule, index) => ({
      id: rule.id,
      path: `rules[${index}].id`,
    })),
    'automation',
    issues,
  );
  findDuplicates(endpointIds(config.endpoints), 'endpoint', issues);
}

function endpointIds(
  endpoints: EndpointsConfig,
): Array<{id: string; path: string}> {
  return [
    ...endpoints.httpServers.map((endpoint, index) => ({
      id: endpoint.id,
      path: `endpoints.httpServers[${index}].id`,
    })),
    ...endpoints.wsServers.map((endpoint, index) => ({
      id: endpoint.id,
      path: `endpoints.wsServers[${index}].id`,
    })),
    ...endpoints.httpClients.map((endpoint, index) => ({
      id: endpoint.id,
      path: `endpoints.httpClients[${index}].id`,
    })),
    ...endpoints.wsClients.map((endpoint, index) => ({
      id: endpoint.id,
      path: `endpoints.wsClients[${index}].id`,
    })),
  ];
}

function findDuplicates(
  values: Array<{id: string; path: string}>,
  label: string,
  issues: ConfigValidationIssue[],
): void {
  const firstPath = new Map<string, string>();
  for (const value of values) {
    const previous = firstPath.get(value.id);
    if (previous) {
      issues.push({
        code: 'duplicate_id',
        path: value.path,
        message: `Duplicate ${label} id "${value.id}"; first declared at ${previous}.`,
      });
    } else {
      firstPath.set(value.id, value.path);
    }
  }
}

function validateEndpointRoutes(
  config: LoadedConfig,
  issues: ConfigValidationIssue[],
): void {
  validateProtocolRoutes(
    'httpServers',
    config.endpoints.httpServers,
    config,
    issues,
  );
  validateProtocolRoutes(
    'wsServers',
    config.endpoints.wsServers,
    config,
    issues,
  );
}

function validateProtocolRoutes(
  collection: 'httpServers' | 'wsServers',
  endpoints: Array<{
    id: string;
    host?: string;
    port?: number;
    path: string;
  }>,
  config: LoadedConfig,
  issues: ConfigValidationIssue[],
): void {
  const routes = new Map<string, string>();
  for (const [index, endpoint] of endpoints.entries()) {
    const host = endpoint.host ?? config.app.server.host;
    const port = endpoint.port ?? config.app.server.port;
    const route = `${host}:${port}${endpoint.path}`;
    const path = `endpoints.${collection}[${index}].path`;
    const previous = routes.get(route);
    if (previous) {
      issues.push({
        code: 'duplicate_route',
        path,
        message: `Duplicate ${collection} route "${route}"; first declared at ${previous}.`,
      });
    } else {
      routes.set(route, path);
    }
    if (
      host === config.app.server.host &&
      port === config.app.server.port &&
      isReservedControlPath(endpoint.path)
    ) {
      issues.push({
        code: 'reserved_route',
        path,
        message: `Endpoint "${endpoint.id}" uses reserved control path "${endpoint.path}".`,
      });
    }
  }
}

function isReservedControlPath(value: string): boolean {
  return (
    value === '/' ||
    value === '/api' ||
    value.startsWith('/api/') ||
    value === '/ui' ||
    value.startsWith('/ui/')
  );
}

function validateReferences(
  config: LoadedConfig,
  options: ConfigValidationOptions,
  issues: ConfigValidationIssue[],
): void {
  const actionIds = new Set(config.actions.map(action => action.id));
  const httpClientIds = new Set(
    config.endpoints.httpClients.map(endpoint => endpoint.id),
  );
  const wsTargetIds = new Set([
    ...config.endpoints.wsServers.map(endpoint => endpoint.id),
    ...config.endpoints.wsClients.map(endpoint => endpoint.id),
  ]);
  for (const [index, endpoint] of config.endpoints.httpServers.entries()) {
    validateTemplate(
      endpoint.template,
      `endpoints.httpServers[${index}].template`,
      options,
      issues,
    );
  }
  for (const [index, endpoint] of config.endpoints.httpClients.entries()) {
    validateTemplate(
      endpoint.template,
      `endpoints.httpClients[${index}].template`,
      options,
      issues,
    );
  }
  for (const [index, action] of config.actions.entries()) {
    validateProtectedLocalFields(action, `actions[${index}]`, issues);
    if (action.type === 'send_http') {
      validateTemplate(
        action.template,
        `actions[${index}].template`,
        options,
        issues,
      );
    }
    if (action.type === 'send_ws') {
      validateWsTarget(
        action.target,
        `actions[${index}].target`,
        wsTargetIds,
        issues,
      );
    }
    if (action.type === 'wait_event') {
      validateEventSource(
        action,
        `actions[${index}].source`,
        config.endpoints,
        issues,
      );
      validateTemplate(
        action.template,
        `actions[${index}].template`,
        options,
        issues,
      );
    }
  }
  for (const [ruleIndex, rule] of config.rules.entries()) {
    for (const [thenIndex, step] of (rule.then ?? []).entries()) {
      if (!actionIds.has(step.action)) {
        issues.push({
          code: 'unknown_action',
          path: `rules[${ruleIndex}].then[${thenIndex}].action`,
          message: `Automation "${rule.id}" references unknown action "${step.action}".`,
        });
      }
    }
    if (rule.when) {
      validateEventSource(
        rule.when,
        `rules[${ruleIndex}].when.source`,
        config.endpoints,
        issues,
      );
    }
    for (const [nodeIndex, node] of (rule.workflow?.nodes ?? []).entries()) {
      const nodePath = `rules[${ruleIndex}].workflow.nodes[${nodeIndex}]`;
      if (node.type === 'trigger' && node.trigger.type === 'event') {
        validateEventSource(
          node.trigger.event,
          `${nodePath}.trigger.event.source`,
          config.endpoints,
          issues,
        );
        validateTemplate(
          node.trigger.event.template,
          `${nodePath}.trigger.event.template`,
          options,
          issues,
        );
      }
      if (node.type !== 'action') continue;
      validateProtectedLocalFields(node.action, `${nodePath}.action`, issues);
      if (
        node.action.type === 'reference' &&
        !actionIds.has(node.action.actionId)
      ) {
        issues.push({
          code: 'unknown_action',
          path: `${nodePath}.action.actionId`,
          message: `Automation "${rule.id}" references unknown action "${node.action.actionId}".`,
        });
      }
      if (
        node.action.type === 'send_http' &&
        node.action.clientId &&
        !httpClientIds.has(node.action.clientId)
      ) {
        issues.push({
          code: 'unknown_endpoint',
          path: `${nodePath}.action.clientId`,
          message: `Automation "${rule.id}" references unknown HTTP client "${node.action.clientId}".`,
        });
      }
      if (node.action.type === 'send_http') {
        validateTemplate(
          node.action.template,
          `${nodePath}.action.template`,
          options,
          issues,
        );
      }
      if (node.action.type === 'send_ws') {
        validateWsTarget(
          node.action.target,
          `${nodePath}.action.target`,
          wsTargetIds,
          issues,
        );
      }
      if (node.action.type === 'wait_event') {
        validateEventSource(
          node.action,
          `${nodePath}.action.source`,
          config.endpoints,
          issues,
        );
        validateTemplate(
          node.action.template,
          `${nodePath}.action.template`,
          options,
          issues,
        );
      }
    }
  }
}

function validateProtectedLocalFields(
  action: {
    type: string;
    cwd?: string;
    command?: string;
    interpreter?: string;
    script?: string;
  },
  path: string,
  issues: ConfigValidationIssue[],
): void {
  const protectedFields =
    action.type === 'command'
      ? (['cwd', 'command'] as const)
      : action.type === 'script'
        ? (['cwd', 'interpreter', 'script'] as const)
        : [];
  for (const field of protectedFields) {
    const value = action[field];
    if (value && containsWorkflowExpression(value)) {
      issues.push({
        code: 'unsafe_expression',
        path: `${path}.${field}`,
        message: `Workflow expressions are not allowed in local execution field "${field}".`,
      });
    }
  }
}

function validateTemplate(
  template: string | undefined,
  path: string,
  options: ConfigValidationOptions,
  issues: ConfigValidationIssue[],
): void {
  if (!template || !options.templateIds || options.templateIds.has(template)) {
    return;
  }
  issues.push({
    code: 'unknown_template',
    path,
    message: `Unknown message template "${template}".`,
  });
}

function validateWsTarget(
  target: string,
  path: string,
  targetIds: ReadonlySet<string>,
  issues: ConfigValidationIssue[],
): void {
  if (
    targetIds.has(target) ||
    target.startsWith('ws://') ||
    target.startsWith('wss://') ||
    containsWorkflowExpression(target)
  ) {
    return;
  }
  issues.push({
    code: 'unknown_endpoint',
    path,
    message: `Unknown WebSocket target "${target}".`,
  });
}

function validateEventSource(
  filter: WorkflowEventFilter,
  path: string,
  endpoints: EndpointsConfig,
  issues: ConfigValidationIssue[],
): void {
  if (!filter.source || filter.anySource) return;
  const prefixes = [
    {
      prefix: 'http.server.',
      ids: new Set(endpoints.httpServers.map(endpoint => endpoint.id)),
    },
    {
      prefix: 'ws.server.',
      ids: new Set(endpoints.wsServers.map(endpoint => endpoint.id)),
    },
    {
      prefix: 'ws.client.',
      ids: new Set(endpoints.wsClients.map(endpoint => endpoint.id)),
    },
  ];
  const match = prefixes.find(candidate =>
    filter.source?.startsWith(candidate.prefix),
  );
  if (!match) return;
  const id = filter.source.slice(match.prefix.length);
  if (match.ids.has(id)) return;
  issues.push({
    code: 'unknown_source',
    path,
    message: `Unknown event source "${filter.source}".`,
  });
}

function validateWorkflowGraph(
  workflow: WorkflowGraph,
  ruleIndex: number,
  issues: ConfigValidationIssue[],
): void {
  const nodes = new Map(workflow.nodes.map(node => [node.id, node]));
  if (!nodes.has(workflow.startNodeId)) return;
  const reachable = walkGraph(workflow.startNodeId, nodeId =>
    workflow.edges.filter(edge => edge.from === nodeId).map(edge => edge.to),
  );
  const terminalIds = workflow.nodes
    .filter(node => node.type === 'end')
    .map(node => node.id);
  const canReachTerminal = new Set<string>();
  for (const terminalId of terminalIds) {
    for (const nodeId of walkGraph(terminalId, current =>
      workflow.edges.filter(edge => edge.to === current).map(edge => edge.from),
    )) {
      canReachTerminal.add(nodeId);
    }
  }
  for (const [nodeIndex, node] of workflow.nodes.entries()) {
    const path = `rules[${ruleIndex}].workflow.nodes[${nodeIndex}]`;
    if (!reachable.has(node.id)) {
      issues.push({
        code: 'unreachable_node',
        path,
        message: `Workflow node "${node.id}" is unreachable from the trigger.`,
      });
    } else if (!canReachTerminal.has(node.id)) {
      issues.push({
        code: 'no_terminal_path',
        path,
        message: `Workflow node "${node.id}" has no path to an end node.`,
      });
    }
  }
}

function walkGraph(
  start: string,
  next: (nodeId: string) => string[],
): Set<string> {
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    pending.push(...next(current));
  }
  return visited;
}
