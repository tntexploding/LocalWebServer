import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import type {IncomingHttpHeaders} from 'node:http';
import fastify, {type FastifyRequest} from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  ConfigStore,
  ensureDataDir,
  JsonFileStore,
  JsonlStore,
} from '@las/storage';
import type {RawConfigFiles} from '@las/storage';
import {
  appConfigSchema,
  assertValidConfigDependencies,
  containsWorkflowExpression,
  type ActionConfig,
  endpointsConfigSchema,
  type ActionResult,
  type AppConfig,
  type ConfigDocumentName,
  type EndpointsConfig,
  type EventEnvelope,
  type LoadedConfig,
  type RuleConfig,
  type SecurityAuditRecord,
} from '@las/core';
import {
  ApiSecurity,
  assertValidApiSecurityPolicy,
  type ApiPermission,
  type ApiRole,
} from './apiSecurity.js';
import {ActionExecutor} from './actionExecutor.js';
import {ActionQueue} from './actionQueue.js';
import {EndpointListenerManager} from './endpointListenerManager.js';
import {EndpointTester} from './endpointTester.js';
import {EventProcessor, makeEvent} from './eventProcessor.js';
import {EventWaitBroker} from './eventWaitBroker.js';
import {InteractionBroker} from './interactionBroker.js';
import {MessageTemplateDecoder} from './messageTemplateDecoder.js';
import {
  assertValidNetworkPolicy,
  NetworkPolicy,
  safeNetworkTarget,
} from './networkPolicy.js';
import {WorkflowExecutor} from './workflowExecutor.js';
import {WorkflowScheduler} from './workflowScheduler.js';
import {assertSupportedRuntime} from './runtimePolicy.js';

const codeRoot = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
);
await assertSupportedRuntime(codeRoot);
const rootDir = path.resolve(process.env.LAS_ROOT_DIR ?? codeRoot);
const messageTemplates = new MessageTemplateDecoder(rootDir);
const configStore = new ConfigStore(rootDir, {
  secretsPath: process.env.LAS_SECRETS_PATH,
  validate: async candidate => {
    assertValidApiSecurityPolicy(candidate.app.security);
    assertValidNetworkPolicy(candidate.app.network);
    validateManagedStoragePaths(candidate.app);
    await validateStaticNetworkTargets(candidate);
    const templates = await messageTemplates.list();
    assertValidConfigDependencies(candidate, {
      templateIds: new Set(templates.map(template => template.name)),
    });
  },
});
await ensureDataDir(rootDir);

let config = await configStore.load();
const networkPolicy = new NetworkPolicy(() => config.app.network);
const endpointTester = new EndpointTester(
  () => config,
  messageTemplates,
  networkPolicy,
);

const eventLog = new JsonlStore<EventEnvelope>(
  resolveManagedDataPath(config.app.storage.eventLogPath, 'eventLogPath'),
  {
    maxBytes: config.app.storage.maxLogBytes,
    maxFiles: config.app.storage.maxLogFiles,
  },
);
const runLog = new JsonlStore<ActionResult>(
  resolveManagedDataPath(config.app.storage.runLogPath, 'runLogPath'),
  {
    maxBytes: config.app.storage.maxLogBytes,
    maxFiles: config.app.storage.maxLogFiles,
  },
);
const auditLog = new JsonlStore<SecurityAuditRecord>(
  resolveManagedDataPath(config.app.storage.auditLogPath, 'auditLogPath'),
  {
    maxBytes: config.app.storage.maxLogBytes,
    maxFiles: config.app.storage.maxLogFiles,
  },
);
const schedulerState = new JsonFileStore<{
  version: 1;
  lastTriggeredAt: Record<string, string>;
}>(
  resolveManagedDataPath(
    config.app.storage.schedulerStatePath,
    'schedulerStatePath',
  ),
);

