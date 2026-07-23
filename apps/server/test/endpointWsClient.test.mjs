import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import test from 'node:test';
import {WebSocketServer} from 'ws';
import {EndpointListenerManager} from '../dist/endpointListenerManager.js';

test('reuses a persistent WebSocket client for inbound and outbound traffic', async t => {
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.notEqual(address, null);

  let connections = 0;
  const outboundMessages = [];
  server.on('connection', socket => {
    connections += 1;
    socket.on('message', data => {
      outboundMessages.push(JSON.parse(data.toString('utf8')));
    });
    socket.send(JSON.stringify({direction: 'inbound'}));
  });

  const inboundMessages = [];
  const errors = [];
  const manager = new EndpointListenerManager(
    createServer(),
    {host: '127.0.0.1', port: 4789},
    async () => undefined,
    async message => inboundMessages.push(message),
    (error, context) => errors.push({error, context}),
  );
  t.after(async () => {
    await manager.clear();
    await close(server);
  });

  await manager.apply(
    {
      httpServers: [],
      wsServers: [],
      httpClients: [],
      wsClients: [
        {
          id: 'persistent-client',
          enabled: true,
          url: `ws://127.0.0.1:${address.port}`,
          reconnect: {
            enabled: true,
            initialDelayMs: 100,
            maxDelayMs: 100,
            backoffMultiplier: 1,
          },
        },
      ],
    },
    {host: '127.0.0.1', port: 4789},
  );
  await waitUntil(
    () => manager.wsStatus()[0]?.state === 'open' && inboundMessages.length > 0,
  );

  await manager.send('persistent-client', {sequence: 1});
  await manager.send('persistent-client', {sequence: 2});
  await waitUntil(() => outboundMessages.length === 2);

  assert.equal(connections, 1);
  assert.deepEqual(outboundMessages, [{sequence: 1}, {sequence: 2}]);
  assert.equal(inboundMessages[0].role, 'client');
  assert.deepEqual(inboundMessages[0].body, {direction: 'inbound'});
  assert.deepEqual(errors, []);
});

async function waitUntil(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for state.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}
