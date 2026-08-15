import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {ActionExecutor} from '../dist/actionExecutor.js';
import {EventWaitBroker} from '../dist/eventWaitBroker.js';
import {InteractionBroker} from '../dist/interactionBroker.js';
import {MessageTemplateDecoder} from '../dist/messageTemplateDecoder.js';
import {NetworkPolicy} from '../dist/networkPolicy.js';

test('local actions require allowlisted absolute executables and isolate env', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'las-action-security-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const app = testAppConfig(root);
  const executor = testExecutor(app, root);
  const environmentName = 'LAS_AUDIT_PRIVATE_VALUE';
  const previous = process.env[environmentName];
  process.env[environmentName] = 'isolated-value';
  t.after(() => {
    if (previous === undefined) delete process.env[environmentName];
    else process.env[environmentName] = previous;
  });

  const isolated = await executor.execute(
    {
      id: 'isolated-env',
      type: 'command',
      cwd: '.',
      command: process.execPath,
      args: [
        '-e',
        `process.stdout.write(process.env.${environmentName} ?? 'missing')`,
      ],
    },
    event(),
  );
  assert.equal(isolated.status, 'completed');
  assert.equal(isolated.output, 'missing');

  const relative = await executor.execute(
    {
      id: 'relative-executable',
      type: 'command',
      cwd: root,
      command: path.basename(process.execPath),
    },
    event(),
  );
  assert.equal(relative.status, 'failed');
  assert.match(relative.error, /must be absolute/u);
});

test('script actions cannot escape the allowlisted working tree', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'las-action-root-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'las-action-outside-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  t.after(() => rm(outside, {recursive: true, force: true}));
  const script = path.join(outside, 'outside.mjs');
  await writeFile(script, 'process.stdout.write("outside");\n', 'utf8');
  const app = testAppConfig(root);
  const result = await testExecutor(app, root).execute(
    {
      id: 'outside-script',
      type: 'script',
      cwd: root,
      interpreter: process.execPath,
      script,
    },
    event(),
  );

  assert.equal(result.status, 'failed');
  assert.match(result.error, /outside allowed roots/u);
});

function testExecutor(app, root) {
  return new ActionExecutor(
    () => app,
    async () => undefined,
    new MessageTemplateDecoder(root),
    new InteractionBroker(),
    new EventWaitBroker(),
    new NetworkPolicy(() => app.network),
    root,
  );
}

function testAppConfig(root) {
  return {
    security: {
      allowedCommandRoots: ['.'],
      allowedExecutables: [process.execPath],
      commandEnvironmentAllowlist: [],
    },
    network: {
      inbound: {
        allowedSources: ['loopback'],
        allowedOrigins: [],
        maxHttpBodyBytes: 1048576,
        maxWebSocketMessageBytes: 1048576,
        maxWebSocketConnectionsPerEndpoint: 16,
        requestTimeoutMs: 15000,
        headersTimeoutMs: 10000,
        keepAliveTimeoutMs: 5000,
        maxHeadersCount: 100,
      },
      outbound: {
        allowedHostnames: [],
        allowedAddresses: ['loopback'],
        allowedPorts: [80],
        maxHttpRequestBytes: 1048576,
        maxHttpResponseBytes: 1048576,
        maxWebSocketMessageBytes: 1048576,
      },
    },
    automation: {maxActionOutputBytes: 1048576},
  };
}

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