const app = fastify({
  bodyLimit: config.app.network.inbound.maxHttpBodyBytes,
  requestTimeout: config.app.network.inbound.requestTimeoutMs,
  keepAliveTimeout: config.app.network.inbound.keepAliveTimeoutMs,
  logger: {
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-api-key',
        'req.headers.x-las-token',
        'request.headers.authorization',
        'request.headers.cookie',
        'request.headers.x-api-key',
        'request.headers.x-las-token',
      ],
      censor: '[REDACTED]',
    },
  },
});
app.server.headersTimeout = config.app.network.inbound.headersTimeoutMs;
app.server.maxHeadersCount = config.app.network.inbound.maxHeadersCount;
const apiSecurity = new ApiSecurity(
  () => config.app.security,
  auditLog,
  error => app.log.error({error}, 'Security audit record could not be saved.'),
);
const pendingAudits = new Map<
  string,
  {permission: ApiPermission; role: ApiRole; remoteAddress: string}
>();
await app.register(cors, {
  origin(origin, callback) {
    callback(null, apiSecurity.isOriginAllowed(origin));
  },
});

app.addHook('onSend', async (request, reply, payload) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('referrer-policy', 'no-referrer');
  reply.header(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  if (request.url === '/' || request.url.startsWith('/ui/')) {
    reply.header(
      'content-security-policy',
      "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self' data:; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
    );
  }
  if (request.url.startsWith('/api/')) {
    reply.header('cache-control', 'no-store');
  }
  return payload;
});

app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/')) return;
  const sourceAllowed = apiSecurity.isSourceAllowed(request.ip);
  const originAllowed = apiSecurity.isOriginAllowed(request.headers.origin);
  if (sourceAllowed && originAllowed) return;
  const reason = sourceAllowed
    ? 'Browser origin is not allowlisted.'
    : 'Source address is not allowlisted.';
  await apiSecurity.audit({
    requestId: request.id,
    remoteAddress: request.ip,
    method: request.method,
    path: requestPath(request.url),
    permission: requestPermission(request.method, request.url),
    outcome: 'denied',
    statusCode: 403,
    reason,
  });
  return reply.code(403).send({
    error: sourceAllowed
      ? 'API origin is not allowed.'
      : 'API source is not allowed.',
  });
});

app.addHook('preSerialization', async (request, _reply, payload) => {
  return request.url.startsWith('/api/')
    ? configStore.redact(payload)
    : payload;
});

app.addHook('onResponse', async (request, reply) => {
  const pending = pendingAudits.get(request.id);
  if (!pending) return;
  pendingAudits.delete(request.id);
  await apiSecurity.audit({
    requestId: request.id,
    remoteAddress: pending.remoteAddress,
    method: request.method,
    path: requestPath(request.url),
    permission: pending.permission,
    outcome: reply.statusCode >= 400 ? 'failed' : 'allowed',
    role: pending.role,
    statusCode: reply.statusCode,
  });
});

const webDist = path.join(codeRoot, 'apps', 'web', 'dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/ui/',
    decorateReply: false,
  });
}

