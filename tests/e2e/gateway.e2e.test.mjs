import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {WebSocketServer} from 'ws';
import {
  allocatePort,
  apiFetch,
  baseAppConfig,
  createTestProject,
  startServer,
  testTokens,
  waitFor,
} from '../support/testProject.mjs';

test(
  'runs the public HTTP/template/workflow/WS/config/security chain',
  {timeout: 60000},
  async t => {
    const [controlPort, endpointPort, sinkPort, wsPort] = await Promise.all([
      allocatePort(),
      allocatePort(),
      allocatePort(),
      allocatePort(),
    ]);
    const sinkRequests = [];
    const sink = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      sinkRequests.push({url: request.url, body});
      if (request.url === '/slow') {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      response.writeHead(200, {'content-type': 'application/json'});
      response.end('{"ok":true}');
    });
    await new Promise(resolve => sink.listen(sinkPort, '127.0.0.1', resolve));

    const wsConnections = [];
    const wsMessages = [];
    const wsServer = new WebSocketServer({host: '127.0.0.1', port: wsPort});
    wsServer.on('connection', socket => {
      wsConnections.push(socket);
      socket.on('message', value => wsMessages.push(String(value)));
    });
    let project;
    let runtime;
    t.after(async () => {
      await runtime?.stop();
      for (const socket of wsConnections) socket.terminate();
      await new Promise(resolve => wsServer.close(resolve));
      sink.closeAllConnections();
      await new Promise(resolve => sink.close(resolve));
      await project?.dispose();
    });

    const appConfig = baseAppConfig(controlPort);
    appConfig.network.inbound.maxHttpBodyBytes = 1024;
    appConfig.network.outbound.allowedPorts = [
      controlPort,
      endpointPort,
      sinkPort,
      wsPort,
    ];
    project = await createTestProject({
      app: appConfig,
      endpoints: {
        version: 1,
        httpServers: [
          {
            id: 'inbound',
            enabled: true,
            host: '127.0.0.1',
            port: endpointPort,
            path: '/message',
            template: 'e2e.json',
          },
        ],
        wsServers: [],
        httpClients: [],
        wsClients: [
          {
            id: 'outbound-ws',
            enabled: true,
            url: `ws://127.0.0.1:${wsPort}`,
            reconnect: {
              enabled: true,
              initialDelayMs: 100,
              maxDelayMs: 500,
              backoffMultiplier: 2,
            },
          },
        ],
      },
      actions: {
        version: 1,
        actions: [
          {
            id: 'forward',
            type: 'send_http',
            method: 'POST',
            url: `http://127.0.0.1:${sinkPort}/forward?access=\${secret:apiToken}`,
            headers: {'content-type': 'application/json'},
            body: {received: '${{ trigger.body.command }}'},
          },
          {
            id: 'slow',
            type: 'send_http',
            method: 'POST',
            url: `http://127.0.0.1:${sinkPort}/slow`,
            body: {slow: true},
          },
        ],
      },
      rules: {
        version: 1,
        rules: [messageWorkflow()],
      },
      templates: {'e2e.json': messageTemplate()},
    });
    runtime = await startServer(project.root, controlPort);

    const endpointUrl = `http://127.0.0.1:${endpointPort}/message`;
    assert.equal(
      (
        await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://attacker.example',
          },
          body: JSON.stringify({command: 'hello'}),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(endpointUrl, {
          method: 'POST',
          headers: {'content-type': 'text/plain'},
          body: 'x'.repeat(1025),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await fetch(`${runtime.baseUrl}/api/health`, {
          headers: {origin: 'https://attacker.example'},
        })
      ).status,
      403,
    );

    assert.equal((await fetch(`${runtime.baseUrl}/api/config`)).status, 401);
    assert.equal(
      (
        await apiFetch(runtime.baseUrl, '/api/actions/slow/run', {
          method: 'POST',
          token: testTokens.read,
        })
      ).status,
      403,
    );

    const inbound = await fetch(`http://127.0.0.1:${endpointPort}/message`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({command: 'hello', token: testTokens.admin}),
    });
    assert.equal(inbound.status, 200);
    await waitFor(() =>
      sinkRequests.some(item => item.url?.startsWith('/forward')),
    );
    assert.deepEqual(
      JSON.parse(
        sinkRequests.find(item => item.url?.startsWith('/forward')).body,
      ),
      {received: 'hello'},
    );

    const events = await (
      await apiFetch(runtime.baseUrl, '/api/events?limit=20')
    ).json();
    const receivedEvent = events.find(
      event => event.source === 'http.server.inbound',
    );
    assert.equal(receivedEvent.meta.decoded.matched, true);
    assert.equal(receivedEvent.meta.decoded.values.command, 'hello');
    assert.equal(receivedEvent.body.token, '[REDACTED]');
    const runs = await (
      await apiFetch(runtime.baseUrl, '/api/runs?limit=30')
    ).json();
    assert.ok(
      runs.some(
        run => run.ruleId === 'message-flow' && run.detail?.kind === 'workflow',
      ),
    );
    const persistedEvents = await readFile(
      path.join(project.root, 'data', 'events.jsonl'),
      'utf8',
    );
    const persistedRuns = await readFile(
      path.join(project.root, 'data', 'runs.jsonl'),
      'utf8',
    );
    assert.equal(persistedEvents.includes(testTokens.admin), false);
    assert.equal(persistedRuns.includes(testTokens.admin), false);

    await waitFor(() => wsConnections.length > 0);
    const wsSend = await apiFetch(runtime.baseUrl, '/api/ws/outbound-ws/send', {
      method: 'POST',
      token: testTokens.operator,
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({outbound: true}),
    });
    assert.equal(wsSend.status, 200);
    await waitFor(() => wsMessages.length > 0);
    assert.deepEqual(JSON.parse(wsMessages[0]), {outbound: true});
    wsConnections[0].send(JSON.stringify({inbound: true}));
    await waitFor(async () => {
      const response = await apiFetch(
        runtime.baseUrl,
        '/api/events?source=ws.client.outbound-ws',
      );
      const rows = await response.json();
      return rows.some(event => event.body?.inbound === true);
    });

    const slowRequests = Array.from({length: 4}, () =>
      apiFetch(runtime.baseUrl, '/api/actions/slow/run', {
        method: 'POST',
        token: testTokens.operator,
      }),
    );
    const activeCount = await waitFor(async () => {
      const queue = await (
        await apiFetch(runtime.baseUrl, '/api/queue', {
          token: testTokens.read,
        })
      ).json();
      return queue.running.length >= 2 ? queue.running.length : undefined;
    });
    assert.equal(activeCount, 2);
    assert.ok((await Promise.all(slowRequests)).every(response => response.ok));

    const rawResponse = await apiFetch(runtime.baseUrl, '/api/config/raw');
    const raw = await rawResponse.json();
    assert.equal(
      (await apiFetch(runtime.baseUrl, '/api/config/raw', {token: ''})).status,
      401,
    );
    const endpoints = JSON.parse(raw.endpoints);
    endpoints.httpServers[0].description = 'updated in e2e';
    const validSave = await apiFetch(
      runtime.baseUrl,
      '/api/config/raw/endpoints',
      {
        method: 'PUT',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({content: JSON.stringify(endpoints)}),
      },
    );
    assert.equal(validSave.status, 200);
    const invalid = structuredClone(endpoints);
    invalid.httpServers.push({...invalid.httpServers[0]});
    const invalidSave = await apiFetch(
      runtime.baseUrl,
      '/api/config/raw/endpoints',
      {
        method: 'PUT',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({content: JSON.stringify(invalid)}),
      },
    );
    assert.equal(invalidSave.status, 400);
    const afterInvalid = await (
      await apiFetch(runtime.baseUrl, '/api/config/raw')
    ).json();
    assert.equal(JSON.parse(afterInvalid.endpoints).httpServers.length, 1);

    const history = await (
      await apiFetch(runtime.baseUrl, '/api/config/history?name=endpoints')
    ).json();
    assert.ok(history.length >= 1);
    const restore = await apiFetch(
      runtime.baseUrl,
      `/api/config/history/endpoints/${encodeURIComponent(history[0].id)}/restore`,
      {method: 'POST'},
    );
    assert.equal(restore.status, 200);
    const restored = await (
      await apiFetch(runtime.baseUrl, '/api/config/raw')
    ).json();
    assert.equal(
      JSON.parse(restored.endpoints).httpServers[0].description,
      undefined,
    );

    const deniedOrigin = await apiFetch(runtime.baseUrl, '/api/config', {
      token: testTokens.read,
      headers: {origin: 'https://not-allowed.example'},
    });
    assert.equal(deniedOrigin.headers.get('access-control-allow-origin'), null);
    const allowedOrigin = await apiFetch(runtime.baseUrl, '/api/config', {
      token: testTokens.read,
      headers: {origin: 'http://127.0.0.1:4177'},
    });
    assert.equal(
      allowedOrigin.headers.get('access-control-allow-origin'),
      'http://127.0.0.1:4177',
    );

    const auditPath = path.join(project.root, 'data', 'security-audit.jsonl');
    const audit = await waitFor(async () => {
      const content = await readFile(auditPath, 'utf8').catch(() => '');
      return content.includes('"outcome":"denied"') ? content : undefined;
    });
    assert.equal(audit.includes(testTokens.admin), false);
    assert.equal(audit.includes('command'), false);
  },
);

