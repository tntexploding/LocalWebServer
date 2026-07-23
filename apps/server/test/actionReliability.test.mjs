import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';
import {ActionExecutor} from '../dist/actionExecutor.js';
import {EventWaitBroker} from '../dist/eventWaitBroker.js';
import {InteractionBroker} from '../dist/interactionBroker.js';
import {MessageTemplateDecoder} from '../dist/messageTemplateDecoder.js';

test('retries transient HTTP failures and preserves the idempotency key', async t => {
  let attempts = 0;
  const idempotencyKeys = [];
  const server = createServer((request, response) => {
    attempts += 1;
    idempotencyKeys.push(request.headers['idempotency-key']);
    response.writeHead(attempts < 3 ? 503 : 200, {
      'content-type': 'application/json',
    });
    response.end(JSON.stringify({attempts}));
  });
  await listen(server);
  t.after(() => close(server));
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');

  const executor = new ActionExecutor(
    {security: {allowedCommandRoots: []}},
    async () => undefined,
    new MessageTemplateDecoder(process.cwd()),
    new InteractionBroker(),
    new EventWaitBroker(),
  );
  const result = await executor.execute(
    {
      id: 'retry-http',
      type: 'send_http',
      method: 'POST',
      url: `http://127.0.0.1:${address.port}/send`,
      body: {message: 'hello'},
      idempotencyKey: 'message-1',
      timeoutMs: 1000,
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1,
        backoffMultiplier: 1,
        maxDelayMs: 1,
      },
    },
    event(),
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.attempts, 3);
  assert.equal(attempts, 3);
  assert.deepEqual(idempotencyKeys, ['message-1', 'message-1', 'message-1']);
  assert.equal(result.detail.statusCode, 200);
});

function event() {
  return {
    id: 'event-1',
    traceId: 'trace-1',
    time: '2026-01-01T00:00:00.000Z',
    source: 'test',
    kind: 'manual.test',
    body: {},
    meta: {},
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}