const endpointListeners: EndpointListenerManager = new EndpointListenerManager(
  app.server,
  config.app.server,
  async (message): Promise<unknown> => {
    const decoded = message.endpoint.template
      ? await messageTemplates.decode(message.endpoint.template, message.body)
      : undefined;
    const event = makeEvent({
      source: `http.server.${message.endpoint.id}`,
      kind: 'http.request',
      traceId: requestHeader(message.headers['x-las-trace-id']),
      body: message.body,
      meta: {
        method: message.method,
        path: safeRequestPath(message.path),
        remoteAddress: message.remoteAddress,
        headers: redactSensitiveHeaders(message.headers),
        listener: {
          host: message.endpoint.host,
          port: message.endpoint.port,
          path: message.endpoint.path,
        },
        decoded,
      },
    });
    const results: ActionResult[] = await processor.receive(event);
    return {ok: true, eventId: event.id, actionResults: results};
  },
  async message => {
    const event = makeEvent({
      source: `ws.${message.role}.${message.endpoint.id}`,
      kind: 'ws.message',
      traceId: messageTraceId(message.body),
      body: message.body,
      meta: {
        remoteAddress: message.remoteAddress,
        connectionRole: message.role,
        ...('path' in message.endpoint ? {path: message.endpoint.path} : {}),
        ...('host' in message.endpoint
          ? {
              listener: {
                host: message.endpoint.host,
                port: message.endpoint.port,
              },
            }
          : {client: {url: safeNetworkTarget(message.endpoint.url)}}),
      },
    });
    await processor.receive(event);
  },
  networkPolicy,
  (error, context) => {
    app.log.error({error, context}, 'Endpoint listener operation failed.');
  },
);
const interactions = new InteractionBroker();
const eventWaits = new EventWaitBroker();
const executor: ActionExecutor = new ActionExecutor(
  () => config.app,
  (target, payload, options) =>
    endpointListeners.send(target, payload, options),
  messageTemplates,
  interactions,
  eventWaits,
  networkPolicy,
  rootDir,
);
const queue: ActionQueue = new ActionQueue(
  config.app.automation.maxConcurrentActions,
  executor,
  runLog,
  error => app.log.error({error}, 'Action result could not be persisted.'),
  result => configStore.redact(result),
);
const workflowExecutor = new WorkflowExecutor(
  queue,
  runLog,
  eventWaits,
  () => config,
  error => app.log.error({error}, 'Workflow result could not be persisted.'),
  result => configStore.redact(result),
);
const processor: EventProcessor = new EventProcessor(
  eventLog,
  runLog,
  queue,
  workflowExecutor,
  event => configStore.redact(event),
  result => configStore.redact(result),
);
const workflowScheduler = new WorkflowScheduler(
  async (rule, event) => {
    await processor.triggerWorkflow(rule, event);
  },
  (error, rule) => {
    app.log.error({error, ruleId: rule.id}, 'Scheduled workflow failed.');
  },
  schedulerState,
  error => app.log.error({error}, 'Scheduler state could not be persisted.'),
);
processor.updateConfig(config.rules, config.actions);
await workflowScheduler.initialize(config.rules);

app.addHook('onClose', async () => {
  workflowScheduler.stop();
});

await applyEndpointServers();
endpointListeners.listenForControlUpgrades();

app.get('/api/health', async () => ({
  ok: true,
  time: new Date().toISOString(),
  ws: configStore.redact(endpointListeners.wsStatus()),
  listeners: endpointListeners.listenerStatus(),
}));

app.get('/api/config', async request => {
  requirePermission(request, 'read');
  return publicConfig();
});

app.get('/api/config/raw', async request => {
  requirePermission(request, 'admin');
  return configStore.loadRaw();
});

app.get('/api/templates', async request => {
  requirePermission(request, 'read');
  return messageTemplates.list();
});

app.put<{Body: EndpointsConfig}>('/api/endpoints', async request => {
  requirePermission(request, 'admin');
  const endpoints = endpointsConfigSchema.parse(request.body);
  await replaceEndpoints(endpoints);
  return publicConfig();
});

app.put<{Body: RuleConfig[]}>('/api/rules', async request => {
  requirePermission(request, 'admin');
  if (!Array.isArray(request.body)) {
    throw new Error('Rules payload must be an array.');
  }
  config = await configStore.saveRules(request.body);
  updateAutomationConfig(true);
  return publicConfig();
});

app.put<{Body: ActionConfig[]}>('/api/actions', async request => {
  requirePermission(request, 'admin');
  if (!Array.isArray(request.body)) {
    throw new Error('Actions payload must be an array.');
  }
  config = await configStore.saveActions(request.body);
  updateAutomationConfig(false);
  return publicConfig();
});

app.put<{Body: Partial<AppConfig['server']>}>(
  '/api/app/server',
  async request => {
    requirePermission(request, 'admin');
    const appConfig = appConfigSchema.parse({
      ...config.app,
      server: {
        ...config.app.server,
        ...request.body,
      },
    });
    config = await configStore.saveApp(appConfig);
    queue.setMaxConcurrent(config.app.automation.maxConcurrentActions);
    return {
      config: publicConfig(),
      restartRequired: true,
    };
  },
);

