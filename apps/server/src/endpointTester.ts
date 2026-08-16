import {WebSocket} from 'ws';
import type {LoadedConfig} from '@las/core';
import {
  connectHost,
  resolveHttpEndpoint,
  resolveWsEndpoint,
} from './endpointListenerManager.js';
import type {MessageTemplateDecoder} from './messageTemplateDecoder.js';
import {
  NetworkPolicy,
  readLimitedResponseText,
  safeNetworkTarget,
} from './networkPolicy.js';

/** Endpoint categories supported by the connection tester. */
export type EndpointTestKind =
  'httpServer' | 'wsServer' | 'httpClient' | 'wsClient';

/** Optional request values supplied by the WebUI connection tester. */
export interface EndpointTestOptions {
  mode?: 'probe' | 'send';
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path?: string;
  body?: unknown;
  useTemplate?: boolean;
  templateFields?: string[];
  templateValues?: Record<string, unknown>;
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
    private readonly networkPolicy: NetworkPolicy,
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
        await this.fetch(target, httpTestInit(options)),
        config.app.network.outbound.maxHttpResponseBytes,
      );
    }

    if (kind === 'wsServer') {
      const endpoint = config.endpoints.wsServers.find(item => item.id === id);
      if (!endpoint) throw new Error(`Unknown WebSocket server: ${id}`);
      assertEnabled(endpoint.enabled, `WebSocket server is disabled: ${id}`);
      const resolved = resolveWsEndpoint(endpoint, config.app.server);
      const target = `ws://${connectHost(resolved.host)}:${resolved.port}${resolved.path}`;
      await this.testWebSocket(target, options.body);
      return websocketResult(kind, id, target, startedAt);
    }

    if (kind === 'httpClient') {
      const endpoint = config.endpoints.httpClients.find(
        item => item.id === id,
      );
      if (!endpoint) throw new Error(`Unknown HTTP client: ${id}`);
      assertEnabled(endpoint.enabled, `HTTP client is disabled: ${id}`);
      const mode =
        options.mode ??
        (options.body !== undefined || options.useTemplate ? 'send' : 'probe');
      const base = new URL(endpoint.baseUrl);
      const targetUrl = new URL(
        options.path?.trim() ||
          (mode === 'send'
            ? (endpoint.test?.sendPath ?? '/')
            : (endpoint.test?.probePath ?? '/api/health')),
        endpoint.baseUrl,
      );
      if (targetUrl.origin !== base.origin) {
        throw new Error('HTTP test path must not change the client origin.');
      }
      const target = targetUrl.toString();
      const requestBody =
        mode === 'probe'
          ? undefined
          : options.body !== undefined
            ? options.body
            : options.useTemplate && endpoint.template
              ? await this.messageTemplates.materialize(
                  endpoint.template,
                  {
                    ...endpoint.templateValues,
                    ...options.templateValues,
                  },
                  options.templateFields ?? endpoint.templateFields,
                )
              : undefined;
      const method =
        options.method ??
        (mode === 'probe'
          ? 'GET'
          : (endpoint.test?.sendMethod ??
            (requestBody === undefined ? 'GET' : 'POST')));
      const response = await this.fetch(target, {
        ...httpTestInit({...options, method, body: requestBody}),
        headers: {
          ...endpoint.headers,
          ...(requestBody === undefined ||
          hasHeader(endpoint.headers ?? {}, 'content-type')
            ? {}
            : {'content-type': 'application/json'}),
        },
      });
      return httpResult(
        kind,
        id,
        target,
        startedAt,
        response,
        config.app.network.outbound.maxHttpResponseBytes,
      );
    }

    const endpoint = config.endpoints.wsClients.find(item => item.id === id);
    if (!endpoint) throw new Error(`Unknown WebSocket client: ${id}`);
    assertEnabled(endpoint.enabled, `WebSocket client is disabled: ${id}`);
    await this.testWebSocket(endpoint.url, options.body);
    return websocketResult(kind, id, endpoint.url, startedAt);
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    await this.networkPolicy.assertHttpUrl(url);
    const encodedBody = typeof init.body === 'string' ? init.body : undefined;
    this.networkPolicy.assertHttpRequestSize(encodedBody);
    return fetchWithTimeout(url, {...init, redirect: 'manual'});
  }

  private async testWebSocket(url: string, body: unknown): Promise<void> {
    await this.networkPolicy.assertWebSocketUrl(url);
    const encoded = JSON.stringify(
      body ?? {type: 'endpoint.test', at: new Date().toISOString()},
    );
    this.networkPolicy.assertWebSocketMessageSize(encoded);
    await testWebSocket(
      url,
      encoded,
      this.getConfig().app.network.outbound.maxWebSocketMessageBytes,
    );
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
  maxResponseBytes: number,
): Promise<EndpointTestResult> {
  return {
    ok: response.ok,
    kind,
    id,
    target: safeNetworkTarget(target),
    statusCode: response.status,
    responseBody: await responseSummary(response, maxResponseBytes),
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
    target: safeNetworkTarget(target),
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
  maxBytes: number,
): Promise<string | undefined> {
  const text = await readLimitedResponseText(response, maxBytes);
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

async function testWebSocket(
  url: string,
  encodedBody: string,
  maxPayload: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, {maxPayload});
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket test timed out.'));
    }, 5000);

    socket.once('open', () => {
      socket.send(encodedBody);
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
