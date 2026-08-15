import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {WebSocket, WebSocketServer} from 'ws';
import type {AppConfig, EndpointsConfig} from '@las/core';
import {
  NetworkPolicy,
  NetworkPolicyError,
  safeNetworkTarget,
} from './networkPolicy.js';

type HttpServerEndpoint = EndpointsConfig['httpServers'][number] & {
  host: string;
  port: number;
  path: string;
};
type WsServerEndpoint = EndpointsConfig['wsServers'][number] & {
  host: string;
  port: number;
};
type WsClientEndpoint = EndpointsConfig['wsClients'][number];
interface HttpEventInput {
  endpoint: HttpServerEndpoint;
  method: string;
  path: string;
  body: unknown;
  headers: IncomingHttpHeaders;
  remoteAddress?: string;
}
interface WsEventInput {
  endpoint: WsServerEndpoint | WsClientEndpoint;
  role: 'server' | 'client';
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

type OutboundWsConnectionStatus =
  'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

interface OutboundWsWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  abort?: () => void;
}

interface OutboundWsConnection {
  endpoint: WsClientEndpoint;
  socket?: WebSocket;
  status: OutboundWsConnectionStatus;
  reconnectAttempt: number;
  reconnectTimer?: NodeJS.Timeout;
  heartbeatTimer?: NodeJS.Timeout;
  alive: boolean;
  generation: number;
  lastConnectedAt?: string;
  lastMessageAt?: string;
  lastError?: string;
  waiters: Set<OutboundWsWaiter>;
}

export interface WsConnectionStatus {
  target: string;
  role: 'server' | 'client';
  clients: number;
  state: 'open' | 'closed' | OutboundWsConnectionStatus;
  url?: string;
  reconnectAttempt?: number;
  lastConnectedAt?: string;
  lastMessageAt?: string;
  error?: string;
}

/** Owns shared HTTP listeners and their HTTP/WebSocket endpoint routes. */
export class EndpointListenerManager {
  private readonly rawServers = new Map<string, Server>();
  private readonly controlHttpRoutes = new Map<string, HttpServerEndpoint>();
  private readonly controlWsRoutes = new Map<string, WebSocketServer>();
  private readonly clients = new Map<string, Set<WebSocket>>();
  private readonly wsClients = new Map<string, WsClientEndpoint>();
  private readonly outboundWs = new Map<string, OutboundWsConnection>();
  private readonly groups = new Map<string, ListenerGroup>();
  private appServer: AppConfig['server'];
  private generation = 0;

  constructor(
    private readonly controlServer: Server,
    appServer: AppConfig['server'],
    private readonly onHttpEvent: (input: HttpEventInput) => Promise<unknown>,
    private readonly onWsEvent: (input: WsEventInput) => Promise<void>,
    private readonly networkPolicy: NetworkPolicy,
    private readonly onError: (error: unknown, context: string) => void = () =>
      undefined,
  ) {
    this.appServer = appServer;
  }