app.post<{
  Body: {
    kind: 'httpServer' | 'wsServer' | 'httpClient' | 'wsClient';
    id: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path?: string;
    body?: unknown;
    useTemplate?: boolean;
  };
}>('/api/endpoints/test', async (request, reply) => {
  requirePermission(request, 'operate');
  const result = await endpointTester.test(request.body.kind, request.body.id, {
    method: request.body.method,
    path: request.body.path,
    body: request.body.body,
    useTemplate: request.body.useTemplate,
  });
  return reply.code(result.ok ? 200 : 502).send(result);
});

app.put<{Params: {name: keyof RawConfigFiles}; Body: {content: string}}>(
  '/api/config/raw/:name',
  async (request, reply) => {
    requirePermission(request, 'admin');
    const name = request.params.name;
    if (!['app', 'endpoints', 'rules', 'actions'].includes(name)) {
      return reply.code(404).send({error: 'Unknown config file.'});
    }
    if (name === 'endpoints') {
      await replaceRawEndpoints(request.body.content);
      return publicConfig();
    }
    config = await configStore.saveRaw(name, request.body.content);
    updateAutomationConfig(name === 'rules');
    queue.setMaxConcurrent(config.app.automation.maxConcurrentActions);
    return publicConfig();
  },
);

app.get<{Querystring: {name?: ConfigDocumentName}}>(
  '/api/config/history',
  async (request, reply) => {
    requirePermission(request, 'admin');
    const name = request.query.name;
    if (name && !isConfigDocumentName(name)) {
      return reply.code(400).send({error: 'Invalid config document name.'});
    }
    return configStore.listHistory(name);
  },
);

app.post<{Params: {name: ConfigDocumentName; id: string}}>(
  '/api/config/history/:name/:id/restore',
  async (request, reply) => {
    requirePermission(request, 'admin');
    if (!isConfigDocumentName(request.params.name)) {
      return reply.code(404).send({error: 'Unknown config file.'});
    }
    const previousEndpoints = config.endpoints;
    const candidate = await configStore.previewRevision(
      request.params.name,
      request.params.id,
    );
    if (request.params.name === 'endpoints') {
      await endpointListeners.apply(candidate.endpoints, candidate.app.server);
    }
    try {
      config = await configStore.restore(
        request.params.name,
        request.params.id,
      );
    } catch (error) {
      if (request.params.name === 'endpoints') {
        await endpointListeners.apply(previousEndpoints, config.app.server);
      }
      throw error;
    }
    updateAutomationConfig(request.params.name === 'rules');
    queue.setMaxConcurrent(config.app.automation.maxConcurrentActions);
    return {
      config: publicConfig(),
      restartRequired: request.params.name === 'app',
    };
  },
);

app.get<{
  Querystring: {
    limit?: string;
    source?: string;
    kind?: EventEnvelope['kind'];
    traceId?: string;
  };
}>('/api/events', async request => {
  requirePermission(request, 'read');
  const limit = queryLimit(request.query.limit);
  const rows = await eventLog.latest(queryScanLimit(limit));
  return rows
    .filter(
      event =>
        (!request.query.source || event.source === request.query.source) &&
        (!request.query.kind || event.kind === request.query.kind) &&
        (!request.query.traceId || event.traceId === request.query.traceId),
    )
    .slice(0, limit);
});

