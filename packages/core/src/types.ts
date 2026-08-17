/** Event categories understood by rules and actions. */
export type EventKind =
  | 'http.request'
  | 'http.response'
  | 'ws.message'
  | 'action.result'
  | 'timer.trigger';

/** A normalized event received by the automation engine. */
export interface EventEnvelope {
  id: string;
  traceId: string;
  time: string;
  source: string;
  kind: EventKind;
  body?: unknown;
  meta: {
    remoteAddress?: string;
    method?: string;
    path?: string;
    statusCode?: number;
    headers?: Record<string, string | string[] | undefined>;
    [key: string]: unknown;
  };
}

/** A single JSONPath-based rule condition. */
export interface MatchCondition {
  jsonPath?: string;
  equals?: unknown;
  contains?: string;
  regex?: string;
}

/** A condition group that requires every nested condition to match. */
export type MatchConfig = MatchCondition & {
  all?: MatchCondition[];
};

/** Coordinates used to keep workflow nodes stable in the visual editor. */
export interface WorkflowNodePosition {
  x: number;
  y: number;
}

/** Event filter attached to a workflow trigger or wait action. */
export interface WorkflowEventFilter {
  source?: string;
  anySource?: boolean;
  kind?: EventKind;
  template?: string;
  match?: MatchConfig;
}

/** A local-time schedule attached to an automation trigger. */
export type WorkflowSchedule =
  | {
      mode: 'once';
      at: string;
      misfirePolicy?: 'skip' | 'runOnce';
    }
  | {
      mode: 'interval';
      everyMs: number;
      startAt?: string;
      misfirePolicy?: 'skip' | 'runOnce';
    }
  | {
      mode: 'daily';
      time: string;
      timeZone?: string;
      misfirePolicy?: 'skip' | 'runOnce';
    };

/** The event or clock condition that starts an automation workflow. */
export type WorkflowTrigger =
  | {
      type: 'event';
      event: WorkflowEventFilter;
    }
  | {
      type: 'time';
      schedule: WorkflowSchedule;
    };

/** An executable operation embedded in a workflow action node. */
export type WorkflowActionSpec =
  | {
      type: 'reference';
      actionId: string;
      with?: Record<string, unknown>;
      onMissing?: WorkflowExpressionMissingPolicy;
    }
  | {
      type: 'command';
      cwd: string;
      command: string;
      args?: string[];
      timeoutMs?: number;
      allowConcurrent?: boolean;
    }
  | {
      type: 'script';
      cwd: string;
      interpreter: string;
      script: string;
      args?: string[];
      timeoutMs?: number;
    }
  | {
      type: 'notification';
      title: string;
      message: string;
    }
  | {
      type: 'prompt';
      title: string;
      message: string;
      options: string[];
      timeoutMs?: number;
    }
  | ({
      type: 'send_http';
      clientId?: string;
      url?: string;
      path?: string;
    } & Omit<SendHttpActionConfig, 'id' | 'type' | 'description' | 'url'>)
  | {
      type: 'send_ws';
      target: string;
      body?: unknown;
      timeoutMs?: number;
      retry?: ActionRetryPolicy;
    }
  | ({
      type: 'wait_event';
      timeoutMs?: number;
    } & WorkflowEventFilter);

/** A workflow trigger, action, branch condition, or terminal node. */
export type WorkflowNode =
  | {
      id: string;
      type: 'trigger';
      label: string;
      position?: WorkflowNodePosition;
      trigger: WorkflowTrigger;
    }
  | {
      id: string;
      type: 'action';
      label: string;
      position?: WorkflowNodePosition;
      action: WorkflowActionSpec;
    }
  | {
      id: string;
      type: 'logic';
      label: string;
      position?: WorkflowNodePosition;
      logic: {
        input: 'lastResult' | 'triggerEvent' | 'lastEvent';
        jsonPath?: string;
        operator: 'equals' | 'contains' | 'regex' | 'truthy' | 'success';
        value?: unknown;
      };
    }
  | {
      id: string;
      type: 'end';
      label: string;
      position?: WorkflowNodePosition;
      end: {
        status: 'completed' | 'failed';
        message?: string;
      };
    };