function messageWorkflow() {
  return {
    id: 'message-flow',
    enabled: true,
    workflow: {
      version: '1.0',
      startNodeId: 'trigger',
      nodes: [
        {
          id: 'trigger',
          type: 'trigger',
          label: 'Message',
          trigger: {
            type: 'event',
            event: {
              source: 'http.server.inbound',
              kind: 'http.request',
              template: 'e2e.json',
              match: {jsonPath: '$.body.command', equals: 'hello'},
            },
          },
        },
        {
          id: 'forward',
          type: 'action',
          label: 'Forward',
          action: {type: 'reference', actionId: 'forward'},
        },
        {
          id: 'end',
          type: 'end',
          label: 'Done',
          end: {status: 'completed'},
        },
      ],
      edges: [
        {id: 'start', from: 'trigger', to: 'forward', outcome: 'always'},
        {id: 'done', from: 'forward', to: 'end', outcome: 'success'},
      ],
    },
  };
}

function messageTemplate() {
  return {
    templateVersion: '2.0',
    id: 'e2e-message',
    name: 'E2E message',
    description: 'Independent end-to-end test message.',
    contentType: 'application/json',
    capabilities: {receive: true, send: false, match: true},
    schema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: {type: 'string'},
        token: {type: 'string'},
      },
      additionalProperties: false,
    },
    minimum: {body: {command: 'hello'}, pruneEmpty: true},
    fields: [
      {
        key: 'command',
        label: 'Command',
        path: '$.command',
        description: 'Command value.',
        required: true,
        valueType: 'string',
        roles: {display: true, send: false, match: true},
      },
      {
        key: 'token',
        label: 'Token',
        path: '$.token',
        description: 'Sensitive test value.',
        required: false,
        valueType: 'string',
        roles: {display: true, send: false, match: false},
      },
    ],
    constraints: [],
    examples: [
      {name: 'Hello', description: 'Valid message.', body: {command: 'hello'}},
    ],
    notes: [],
  };
}