app.get<{
  Querystring: {
    limit?: string;
    actionId?: string;
    ruleId?: string;
    traceId?: string;
    workflowRunId?: string;
    status?: ActionResult['status'];
  };
}>('/api/runs', async request => {
  requirePermission(request, 'read');
  const limit = queryLimit(request.query.limit);
  const rows = await runLog.latest(queryScanLimit(limit));
  return rows
    .filter(
      run =>
        (!request.query.actionId || run.actionId === request.query.actionId) &&
        (!request.query.ruleId || run.ruleId === request.query.ruleId) &&
        (!request.query.traceId || run.traceId === request.query.traceId) &&
        (!request.query.workflowRunId ||
          run.workflowRunId === request.query.workflowRunId ||
          run.id === request.query.workflowRunId) &&
        (!request.query.status || run.status === request.query.status),
    )
    .slice(0, limit);
});

app.get<{Params: {id: string}; Querystring: {limit?: string}}>(
  '/api/workflows/:id/runs',
  async request => {
    requirePermission(request, 'read');
    const limit = queryLimit(request.query.limit);
    const rows = await runLog.latest(queryScanLimit(limit));
    return rows
      .filter(
        run =>
          run.ruleId === request.params.id && run.detail?.kind === 'workflow',
      )
      .slice(0, limit);
  },
);

app.get('/api/queue', async request => {
  requirePermission(request, 'read');
  const snapshot = queue.snapshot();
  return {
    ...snapshot,
    running: [...workflowExecutor.snapshot(), ...snapshot.running],
    schedules: workflowScheduler.snapshot(),
  };
});

app.get('/api/interactions', async request => {
  requirePermission(request, 'read');
  return interactions.list();
});

app.post<{Params: {id: string}; Body: {value: string}}>(
  '/api/interactions/:id/respond',
  async (request, reply) => {
    requirePermission(request, 'operate');
    const responded = interactions.respond(
      request.params.id,
      request.body.value,
    );
    if (!responded) {
      return reply.code(404).send({error: 'Unknown interaction.'});
    }
    return {ok: true};
  },
);

app.delete<{Params: {id: string}}>(
  '/api/interactions/:id',
  async (request, reply) => {
    requirePermission(request, 'operate');
    if (!interactions.dismiss(request.params.id)) {
      return reply.code(404).send({error: 'Unknown interaction.'});
    }
    return {ok: true};
  },
);

app.post<{Params: {id: string}}>(
  '/api/queue/:id/cancel',
  async (request, reply) => {
    requirePermission(request, 'operate');
    const result =
      (await queue.cancel(request.params.id)) ??
      workflowExecutor.cancel(request.params.id);
    if (!result) {
      return reply.code(404).send({error: 'Unknown run.'});
    }
    return result;
  },
);

app.post<{Params: {id: string}}>(
  '/api/events/:id/replay',
  async (request, reply) => {
    requirePermission(request, 'operate');
    const original = await eventLog.findById(request.params.id);
    if (!original) {
      return reply.code(404).send({error: 'Unknown event.'});
    }
    const event = makeEvent({
      source: original.source,
      kind: original.kind,
      body: original.body,
      meta: {
        ...original.meta,
        replayOf: original.id,
        replayedAt: new Date().toISOString(),
      },
    });
    const results = await processor.receive(event);
    return {ok: true, eventId: event.id, actionResults: results};
  },
);

app.post<{Params: {id: string}}>('/api/actions/:id/run', async request => {
  requirePermission(request, 'operate');
  const event = makeEvent({
    source: 'ui.manual',
    kind: 'http.request',
    body: {actionId: request.params.id},
    meta: {method: request.method, path: safeRequestPath(request.url)},
  });
  return processor.runAction(request.params.id, event);
});

app.post<{Body: Partial<EventEnvelope>}>('/api/rules/test', async request => {
  requirePermission(request, 'operate');
  const event = makeEvent({
    source: request.body.source ?? 'test.event',
    kind: request.body.kind ?? 'http.request',
    body: request.body.body,
    meta: request.body.meta ?? {},
  });
  return {
    event,
    matches: processor.testEvent(event),
  };
});

app.post<{Params: {target: string}; Body: unknown}>(
  '/api/ws/:target/send',
  async request => {
    requirePermission(request, 'operate');
    await endpointListeners.send(request.params.target, request.body);
    return {ok: true};
  },
);

