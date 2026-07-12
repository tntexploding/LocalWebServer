import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {WebSocket, WebSocketServer} from 'ws';
import type {AppConfig, EndpointsConfig} from '@las/core';

type HttpServerEndpoint = EndpointsConfig['httpServers'][number] & {
  host: string;
  port: number;
  path: string;
};
type WsServerEndpoint = EndpointsConfig['wsServers'][number] & {
  host: string;
  port: number;
};
interface HttpEventInput {
  endpoint: HttpServerEndpoint;
  method: string;
  path: string;
  body: unknown;
  headers: IncomingHttpHeaders;
  remoteAddress?: string;
}
interface WsEventInput {
  endpoint: WsServerEndpoint;
  body: unknown;
  remoteAddress?: string;
}
interface HttpResponse {
  statusCode: number;
  body?: unknown;
}
interface ListenerGroup {
  key: string;
  host: string;
  port: number;
  httpRoutes: Map<string, HttpServerEndpoint>;
  wsRoutes: Map<string, WebSocketServer>;
}

/** Owns shared HTTP listeners and their HTTP/WebSocket endpoint routes. */
export class EndpointListenerManager {
  private readonly rawServers = new Map<string, Server>();
  private readonly controlHttpRoutes = new Map<string, HttpServerEndpoint>();
  private readonly controlWsRoutes = new Map<string, WebSocketServer>();
  private readonly clients = new Map<string, Set<WebSocket>>();
  private readonly wsClients = new Map<
    string,
    EndpointsConfig['wsClients'][number]
  >();
  private readonly groups = new Map<string, ListenerGroup>();
  private appServer: AppConfig['server'];

  constructor(
    private readonly controlServer: Server,
    appServer: AppConfig['server'],
    private readonly onHttpEvent: (input: HttpEventInput) => Promise<unknown>,
    private readonly onWsEvent: (input: WsEventInput) => Promise<void>,
  ) {
    this.appServer = appServer;
  }