  listenForControlUpgrades(): void {
    this.controlServer.on('upgrade', (request, socket, head) => {
      if (!this.isUpgradeAllowed(request)) {
        rejectUpgrade(socket);
        return;
      }
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
    await Promise.all(
      endpoints.wsClients
        .filter(endpoint => endpoint.enabled)
        .map(endpoint =>
          this.networkPolicy.assertConfiguredWebSocketUrl(endpoint.url),
        ),
    );
    this.appServer = appServer;
    await this.clear();
    const generation = this.generation;

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
      for (const wsClient of this.wsClients.values()) {
        this.createOutboundConnection(wsClient, generation);
      }
    } catch (error) {
      await this.clear();
      throw error;
    }
  }

  async clear(): Promise<void> {
    this.generation += 1;
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
    for (const connection of this.outboundWs.values()) {
      this.closeOutboundConnection(connection);
    }
    await Promise.all(
      [...this.rawServers.values()].map(server => closeServer(server)),
    );
    this.rawServers.clear();
    this.controlHttpRoutes.clear();
    this.controlWsRoutes.clear();
    this.clients.clear();
    this.wsClients.clear();
    this.outboundWs.clear();
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
    if (!this.networkPolicy.isInboundSourceAllowed(input.remoteAddress)) {
      return {
        statusCode: 403,
        body: {error: 'Endpoint source is not allowed.'},
      };
    }
    if (
      !this.networkPolicy.isInboundOriginAllowed(
        firstHeaderValue(input.headers.origin),
      )
    ) {
      return {
        statusCode: 403,
        body: {error: 'Endpoint origin is not allowed.'},
      };
    }
    return this.handleHttpEndpoint(endpoint, input);
  }

  async send(
    target: string,
    payload: unknown,
    options: {timeoutMs?: number; signal?: AbortSignal} = {},
  ): Promise<void> {
    const encoded = JSON.stringify(payload);
    this.networkPolicy.assertWebSocketMessageSize(encoded);
    const connectedClients = [...(this.clients.get(target) ?? [])].filter(
      client => client.readyState === WebSocket.OPEN,
    );
    for (const client of connectedClients) {
      await sendOnOpenSocket(client, encoded, options);
    }
    if (this.clients.has(target)) {
      if (connectedClients.length === 0) {
        throw new Error(`WebSocket server endpoint has no clients: ${target}`);
      }
      return;
    }

    const outbound = this.outboundWs.get(target);
    if (outbound) {
      await this.waitForOutboundConnection(outbound, options);
      if (!outbound.socket || outbound.socket.readyState !== WebSocket.OPEN) {
        throw new Error(`WebSocket client is not connected: ${target}`);
      }
      await sendOnOpenSocket(outbound.socket, encoded, options);
      return;
    }

    const outboundUrl = directWsUrl(target);
    if (!outboundUrl) throw new Error(`Unknown WebSocket target: ${target}`);
    await this.networkPolicy.assertWebSocketUrl(outboundUrl);
    await sendWebSocket(
      outboundUrl,
      encoded,
      options,
      this.networkPolicy.outboundLimits().maxWebSocketMessageBytes,
    );
  }

  wsStatus(): WsConnectionStatus[] {
    const servers: WsConnectionStatus[] = [...this.clients.entries()].map(
      ([target, clients]) => {
        const connected = [...clients].filter(
          client => client.readyState === WebSocket.OPEN,
        ).length;
        return {
          target,
          role: 'server',
          clients: connected,
          state: connected > 0 ? 'open' : 'closed',
        };
      },
    );
    const clients: WsConnectionStatus[] = [...this.outboundWs.values()].map(
      connection => ({
        target: connection.endpoint.id,
        role: 'client',
        clients: connection.status === 'open' ? 1 : 0,
        state: connection.status,
        url: safeNetworkTarget(connection.endpoint.url),
        reconnectAttempt: connection.reconnectAttempt,
        lastConnectedAt: connection.lastConnectedAt,
        lastMessageAt: connection.lastMessageAt,
        error: connection.lastError,
      }),
    );
    return [...servers, ...clients];
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
    const wsServer = new WebSocketServer({
      noServer: true,
      maxPayload: this.networkPolicy.inboundLimits().maxWebSocketMessageBytes,
    });
    this.clients.set(endpoint.id, new Set());
    wsServer.on('connection', (socket, request) => {
      const clients = this.clients.get(endpoint.id);
      if (
        !clients ||
        clients.size >=
          this.networkPolicy.inboundLimits().maxWebSocketConnectionsPerEndpoint
      ) {
        socket.close(1013, 'Connection limit reached.');
        return;
      }
      clients.add(socket);
      socket.on('close', () => this.clients.get(endpoint.id)?.delete(socket));
      socket.on('message', data => {
        void this.onWsEvent({
          endpoint,
          role: 'server',
          body: parseMaybeJson(data.toString('utf8')),
          remoteAddress: request.socket.remoteAddress,
        }).catch(error => this.onError(error, `ws.server.${endpoint.id}`));
      });
    });
    return wsServer;
  }

  private createOutboundConnection(
    endpoint: WsClientEndpoint,
    generation: number,
  ): void {
    const connection: OutboundWsConnection = {
      endpoint,
      status: 'closed',
      reconnectAttempt: 0,
      alive: true,
      generation,
      waiters: new Set(),
    };
    this.outboundWs.set(endpoint.id, connection);
    void this.connectOutbound(connection);
  }

  private async connectOutbound(
    connection: OutboundWsConnection,
  ): Promise<void> {
    if (
      connection.generation !== this.generation ||
      connection.socket?.readyState === WebSocket.OPEN ||
      connection.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = undefined;
    }
    connection.status =
      connection.reconnectAttempt > 0 ? 'reconnecting' : 'connecting';
    try {
      await this.networkPolicy.assertWebSocketUrl(connection.endpoint.url);
    } catch (error) {
      connection.status = 'error';
      connection.lastError = errorMessage(error);
      this.onError(error, `ws.client.${connection.endpoint.id}`);
      this.rejectOutboundWaiters(connection, asError(error));
      if (!(error instanceof NetworkPolicyError)) {
        this.scheduleReconnect(connection);
      }
      return;
    }
    const socket = new WebSocket(connection.endpoint.url, {
      maxPayload: this.networkPolicy.outboundLimits().maxWebSocketMessageBytes,
    });
    connection.socket = socket;

    socket.on('open', () => {
      if (connection.generation !== this.generation) {
        socket.close();
        return;
      }
      connection.status = 'open';
      connection.reconnectAttempt = 0;
      connection.lastConnectedAt = new Date().toISOString();
      connection.lastError = undefined;
      connection.alive = true;
      this.startHeartbeat(connection);
      this.resolveOutboundWaiters(connection);
    });
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', data => {
      connection.lastMessageAt = new Date().toISOString();
      void this.onWsEvent({
        endpoint: connection.endpoint,
        role: 'client',
        body: parseMaybeJson(data.toString('utf8')),
      }).catch(error => {
        connection.lastError = errorMessage(error);
        this.onError(error, `ws.client.${connection.endpoint.id}`);
      });
    });
    socket.on('error', error => {
      connection.status = 'error';
      connection.lastError = error.message;
      this.onError(error, `ws.client.${connection.endpoint.id}`);
    });
    socket.on('close', () => {
      if (connection.socket === socket) connection.socket = undefined;
      this.stopHeartbeat(connection);
      if (connection.generation !== this.generation) return;
      connection.status = 'closed';
      this.scheduleReconnect(connection);
    });
  }

  private scheduleReconnect(connection: OutboundWsConnection): void {
    const reconnect = connection.endpoint.reconnect ?? {
      enabled: true,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
    };
    if (!reconnect.enabled || connection.generation !== this.generation) {
      return;
    }
    connection.reconnectAttempt += 1;
    connection.status = 'reconnecting';
    const delay = Math.min(
      reconnect.maxDelayMs,
      reconnect.initialDelayMs *
        reconnect.backoffMultiplier ** (connection.reconnectAttempt - 1),
    );
    connection.reconnectTimer = setTimeout(
      () => void this.connectOutbound(connection),
      delay,
    );
    connection.reconnectTimer.unref();
  }

  private startHeartbeat(connection: OutboundWsConnection): void {
    this.stopHeartbeat(connection);
    const interval = connection.endpoint.heartbeatIntervalMs;
    if (!interval) return;
    connection.heartbeatTimer = setInterval(() => {
      const socket = connection.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (!connection.alive) {
        connection.lastError = 'WebSocket heartbeat timed out.';
        socket.terminate();
        return;
      }
      connection.alive = false;
      socket.ping();
    }, interval);
    connection.heartbeatTimer.unref();
  }

  private stopHeartbeat(connection: OutboundWsConnection): void {
    if (connection.heartbeatTimer) clearInterval(connection.heartbeatTimer);
    connection.heartbeatTimer = undefined;
  }

  private closeOutboundConnection(connection: OutboundWsConnection): void {
    if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
    this.stopHeartbeat(connection);
    connection.socket?.removeAllListeners();
    connection.socket?.close();
    connection.status = 'closed';
    this.rejectOutboundWaiters(
      connection,
      new Error(`WebSocket client stopped: ${connection.endpoint.id}`),
    );
  }

  private async waitForOutboundConnection(
    connection: OutboundWsConnection,
    options: {timeoutMs?: number; signal?: AbortSignal},
  ): Promise<void> {
    if (connection.socket?.readyState === WebSocket.OPEN) return;
    options.signal?.throwIfAborted();
    void this.connectOutbound(connection);
    const timeoutMs = options.timeoutMs ?? 10000;
    await new Promise<void>((resolve, reject) => {
      const waiter: OutboundWsWaiter = {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: error => {
          cleanup();
          reject(error);
        },
        timer: setTimeout(() => {
          waiter.reject(
            new Error(
              `WebSocket connection timed out after ${timeoutMs}ms: ${connection.endpoint.id}`,
            ),
          );
        }, timeoutMs),
      };
      const cleanup = () => {
        clearTimeout(waiter.timer);
        connection.waiters.delete(waiter);
        if (waiter.abort) {
          options.signal?.removeEventListener('abort', waiter.abort);
        }
      };
      waiter.abort = () => waiter.reject(abortReason(options.signal?.reason));
      connection.waiters.add(waiter);
      options.signal?.addEventListener('abort', waiter.abort, {once: true});
      if (options.signal?.aborted) waiter.abort();
    });
  }

  private resolveOutboundWaiters(connection: OutboundWsConnection): void {
    for (const waiter of [...connection.waiters]) waiter.resolve();
  }

  private rejectOutboundWaiters(
    connection: OutboundWsConnection,
    error: Error,
  ): void {
    for (const waiter of [...connection.waiters]) waiter.reject(error);
  }

  private async listen(group: ListenerGroup): Promise<void> {
    const server = createServer((request, response) => {
      void this.handleRawHttp(group, request, response).catch(error => {
        this.onError(error, `http.listener.${group.key}`);
        if (!response.headersSent) {
          const statusCode = requestErrorStatus(error);
          writeJson(response, statusCode, {
            error:
              statusCode >= 500
                ? 'Endpoint processing failed.'
                : errorMessage(error),
          });
        } else {
          response.destroy(error instanceof Error ? error : undefined);
        }
      });
    });
    const inbound = this.networkPolicy.inboundLimits();
    server.requestTimeout = inbound.requestTimeoutMs;
    server.headersTimeout = inbound.headersTimeoutMs;
    server.keepAliveTimeout = inbound.keepAliveTimeoutMs;
    server.maxHeadersCount = inbound.maxHeadersCount;
    server.on('upgrade', (request, socket, head) => {
      if (!this.isUpgradeAllowed(request)) {
        rejectUpgrade(socket);
        return;
      }
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
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const endpoint = group.httpRoutes.get(pathname);
    if (!endpoint) {
      writeJson(response, 404, {error: 'Unknown endpoint path.'});
      return;
    }
    if (
      !this.networkPolicy.isInboundSourceAllowed(request.socket.remoteAddress)
    ) {
      writeJson(response, 403, {error: 'Endpoint source is not allowed.'});
      return;
    }
    const origin = firstHeaderValue(request.headers.origin);
    if (!this.networkPolicy.isInboundOriginAllowed(origin)) {
      writeJson(response, 403, {error: 'Endpoint origin is not allowed.'});
      return;
    }
    setCorsHeaders(response, origin);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const body = await readBody(
      request,
      this.networkPolicy.inboundLimits().maxHttpBodyBytes,
    );
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

  private isUpgradeAllowed(request: IncomingMessage): boolean {
    return (
      this.networkPolicy.isInboundSourceAllowed(request.socket.remoteAddress) &&
      this.networkPolicy.isInboundOriginAllowed(
        firstHeaderValue(request.headers.origin),
      )
    );
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
    path: endpoint.path,
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

function setCorsHeaders(
  response: ServerResponse,
  origin: string | undefined,
): void {
  if (origin) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
  }
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
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body ?? null));
}

async function readBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new EndpointRequestError(
      413,
      `HTTP request body exceeds the ${maxBytes} byte limit.`,
    );
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const encoded = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += encoded.byteLength;
    if (total > maxBytes) {
      throw new EndpointRequestError(
        413,
        `HTTP request body exceeds the ${maxBytes} byte limit.`,
      );
    }
    chunks.push(encoded);
  }
  const text = Buffer.concat(chunks, total).toString('utf8');
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