app.get('/', async (_request, reply) => {
  return reply.redirect('/ui/');
});

app.route({
  method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  url: '/*',
  handler: async (request, reply) => {
    const response = await endpointListeners.handleControlHttp({
      method: request.method,
      url: request.url,
      body: request.body,
      headers: request.headers,
      remoteAddress: request.ip,
    });
    if (!response) {
      return reply.code(404).send({error: 'Unknown route.'});
    }
    return reply.code(response.statusCode).send(response.body);
  },
});

function requirePermission(
  request: FastifyRequest,
  permission: ApiPermission,
): void {
  const authorization = apiSecurity.authorize(
    request.headers['x-las-token'],
    permission,
  );
  if (!authorization.allowed) {
    void apiSecurity.audit({
      requestId: request.id,
      remoteAddress: request.ip,
      method: request.method,
      path: requestPath(request.url),
      permission,
      outcome: 'denied',
      role: authorization.role,
      statusCode: authorization.statusCode,
      reason: authorization.reason,
    });
    const error = new Error(authorization.reason ?? 'API access denied.');
    Object.assign(error, {statusCode: authorization.statusCode});
    throw error;
  }
  if (permission !== 'read' && authorization.role) {
    pendingAudits.set(request.id, {
      permission,
      role: authorization.role,
      remoteAddress: request.ip,
    });
  }
}

async function applyEndpointServers(): Promise<void> {
  await endpointListeners.apply(config.endpoints, config.app.server);
}

function updateAutomationConfig(reschedule: boolean): void {
  processor.updateConfig(config.rules, config.actions);
  if (reschedule) workflowScheduler.updateConfig(config.rules);
}

async function replaceEndpoints(endpoints: EndpointsConfig): Promise<void> {
  const previous = config.endpoints;
  try {
    await configStore.previewEndpoints(endpoints);
    await endpointListeners.apply(endpoints, config.app.server);
    config = await configStore.saveEndpoints(endpoints);
  } catch (error) {
    await endpointListeners.apply(previous, config.app.server);
    throw error;
  }
}

async function replaceRawEndpoints(content: string): Promise<void> {
  const previous = config.endpoints;
  try {
    const candidate = await configStore.previewRaw('endpoints', content);
    await endpointListeners.apply(candidate.endpoints, config.app.server);
    config = await configStore.saveRaw('endpoints', content);
  } catch (error) {
    await endpointListeners.apply(previous, config.app.server);
    throw error;
  }
}

function publicConfig(): LoadedConfig {
  return configStore.redact(config);
}

async function validateStaticNetworkTargets(
  candidate: LoadedConfig,
): Promise<void> {
  const policy = new NetworkPolicy(() => candidate.app.network);
  const validations: Array<Promise<URL>> = [];
  for (const endpoint of candidate.endpoints.httpClients) {
    validations.push(policy.assertConfiguredHttpUrl(endpoint.baseUrl));
  }
  for (const endpoint of candidate.endpoints.wsClients) {
    validations.push(policy.assertConfiguredWebSocketUrl(endpoint.url));
  }
  for (const action of candidate.actions) {
    if (
      action.type === 'send_http' &&
      !containsWorkflowExpression(action.url)
    ) {
      validations.push(policy.assertConfiguredHttpUrl(action.url));
    }
    if (
      action.type === 'send_ws' &&
      /^wss?:\/\//u.test(action.target) &&
      !containsWorkflowExpression(action.target)
    ) {
      validations.push(policy.assertConfiguredWebSocketUrl(action.target));
    }
  }
  for (const rule of candidate.rules) {
    for (const node of rule.workflow?.nodes ?? []) {
      if (node.type !== 'action') continue;
      if (
        node.action.type === 'send_http' &&
        node.action.url &&
        !containsWorkflowExpression(node.action.url)
      ) {
        validations.push(policy.assertConfiguredHttpUrl(node.action.url));
      }
      if (
        node.action.type === 'send_ws' &&
        /^wss?:\/\//u.test(node.action.target) &&
        !containsWorkflowExpression(node.action.target)
      ) {
        validations.push(
          policy.assertConfiguredWebSocketUrl(node.action.target),
        );
      }
    }
  }
  await Promise.all(validations);
}

