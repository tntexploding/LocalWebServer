/** Event categories understood by rules and actions. */
export type EventKind =
  'http.request' | 'http.response' | 'ws.message' | 'action.result';

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

/** A declarative event-to-action automation rule. */
export interface RuleConfig {
  id: string;
  enabled: boolean;
  description?: string;
  when: {
    source?: string;
    anySource?: boolean;
    kind?: EventKind;
    match?: MatchConfig;
  };
  then: Array<{
    action: string;
    with?: Record<string, unknown>;
  }>;
}

/** Configuration for an allowlisted local command action. */
export interface CommandActionConfig {
  id: string;
  type: 'command';
  description?: string;
  cwd: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
  allowConcurrent?: boolean;
}

/** Configuration for an outbound HTTP action. */
export interface SendHttpActionConfig {
  id: string;
  type: 'send_http';
  description?: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  template?: string;
  templateValues?: Record<string, unknown>;
}

/** Configuration for an outbound WebSocket action. */
export interface SendWsActionConfig {
  id: string;
  type: 'send_ws';
  description?: string;
  target: string;
  body?: unknown;
}

/** A supported executable action configuration. */
export type ActionConfig =
  CommandActionConfig | SendHttpActionConfig | SendWsActionConfig;

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
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  output?: string;
  error?: string;
  exitCode?: number;
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
  server: {
    host: string;
    port: number;
    webSocketPath: string;
  };
  security: {
    apiToken: string;
    allowedCommandRoots: string[];
    allowShell: boolean;
  };
  automation: {
    maxConcurrentActions: number;
  };
  storage: {
    eventLogPath: string;
    runLogPath: string;
  };
}

/** JSON value categories supported by template form fields. */
export type MessageTemplateValueType =
  'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

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
  }>;
  wsClients: Array<{
    id: string;
    enabled: boolean;
    url: string;
  }>;
}