  listenForControlUpgrades(): void {
    this.controlServer.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const wsServer = this.controlWsRoutes.get(pathname);

      if (!wsServer) {
        socket.destroy();
        return;
      }

      wsServer.handleUpgrade(request, socket, head, ws => {
        wsServer.emit('connection', ws, request);
      });
    });
  }

  async apply(
    endpoints: EndpointsConfig,
    appServer: AppConfig['server'],
  ): Promise<void> {
    this.appServer = appServer;
    await this.clear();

    try {
      for (const httpEndpoint of endpoints.httpServers.filter(
        endpoint => endpoint.enabled,
      )) {
        this.addHttpRoute(resolveHttpEndpoint(httpEndpoint, appServer));
      }
      for (const wsEndpoint of endpoints.wsServers.filter(
        endpoint => endpoint.enabled,
      )) {
        this.addWsRoute(resolveWsEndpoint(wsEndpoint, appServer));
      }
      for (const wsClient of endpoints.wsClients.filter(
        endpoint => endpoint.enabled,
      )) {
        this.wsClients.set(wsClient.id, wsClient);
      }
      await Promise.all(
        [...this.groups.values()].map(group => this.listen(group)),
      );
    } catch (error) {
      await this.clear();
      throw error;
    }
  }

  async clear(): Promise<void> {
    for (const wsServer of this.controlWsRoutes.values()) {
      wsServer.close();
    }
    for (const group of this.groups.values()) {
      for (const wsServer of group.wsRoutes.values()) {
        wsServer.close();
      }
    }
    for (const clients of this.clients.values()) {
      for (const client of clients) {
        client.close();
      }
    }
    await Promise.all(
      [...this.rawServers.values()].map(server => closeServer(server)),
    );
    this.rawServers.clear();
    this.controlHttpRoutes.clear();
    this.controlWsRoutes.clear();
    this.clients.clear();
    this.wsClients.clear();
    this.groups.clear();
  }

  async handleControlHttp(input: {
    method: string;
    url: string;
    body: unknown;
    headers: IncomingHttpHeaders;
    remoteAddress?: string;
  }): Promise<HttpResponse | null> {
    const pathname = new URL(input.url, 'http://localhost').pathname;
    const endpoint = this.controlHttpRoutes.get(pathname);
    if (!endpoint) {
      return null;
    }
    return this.handleHttpEndpoint(endpoint, input);
  }

  async send(target: string, payload: unknown): Promise<void> {
    const encoded = JSON.stringify(payload);
    const connectedClients = [...(this.clients.get(target) ?? [])].filter(
      client => client.readyState === WebSocket.OPEN,
    );
    for (const client of connectedClients) {
      client.send(encoded);
    }
    if (this.clients.has(target)) {
      return;
    }

    const outboundUrl = this.wsClients.get(target)?.url ?? directWsUrl(target);
    if (!outboundUrl) {
      throw new Error(`Unknown WebSocket target: ${target}`);
    }
    await sendWebSocket(outboundUrl, encoded);
  }

  wsStatus(): Array<{target: string; clients: number}> {
    return [...this.clients.entries()].map(([target, clients]) => ({
      target,
      clients: [...clients].filter(
        client => client.readyState === WebSocket.OPEN,
      ).length,
    }));
  }

  listenerStatus(): Array<{
    host: string;
    port: number;
    kind: 'control' | 'endpoint';
    httpRoutes: string[];
    wsRoutes: string[];
  }> {
    const control = {
      host: this.appServer.host,
      port: this.appServer.port,
      kind: 'control' as const,
      httpRoutes: [...this.controlHttpRoutes.keys()],
      wsRoutes: [...this.controlWsRoutes.keys()],
    };
    const endpoints = [...this.groups.values()].map(group => ({
      host: group.host,
      port: group.port,
      kind: 'endpoint' as const,
      httpRoutes: [...group.httpRoutes.keys()],
      wsRoutes: [...group.wsRoutes.keys()],
    }));
    return [control, ...endpoints];
  }

  private addHttpRoute(endpoint: HttpServerEndpoint): void {
    if (this.isControlEndpoint(endpoint.host, endpoint.port)) {
      assertUnusedRoute(this.controlHttpRoutes, endpoint);
      this.controlHttpRoutes.set(endpoint.path, endpoint);
      return;
    }
    const routes = this.groupFor(endpoint.host, endpoint.port).httpRoutes;
    assertUnusedRoute(routes, endpoint);
    routes.set(endpoint.path, endpoint);
  }

  private addWsRoute(endpoint: WsServerEndpoint): void {
    if (this.isControlEndpoint(endpoint.host, endpoint.port)) {
      assertUnusedRoute(this.controlWsRoutes, endpoint);
      this.controlWsRoutes.set(endpoint.path, this.createWsServer(endpoint));
      return;
    }
    const routes = this.groupFor(endpoint.host, endpoint.port).wsRoutes;
    assertUnusedRoute(routes, endpoint);
    routes.set(endpoint.path, this.createWsServer(endpoint));
  }

  private groupFor(host: string, port: number): ListenerGroup {
    const key = addressKey(host, port);
    const existing = this.groups.get(key);
    if (existing) {
      return existing;
    }
    const group: ListenerGroup = {
      key,
      host,
      port,
      httpRoutes: new Map(),
      wsRoutes: new Map(),
    };
    this.groups.set(key, group);
    return group;
  }

  private createWsServer(endpoint: WsServerEndpoint): WebSocketServer {
    const wsServer = new WebSocketServer({noServer: true});
    this.clients.set(endpoint.id, new Set());
    wsServer.on('connection', (socket, request) => {
      this.clients.get(endpoint.id)?.add(socket);
      socket.on('close', () => this.clients.get(endpoint.id)?.delete(socket));
      socket.on('message', async data => {
        await this.onWsEvent({
          endpoint,
          body: parseMaybeJson(data.toString('utf8')),
          remoteAddress: request.socket.remoteAddress,
        });
      });
    });
    return wsServer;
  }

  private async listen(group: ListenerGroup): Promise<void> {
    const server = createServer((request, response) => {
      void this.handleRawHttp(group, request, response);
    });
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const wsServer = group.wsRoutes.get(pathname);
      if (!wsServer) {
        socket.destroy();
        return;
      }
      wsServer.handleUpgrade(request, socket, head, ws => {
        wsServer.emit('connection', ws, request);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(group.port, group.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.rawServers.set(group.key, server);
  }

  private async handleRawHttp(
    group: ListenerGroup,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    setCorsHeaders(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const endpoint = group.httpRoutes.get(pathname);
    if (!endpoint) {
      writeJson(response, 404, {error: 'Unknown endpoint path.'});
      return;
    }

    const body = await readBody(request);
    const result = await this.handleHttpEndpoint(endpoint, {
      method: request.method ?? 'GET',
      url: request.url ?? endpoint.path,
      body,
      headers: request.headers,
      remoteAddress: request.socket.remoteAddress,
    });
    writeJson(response, result.statusCode, result.body);
  }

  private async handleHttpEndpoint(
    endpoint: HttpServerEndpoint,
    input: {
      method: string;
      url: string;
      body: unknown;
      headers: IncomingHttpHeaders;
      remoteAddress?: string;
    },
  ): Promise<HttpResponse> {
    if (input.method === 'GET' || input.method === 'HEAD') {
      return {
        statusCode: 200,
        body: {
          ok: true,
          endpointId: endpoint.id,
          host: endpoint.host,
          port: endpoint.port,
          path: endpoint.path,
        },
      };
    }

    const result = await this.onHttpEvent({
      endpoint,
      method: input.method,
      path: input.url,
      body: input.body,
      headers: input.headers,
      remoteAddress: input.remoteAddress,
    });
    return {statusCode: 200, body: result};
  }

  private isControlEndpoint(host: string, port: number): boolean {
    return host === this.appServer.host && port === this.appServer.port;
  }
}

/** Applies app-level listener defaults to an HTTP server endpoint. */
export function resolveHttpEndpoint(
  endpoint: EndpointsConfig['httpServers'][number],
  appServer: AppConfig['server'],
): HttpServerEndpoint {
  return {
    ...endpoint,
    host: endpoint.host ?? appServer.host,
    port: endpoint.port ?? appServer.port,
    path: endpoint.path ?? '/ingest',
  };
}

/** Applies app-level listener defaults to a WebSocket server endpoint. */
export function resolveWsEndpoint(
  endpoint: EndpointsConfig['wsServers'][number],
  appServer: AppConfig['server'],
): WsServerEndpoint {
  return {
    ...endpoint,
    host: endpoint.host ?? appServer.host,
    port: endpoint.port ?? appServer.port,
  };
}

/** Converts wildcard listener hosts to a loopback address for local probes. */
export function connectHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') {
    return '127.0.0.1';
  }
  return host;
}

function addressKey(host: string, port: number): string {
  return `${host}:${port}`;
}

function assertUnusedRoute(
  routes: Map<string, unknown>,
  endpoint: {id: string; host: string; port: number; path: string},
): void {
  if (routes.has(endpoint.path)) {
    throw new Error(
      `Duplicate endpoint route: ${endpoint.host}:${endpoint.port}${endpoint.path}`,
    );
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader(
    'access-control-allow-methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  );
  response.setHeader(
    'access-control-allow-headers',
    'content-type,x-las-token',
  );
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {'content-type': 'application/json'});
  response.end(JSON.stringify(body ?? null));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) {
    return undefined;
  }
  return parseMaybeJson(text);
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function directWsUrl(target: string): string | undefined {
  return /^wss?:\/\//u.test(target) ? target : undefined;
}

async function sendWebSocket(url: string, encoded: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WebSocket send timed out: ${url}`));
    }, 5000);

    socket.once('open', () => {
      socket.send(encoded, error => {
        clearTimeout(timeout);
        socket.close();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    socket.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