function validateManagedStoragePaths(appConfig: AppConfig): void {
  const paths = appConfig.storage;
  resolveManagedDataPath(paths.eventLogPath, 'eventLogPath');
  resolveManagedDataPath(paths.runLogPath, 'runLogPath');
  resolveManagedDataPath(paths.auditLogPath, 'auditLogPath');
  resolveManagedDataPath(paths.schedulerStatePath, 'schedulerStatePath');
  resolveManagedDataPath(paths.configHistoryPath, 'configHistoryPath');
}

function resolveManagedDataPath(value: string, label: string): string {
  const resolved = path.resolve(rootDir, value);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error(
      `${label} must stay inside the project root: ${value}`,
    );
    Object.assign(error, {statusCode: 400});
    throw error;
  }
  return resolved;
}

function requestPermission(method: string, url: string): ApiPermission {
  const pathname = requestPath(url);
  if (pathname.startsWith('/api/config/raw')) return 'admin';
  if (pathname.startsWith('/api/config/history')) return 'admin';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return 'read';
  }
  if (
    pathname.startsWith('/api/endpoints') ||
    pathname.startsWith('/api/rules') ||
    pathname.startsWith('/api/actions') ||
    pathname.startsWith('/api/app')
  ) {
    return pathname.endsWith('/test') || pathname.endsWith('/run')
      ? 'operate'
      : 'admin';
  }
  return 'operate';
}

function requestPath(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

function safeRequestPath(url: string): string {
  const parsed = new URL(url, 'http://localhost');
  return `${parsed.pathname}${parsed.search ? '?[REDACTED]' : ''}`;
}

function isConfigDocumentName(value: string): value is ConfigDocumentName {
  return ['app', 'endpoints', 'rules', 'actions'].includes(value);
}

function requestHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function redactSensitiveHeaders(
  headers: IncomingHttpHeaders,
): IncomingHttpHeaders {
  const sensitiveNames = new Set([
    'authorization',
    'cookie',
    'proxy-authorization',
    'x-api-key',
    'x-las-token',
  ]);
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      sensitiveNames.has(name.toLowerCase()) ? '[REDACTED]' : value,
    ]),
  );
}

function messageTraceId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('traceId' in body))
    return undefined;
  const value = (body as {traceId?: unknown}).traceId;
  return typeof value === 'string' ? value : undefined;
}

function queryLimit(value: string | undefined): number {
  const parsed = Number(value ?? 100);
  return Number.isFinite(parsed)
    ? Math.min(1000, Math.max(1, Math.trunc(parsed)))
    : 100;
}

function queryScanLimit(limit: number): number {
  return Math.min(10000, Math.max(1000, limit * 20));
}

app.setErrorHandler((error, request, reply) => {
  const normalized =
    error instanceof Error ? error : new Error('Unknown request failure.');
  const errorDetail = normalized as Error & {
    statusCode?: number;
    issues?: unknown;
  };
  const explicitStatus = errorDetail.statusCode;
  const statusCode =
    explicitStatus ??
    (['ConfigDependencyError', 'ZodError', 'YAMLParseError'].includes(
      normalized.name,
    )
      ? 400
      : 500);
  if (statusCode >= 500) {
    request.log.error({error}, 'Request failed.');
  }
  const issues = Array.isArray(errorDetail.issues)
    ? configStore.redact(errorDetail.issues)
    : undefined;
  return reply.code(statusCode).send({
    error:
      statusCode >= 500
        ? 'Internal server error.'
        : configStore.redact(normalized.message),
    ...(issues ? {issues} : {}),
  });
});

await app.listen({
  host: config.app.server.host,
  port: config.app.server.port,
});
