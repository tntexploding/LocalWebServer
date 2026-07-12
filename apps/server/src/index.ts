import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {ConfigStore, ensureDataDir, JsonlStore} from '@las/storage';
import type {RawConfigFiles} from '@las/storage';
import {
  appConfigSchema,
  type ActionConfig,
  endpointsConfigSchema,
  type ActionResult,
  type AppConfig,
  type EndpointsConfig,
  type EventEnvelope,
  type RuleConfig,
} from '@las/core';
import {ActionExecutor} from './actionExecutor.js';
import {ActionQueue} from './actionQueue.js';
import {EndpointListenerManager} from './endpointListenerManager.js';
import {EndpointTester} from './endpointTester.js';
import {EventProcessor, makeEvent} from './eventProcessor.js';
import {MessageTemplateDecoder} from './messageTemplateDecoder.js';

const rootDir = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
);
const configStore = new ConfigStore(rootDir);
const messageTemplates = new MessageTemplateDecoder(rootDir);
await ensureDataDir(rootDir);

let config = await configStore.load();
const endpointTester = new EndpointTester(() => config, messageTemplates);

const eventLog = new JsonlStore<EventEnvelope>(
  path.resolve(rootDir, config.app.storage.eventLogPath),
);
const runLog = new JsonlStore<ActionResult>(
  path.resolve(rootDir, config.app.storage.runLogPath),
);

const app = fastify({logger: true});
await app.register(cors, {origin: true});

const webDist = path.join(rootDir, 'apps', 'web', 'dist');
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
        path: message.path,
        remoteAddress: message.remoteAddress,
        headers: message.headers,
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
      source: `ws.server.${message.endpoint.id}`,
      kind: 'ws.message',
      traceId: messageTraceId(message.body),
      body: message.body,
      meta: {
        remoteAddress: message.remoteAddress,
        path: message.endpoint.path,
        listener: {
          host: message.endpoint.host,
          port: message.endpoint.port,
        },
      },
    });
    await processor.receive(event);
  },
);
const executor: ActionExecutor = new ActionExecutor(
  config.app,
  (target, payload) => endpointListeners.send(target, payload),
  messageTemplates,
);
const queue: ActionQueue = new ActionQueue(
  config.app.automation.maxConcurrentActions,
  executor,
  runLog,
);
const processor: EventProcessor = new EventProcessor(eventLog, runLog, queue);
processor.updateConfig(config.rules, config.actions);

await applyEndpointServers();
endpointListeners.listenForControlUpgrades();

app.get('/api/health', async () => ({
  ok: true,
  time: new Date().toISOString(),
  ws: endpointListeners.wsStatus(),
  listeners: endpointListeners.listenerStatus(),
}));

app.get('/api/config', async () => config);

app.get('/api/config/raw', async () => configStore.loadRaw());

app.get('/api/templates', async () => messageTemplates.list());

app.put<{Body: EndpointsConfig}>('/api/endpoints', async request => {
  requireToken(request.headers['x-las-token']);
  const endpoints = endpointsConfigSchema.parse(request.body);
  await replaceEndpoints(endpoints);
  return config;
});

app.put<{Body: RuleConfig[]}>('/api/rules', async request => {
  requireToken(request.headers['x-las-token']);
  if (!Array.isArray(request.body)) {
    throw new Error('Rules payload must be an array.');
  }
  config = await configStore.saveRules(request.body);
  processor.updateConfig(config.rules, config.actions);
  return config;
});

app.put<{Body: ActionConfig[]}>('/api/actions', async request => {
  requireToken(request.headers['x-las-token']);
  if (!Array.isArray(request.body)) {
    throw new Error('Actions payload must be an array.');
  }
  config = await configStore.saveActions(request.body);
  processor.updateConfig(config.rules, config.actions);
  return config;
});

app.put<{Body: Partial<AppConfig['server']>}>(
  '/api/app/server',
  async request => {
    requireToken(request.headers['x-las-token']);
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
      config,
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
  requireToken(request.headers['x-las-token']);
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
    requireToken(request.headers['x-las-token']);
    const name = request.params.name;
    if (!['app', 'endpoints', 'rules', 'actions'].includes(name)) {
      return reply.code(404).send({error: 'Unknown config file.'});
    }
    if (name === 'endpoints') {
      await replaceRawEndpoints(request.body.content);
      return config;
    }
    config = await configStore.saveRaw(name, request.body.content);
    processor.updateConfig(config.rules, config.actions);
    queue.setMaxConcurrent(config.app.automation.maxConcurrentActions);
    return config;
  },
);

app.get<{Querystring: {limit?: string}}>('/api/events', async request => {
  return eventLog.latest(Number(request.query.limit ?? 100));
});

app.get<{Querystring: {limit?: string}}>('/api/runs', async request => {
  return runLog.latest(Number(request.query.limit ?? 100));
});

app.get('/api/queue', async () => queue.snapshot());

app.post<{Params: {id: string}}>(
  '/api/queue/:id/cancel',
  async (request, reply) => {
    requireToken(request.headers['x-las-token']);
    const result = await queue.cancel(request.params.id);
    if (!result) {
      return reply.code(404).send({error: 'Unknown run.'});
    }
    return result;
  },
);

app.post<{Params: {id: string}}>(
  '/api/events/:id/replay',
  async (request, reply) => {
    requireToken(request.headers['x-las-token']);
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
  requireToken(request.headers['x-las-token']);
  const event = makeEvent({
    source: 'ui.manual',
    kind: 'http.request',
    body: {actionId: request.params.id},
    meta: {method: request.method, path: request.url},
  });
  return processor.runAction(request.params.id, event);
});

app.post<{Body: Partial<EventEnvelope>}>('/api/rules/test', async request => {
  requireToken(request.headers['x-las-token']);
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
    requireToken(request.headers['x-las-token']);
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

function requireToken(value: string | string[] | undefined): void {
  const token = Array.isArray(value) ? value[0] : value;
  if (token !== config.app.security.apiToken) {
    const error = new Error('Invalid x-las-token.');
    Object.assign(error, {statusCode: 401});
    throw error;
  }
}

async function applyEndpointServers(): Promise<void> {
  await endpointListeners.apply(config.endpoints, config.app.server);
}

async function replaceEndpoints(endpoints: EndpointsConfig): Promise<void> {
  const previous = config.endpoints;
  try {
    await endpointListeners.apply(endpoints, config.app.server);
    config = await configStore.saveEndpoints(endpoints);
  } catch (error) {
    await endpointListeners.apply(previous, config.app.server);
    throw error;
  }
}

async function replaceRawEndpoints(content: string): Promise<void> {
  const previousRaw = (await configStore.loadRaw()).endpoints;
  const previous = config.endpoints;
  try {
    config = await configStore.saveRaw('endpoints', content);
    await endpointListeners.apply(config.endpoints, config.app.server);
  } catch (error) {
    config = await configStore.saveRaw('endpoints', previousRaw);
    await endpointListeners.apply(previous, config.app.server);
    throw error;
  }
}

function requestHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function messageTraceId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('traceId' in body))
    return undefined;
  const value = (body as {traceId?: unknown}).traceId;
  return typeof value === 'string' ? value : undefined;
}

await app.listen({
  host: config.app.server.host,
  port: config.app.server.port,
});