async function sendWebSocket(
  url: string,
  encoded: string,
  options: {timeoutMs?: number; signal?: AbortSignal},
  maxPayload: number,
): Promise<void> {
  options.signal?.throwIfAborted();
  const socket = new WebSocket(url, {maxPayload});
  try {
    await waitForSocketOpen(socket, safeNetworkTarget(url), options);
    await sendOnOpenSocket(socket, encoded, options);
  } finally {
    socket.close();
  }
}

function waitForSocketOpen(
  socket: WebSocket,
  label: string,
  options: {timeoutMs?: number; signal?: AbortSignal},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('open', opened);
      socket.off('error', failed);
      options.signal?.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve();
    };
    const opened = () => finish();
    const failed = (error: Error) => finish(error);
    const aborted = () => finish(abortReason(options.signal?.reason));
    const timer = setTimeout(
      () => finish(new Error(`WebSocket connection timed out: ${label}`)),
      timeoutMs,
    );
    socket.once('open', opened);
    socket.once('error', failed);
    options.signal?.addEventListener('abort', aborted, {once: true});
    if (options.signal?.aborted) aborted();
  });
}

function sendOnOpenSocket(
  socket: WebSocket,
  encoded: string,
  options: {timeoutMs?: number; signal?: AbortSignal},
): Promise<void> {
  options.signal?.throwIfAborted();
  if (socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('WebSocket is not open.'));
  }
  const timeoutMs = options.timeoutMs ?? 10000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve();
    };
    const aborted = () => finish(abortReason(options.signal?.reason));
    const timer = setTimeout(
      () => finish(new Error(`WebSocket send timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
    options.signal?.addEventListener('abort', aborted, {once: true});
    socket.send(encoded, error => finish(error ?? undefined));
    if (options.signal?.aborted) aborted();
  });
}

function abortReason(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error(typeof reason === 'string' ? reason : 'Operation cancelled.');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class EndpointRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'EndpointRequestError';
  }
}

function requestErrorStatus(error: unknown): number {
  const statusCode = (error as {statusCode?: unknown})?.statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600
    ? statusCode
    : 500;
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function rejectUpgrade(socket: {end(data?: string): unknown}): void {
  socket.end(
    'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