/** Outcome used to select the next workflow edge. */
export type WorkflowEdgeOutcome =
  'always' | 'success' | 'failure' | 'true' | 'false';

/** Directed connection between two workflow nodes. */
export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  outcome: WorkflowEdgeOutcome;
  label?: string;
}

/** Versioned directed graph executed when its trigger receives an event. */
export interface WorkflowGraph {
  version: '1.0';
  startNodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** Behavior used when a workflow expression cannot find its referenced value. */
export type WorkflowExpressionMissingPolicy = 'error' | 'empty' | 'preserve';

/** Values exposed to safe `${{ ... }}` workflow expressions. */
export interface WorkflowExpressionContext {
  trigger: EventEnvelope;
  inputs: Record<string, unknown>;
  nodes: Record<string, WorkflowNodeContextValue>;
  last: {
    result?: ActionResult;
    event?: EventEnvelope;
  };
  workflow: {
    id: string;
    runId: string;
    traceId: string;
    startedAt: string;
  };
}

/** Result data addressable through the `nodes` expression root. */
export interface WorkflowNodeContextValue {
  status: WorkflowNodeExecutionStatus;
  result?: ActionResult;
  event?: EventEnvelope;
  output?: unknown;
  error?: string;
}

/** Runtime state rendered on an individual workflow node. */
export type WorkflowNodeExecutionStatus =
  'waiting' | 'running' | 'completed' | 'failed' | 'cancelled';

/** One node transition in a workflow execution timeline. */
export interface WorkflowNodeExecution {
  id: string;
  nodeId: string;
  nodeType: WorkflowNode['type'];
  branchId: string;
  status: WorkflowNodeExecutionStatus;
  outcome?: WorkflowEdgeOutcome;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  actionRunId?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

/** Structured detail attached to workflow-level ActionResult records. */
export interface WorkflowRunDetail extends Record<string, unknown> {
  kind: 'workflow';
  currentNodeIds: string[];
  timeline: WorkflowNodeExecution[];
  completedEnds?: number;
  nodeRunIds?: string[];
  context?: Pick<WorkflowExpressionContext, 'inputs' | 'nodes' | 'last'>;
}

/** A notification or choice request waiting for the local WebUI. */
export interface UserInteraction {
  id: string;
  type: 'notification' | 'prompt';
  title: string;
  message: string;
  options: string[];
  createdAt: string;
  expiresAt?: string;
}

/** A declarative event-to-action automation rule. */
export interface RuleConfig {
  id: string;
  enabled: boolean;
  description?: string;
  when?: {
    source?: string;
    anySource?: boolean;
    kind?: EventKind;
    match?: MatchConfig;
  };
  then?: Array<{
    action: string;
    with?: Record<string, unknown>;
  }>;
  workflow?: WorkflowGraph;
}

/** Configuration for an allowlisted local command action. */
export interface ActionBaseConfig {
  id: string;
  description?: string;
  expressionPolicy?: WorkflowExpressionMissingPolicy;
}

/** Retry policy shared by outbound HTTP and WebSocket actions. */
export interface ActionRetryPolicy {
  maxAttempts: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
}

export interface CommandActionConfig extends ActionBaseConfig {
  type: 'command';
  cwd: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  allowConcurrent?: boolean;
}

/** Configuration for an outbound HTTP action. */
export interface SendHttpActionConfig extends ActionBaseConfig {
  type: 'send_http';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  template?: string;
  templateValues?: Record<string, unknown>;
  timeoutMs?: number;
  retry?: ActionRetryPolicy;
  idempotencyKey?: string;
}

/** Configuration for an outbound WebSocket action. */
export interface SendWsActionConfig extends ActionBaseConfig {
  type: 'send_ws';
  target: string;
  body?: unknown;
  timeoutMs?: number;
  retry?: ActionRetryPolicy;
}

/** Configuration for running a script through an explicit interpreter. */
export interface ScriptActionConfig extends ActionBaseConfig {
  type: 'script';
  cwd: string;
  interpreter: string;
  script: string;
  args?: string[];
  timeoutMs?: number;
}

/** Configuration for publishing a local WebUI notification. */
export interface NotificationActionConfig extends ActionBaseConfig {
  type: 'notification';
  title: string;
  message: string;
}

/** Configuration for waiting for a user choice in the local WebUI. */
export interface PromptActionConfig extends ActionBaseConfig {
  type: 'prompt';
  title: string;
  message: string;
  options: string[];
  timeoutMs?: number;
}

/** Configuration for blocking until a matching endpoint event is received. */
export interface WaitEventActionConfig
  extends WorkflowEventFilter, ActionBaseConfig {
  type: 'wait_event';
  timeoutMs?: number;
}

/** A supported executable action configuration. */
export type ActionConfig =
  | CommandActionConfig
  | SendHttpActionConfig
  | SendWsActionConfig
  | ScriptActionConfig
  | NotificationActionConfig
  | PromptActionConfig
  | WaitEventActionConfig;

/** The next clock-triggered workflow executions exposed to the WebUI. */
export interface ScheduledWorkflowStatus {
  ruleId: string;
  mode: WorkflowSchedule['mode'];
  nextRunAt: string;
  lastRunAt?: string;
  timeZone?: string;
}

/** The persisted lifecycle state of an action execution. */
export interface ActionResult {
  id: string;
  traceId?: string;
  actionId: string;
  actionType?: ActionConfig['type'];
  target?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  ok?: boolean;
  eventId?: string;
  ruleId?: string;
  workflowRunId?: string;
  workflowNodeId?: string;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  output?: string;
  error?: string;
  exitCode?: number;
  attempts?: number;
  detail?: Record<string, unknown>;
}

/** All validated configuration documents loaded from disk. */
export interface LoadedConfig {
  app: AppConfig;
  endpoints: EndpointsConfig;
  rules: RuleConfig[];
  actions: ActionConfig[];
}

/** Runtime, security, automation, and storage settings. */
export interface AppConfig {
  version: 1;
  server: {
    host: string;
    port: number;
    webSocketPath: string;
  };
  security: {
    apiToken: string;
    operatorToken?: string;
    readToken?: string;
    requireTokenForRead: boolean;
    allowedApiSources: string[];
    corsOrigins: string[];
    allowedCommandRoots: string[];
    allowedExecutables: string[];
    commandEnvironmentAllowlist: string[];
    allowShell: false;
  };
  network: {
    inbound: {
      allowedSources: string[];
      allowedOrigins: string[];
      maxHttpBodyBytes: number;
      maxWebSocketMessageBytes: number;
      maxWebSocketConnectionsPerEndpoint: number;
      requestTimeoutMs: number;
      headersTimeoutMs: number;
      keepAliveTimeoutMs: number;
      maxHeadersCount: number;
    };
    outbound: {
      allowedHostnames: string[];
      allowedPrivateHostnames: Array<{
        hostname: string;
        allowedAddresses: string[];
      }>;
      allowedAddresses: string[];
      allowedPorts: number[];
      maxHttpRequestBytes: number;
      maxHttpResponseBytes: number;
      maxWebSocketMessageBytes: number;
    };
  };
  automation: {
    maxConcurrentActions: number;
    maxActionOutputBytes: number;
  };
  storage: {
    eventLogPath: string;
    runLogPath: string;
    auditLogPath: string;
    schedulerStatePath: string;
    configHistoryPath: string;
    configHistoryLimit: number;
    maxLogBytes: number;
    maxLogFiles: number;
  };
}

/** Editable YAML documents managed as one validated configuration set. */
export type ConfigDocumentName = 'app' | 'endpoints' | 'rules' | 'actions';

/** One immutable backup created before a configuration replacement. */
export interface ConfigRevision {
  id: string;
  name: ConfigDocumentName;
  createdAt: string;
  reason: 'save' | 'restore' | 'migration';
  size: number;
  sha256: string;
  restoredFrom?: string;
}

/** One cross-document configuration validation failure. */
export interface ConfigValidationIssue {
  code:
    | 'duplicate_id'
    | 'duplicate_route'
    | 'reserved_route'
    | 'unknown_action'
    | 'unknown_endpoint'
    | 'unknown_template'
    | 'unknown_source'
    | 'unsafe_expression'
    | 'unreachable_node'
    | 'no_terminal_path';
  path: string;
  message: string;
}

/** Security audit record written without request bodies or credentials. */
export interface SecurityAuditRecord {
  id: string;
  time: string;
  requestId: string;
  remoteAddress: string;
  method: string;
  path: string;
  permission: 'read' | 'operate' | 'admin';
  outcome: 'allowed' | 'denied' | 'failed';
  role?: 'reader' | 'operator' | 'admin';
  statusCode: number;
  reason?: string;
}

/** JSON value categories supported by template form fields. */
export type MessageTemplateValueType =
  'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

/** A value generated whenever a send-capable template is materialized. */
export type MessageTemplateGeneratedValue = 'uuid' | 'utc-date-time';

/** Metadata for one addressable field in a message template. */
export interface MessageTemplateField {
  key: string;
  label: string;
  path: string;
  paths?: string[];
  description: string;
  required: boolean;
  valueType: MessageTemplateValueType;
  displayOrder?: number;
  defaultValue?: unknown;
  generatedValue?: MessageTemplateGeneratedValue;
  allowedValues?: unknown[];
  constValue?: unknown;
  format?: 'date-time' | 'uri' | 'uuid' | 'email' | 'ipv4' | 'ipv6';
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  roles: {
    display: boolean;
    send: boolean;
    match: boolean;
  };
  input?: {
    control?: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'json';
    placeholder?: string;
  };
}

/** A cross-field message-template constraint. */
export interface MessageTemplateConstraint {
  kind: 'atLeastOne';
  paths: string[];
  message: string;
}

/** A version 2 message contract used for validation and form generation. */
export interface MessageTemplate {
  templateVersion: '2.0';
  id: string;
  name: string;
  description: string;
  contentType: 'application/json';
  capabilities: {
    receive: boolean;
    send: boolean;
    match: boolean;
  };
  schema: Record<string, unknown>;
  minimum: {
    body: unknown;
    pruneEmpty: boolean;
  };
  fields: MessageTemplateField[];
  constraints: MessageTemplateConstraint[];
  examples: Array<{
    name: string;
    description: string;
    body: unknown;
  }>;
  notes: string[];
}

/** HTTP and WebSocket listener and client definitions. */
export interface EndpointsConfig {
  version: 1;
  httpServers: Array<{
    id: string;
    enabled: boolean;
    host?: string;
    port?: number;
    path: string;
    description?: string;
    template?: string;
  }>;
  wsServers: Array<{
    id: string;
    enabled: boolean;
    host?: string;
    port?: number;
    path: string;
    description?: string;
  }>;
  httpClients: Array<{
    id: string;
    enabled: boolean;
    description?: string;
    baseUrl: string;
    headers?: Record<string, string>;
    template?: string;
    templateFields?: string[];
    templateValues?: Record<string, unknown>;
    test?: {
      probePath: string;
      sendMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      sendPath: string;
    };
  }>;
  wsClients: Array<{
    id: string;
    enabled: boolean;
    url: string;
    description?: string;
    reconnect?: {
      enabled: boolean;
      initialDelayMs: number;
      maxDelayMs: number;
      backoffMultiplier: number;
    };
    heartbeatIntervalMs?: number;
  }>;
}
