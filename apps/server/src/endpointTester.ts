import {WebSocket} from 'ws';
import type {LoadedConfig} from '@las/core';
import {
  connectHost,
  resolveHttpEndpoint,
  resolveWsEndpoint,
} from './endpointListenerManager.js';
import type {MessageTemplateDecoder} from './messageTemplateDecoder.js';

/** Endpoint categories supported by the connection tester. */
export type EndpointTestKind =
  'httpServer' | 'wsServer' | 'httpClient' | 'wsClient';

/** Optional request values supplied by the WebUI connection tester. */
export interface EndpointTestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: string;
  body?: unknown;
  useTemplate?: boolean;
}

/** Result of one HTTP or WebSocket endpoint probe. */
export interface EndpointTestResult {
  ok: boolean;
  kind: EndpointTestKind;
  id: string;
  target?: string;
  statusCode?: number;
  responseBody?: string;
  durationMs: number;
  message: string;
}

/** Performs real network probes against the currently loaded endpoint config. */
export class EndpointTester {
  constructor(
    private readonly getConfig: () => LoadedConfig,
    private readonly messageTemplates: MessageTemplateDecoder,
  ) {}

  async test(
    kind: EndpointTestKind,
    id: string,
    options: EndpointTestOptions = {},
  ): Promise<EndpointTestResult> {
    const startedAt = Date.now();
    try {
      return await this.run(kind, id, options, startedAt);
    } catch (error) {
      return {
        ok: false,
        kind,
        id,
        durationMs: Date.now() - startedAt,
        message: (error as Error).message,
      };
    }
  }

  private async run(
    kind: EndpointTestKind,
    id: string,
    options: EndpointTestOptions,
    startedAt: number,
  ): Promise<EndpointTestResult> {
    const config = this.getConfig();
    if (kind === 'httpServer') {
      const endpoint = config.endpoints.httpServers.find(
        item => item.id === id,
      );
      if (!endpoint) throw new Error(`Unknown HTTP server: ${id}`);
      assertEnabled(endpoint.enabled, `HTTP server is disabled: ${id}`);
      const resolved = resolveHttpEndpoint(endpoint, config.app.server);
      const target = `http://${connectHost(resolved.host)}:${resolved.port}${resolved.path}`;
      return httpResult(
        kind,
        id,
        target,
        startedAt,
        await fetchWithTimeout(target, httpTestInit(options)),
      );
    }

    if (kind === 'wsServer') {
      const endpoint = config.endpoints.wsServers.find(item => item.id === id);
      if (!endpoint) throw new Error(`Unknown WebSocket server: ${id}`);
      assertEnabled(endpoint.enabled, `WebSocket server is disabled: ${id}`);
      const resolved = resolveWsEndpoint(endpoint, config.app.server);
      const target = `ws://${connectHost(resolved.host)}:${resolved.port}${resolved.path}`;
      await testWebSocket(target, options.body);
      return websocketResult(kind, id, target, startedAt);
    }

    if (kind === 'httpClient') {
      const endpoint = config.endpoints.httpClients.find(
        item => item.id === id,
      );
      if (!endpoint) throw new Error(`Unknown HTTP client: ${id}`);
      assertEnabled(endpoint.enabled, `HTTP client is disabled: ${id}`);
      const target = new URL(
        options.path?.trim() || '/api/health',
        endpoint.baseUrl,
      ).toString();
      const requestBody =
        options.body !== undefined
          ? options.body
          : options.useTemplate && endpoint.template
            ? await this.messageTemplates.materialize(
                endpoint.template,
                endpoint.templateValues ?? {},
                endpoint.templateFields,
              )
            : undefined;
      const response = await fetchWithTimeout(target, {
        ...httpTestInit({...options, body: requestBody}),
        headers: {
          ...endpoint.headers,
          ...(requestBody === undefined ||
          hasHeader(endpoint.headers ?? {}, 'content-type')
            ? {}
            : {'content-type': 'application/json'}),
        },
      });
      return httpResult(kind, id, target, startedAt, response);
    }

    const endpoint = config.endpoints.wsClients.find(item => item.id === id);
    if (!endpoint) throw new Error(`Unknown WebSocket client: ${id}`);
    assertEnabled(endpoint.enabled, `WebSocket client is disabled: ${id}`);
    await testWebSocket(endpoint.url, options.body);
    return websocketResult(kind, id, endpoint.url, startedAt);
  }
}

function assertEnabled(enabled: boolean, message: string): void {
  if (!enabled) throw new Error(message);
}

function httpTestInit(options: EndpointTestOptions): RequestInit {
  const method =
    options.method ?? (options.body === undefined ? 'GET' : 'POST');
  return {
    method,
    headers:
      options.body === undefined
        ? undefined
        : {'content-type': 'application/json'},
    body:
      method === 'GET' || options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
  };
}

async function httpResult(
  kind: EndpointTestKind,
  id: string,
  target: string,
  startedAt: number,
  response: Response,
): Promise<EndpointTestResult> {
  return {
    ok: response.ok,
    kind,
    id,
    target,
    statusCode: response.status,
    responseBody: await responseSummary(response),
    durationMs: Date.now() - startedAt,
    message: `HTTP ${response.status} ${response.statusText}`,
  };
}

function websocketResult(
  kind: EndpointTestKind,
  id: string,
  target: string,
  startedAt: number,
): EndpointTestResult {
  return {
    ok: true,
    kind,
    id,
    target,
    durationMs: Date.now() - startedAt,
    message: 'WebSocket connection opened.',
  };
}

function hasHeader(
  headers: Record<string, string>,
  headerName: string,
): boolean {
  return Object.keys(headers).some(name => name.toLowerCase() === headerName);
}

async function responseSummary(
  response: Response,
): Promise<string | undefined> {
  const text = await response.text();
  return text ? text.slice(0, 2000) : undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, {...init, signal: controller.signal});
  } finally {
    clearTimeout(timeout);
  }
}

async function testWebSocket(url: string, body?: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket test timed out.'));
    }, 5000);

    socket.once('open', () => {
      socket.send(
        JSON.stringify(
          body ?? {type: 'endpoint.test', at: new Date().toISOString()},
        ),
      );
      clearTimeout(timeout);
      socket.close();
      resolve();
    });
    socket.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
