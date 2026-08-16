import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import {ConfigStore, JsonFileStore, JsonlStore} from '../dist/index.js';

test('rotates JSONL records and reads newest records across files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'las-jsonl-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'events.jsonl');
  const store = new JsonlStore(file, {maxBytes: 35, maxFiles: 2});

  for (const id of ['a', 'b', 'c', 'd']) {
    await store.append({id, value: '1234567890'});
  }

  assert.deepEqual(
    (await store.latest(10)).map(row => row.id),
    ['d', 'c', 'b'],
  );
  assert.equal((await store.findById('c')).id, 'c');
  assert.equal(await store.findById('a'), undefined);
});

test('serializes concurrent JSON state replacements', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'las-json-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'state.json');
  const store = new JsonFileStore(file);

  await Promise.all([
    store.save({version: 1, value: 'first'}),
    store.save({version: 1, value: 'second'}),
    store.save({version: 1, value: 'last'}),
  ]);

  assert.deepEqual(await store.load({}), {version: 1, value: 'last'});
  assert.equal(JSON.parse(await readFile(file, 'utf8')).value, 'last');
});

test('skips a partial JSONL line left by an interrupted write', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'las-partial-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'runs.jsonl');
  await writeFile(file, '{"id":"old"}\n{"id":\n{"id":"new"}\n', 'utf8');
  const store = new JsonlStore(file);

  assert.deepEqual(
    (await store.latest()).map(row => row.id),
    ['new', 'old'],
  );
});

test('migrates, versions, validates, restores, and redacts config files', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'las-config-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const configDir = path.join(root, 'config');
  await mkdir(configDir, {recursive: true});
  await Promise.all([
    writeJson(path.join(configDir, 'app.yaml'), {
      server: {host: '127.0.0.1', port: 4789, webSocketPath: '/ws'},
      security: {
        apiToken: '${secret:apiToken}',
        requireTokenForRead: true,
        allowedApiSources: ['127.0.0.1', '::1'],
        corsOrigins: [],
        allowedCommandRoots: [],
        allowedExecutables: [],
        commandEnvironmentAllowlist: [],
        allowShell: false,
      },
      network: testNetworkConfig(),
      automation: {maxConcurrentActions: 2, maxActionOutputBytes: 1048576},
      storage: {
        eventLogPath: 'data/events.jsonl',
        runLogPath: 'data/runs.jsonl',
        auditLogPath: 'data/security-audit.jsonl',
        schedulerStatePath: 'data/scheduler-state.json',
        configHistoryPath: 'data/config-history',
        configHistoryLimit: 10,
        maxLogBytes: 1048576,
        maxLogFiles: 2,
      },
    }),
    writeJson(path.join(configDir, 'endpoints.yaml'), {
      httpClients: [
        {
          id: 'protected-client',
          enabled: true,
          baseUrl: 'http://example.invalid',
          headers: {authorization: '${secret:pluginAuthorization}'},
        },
      ],
    }),
    writeJson(path.join(configDir, 'rules.yaml'), {rules: []}),
    writeJson(path.join(configDir, 'actions.yaml'), {actions: []}),
    writeJson(path.join(configDir, 'secrets.yaml'), {
      version: 1,
      secrets: {
        apiToken: 'test-private-token-0000000000000000000',
        pluginAuthorization: 'Bearer test-plugin-authorization',
      },
    }),
  ]);
  const store = new ConfigStore(root);
  const loaded = await store.load();
  assert.equal(loaded.app.version, 1);
  assert.equal(
    loaded.app.security.apiToken,
    'test-private-token-0000000000000000000',
  );
  assert.equal(store.redact(loaded).app.security.apiToken, '[REDACTED]');
  assert.deepEqual(
    store.redact({
      body: {
        token: 'arbitrary-value',
        detail: 'prefix-test-private-token-0000000000000000000-suffix',
      },
    }),
    {
      body: {
        token: '[REDACTED]',
        detail: 'prefix-[REDACTED]-suffix',
      },
    },
  );
  assert.equal(
    YAML.parse(await readFile(path.join(configDir, 'app.yaml'), 'utf8'))
      .version,
    1,
  );
  assert.equal((await store.listHistory()).length, 4);

  const redactedEndpoints = store.redact(loaded).endpoints;
  assert.equal(
    redactedEndpoints.httpClients[0].headers.authorization,
    '[REDACTED]',
  );
  const savedEndpoints = await store.saveEndpoints({
    ...redactedEndpoints,
    httpServers: [
      {id: 'inbound', enabled: false, path: '/message', description: 'new'},
    ],
  });
  assert.equal(savedEndpoints.endpoints.httpServers[0].enabled, false);
  const protectedEndpoints = (await store.loadRaw()).endpoints;
  assert.equal(protectedEndpoints.includes('[REDACTED]'), false);
  assert.equal(
    protectedEndpoints.includes('${secret:pluginAuthorization}'),
    true,
  );
  const revisions = await store.listHistory('endpoints');
  assert.ok(revisions.length >= 2);
  const savedRules = await store.saveRules([
    {
      id: 'disabled-rule',
      enabled: false,
      when: {anySource: true},
      then: [],
    },
  ]);
  assert.equal(savedRules.rules[0].enabled, false);
  assert.equal(
    YAML.parse((await store.loadRaw()).rules).rules[0].enabled,
    false,
  );
  const beforeInvalid = (await store.loadRaw()).rules;
  await assert.rejects(
    store.saveRules([
      {
        id: 'invalid',
        enabled: true,
        when: {anySource: true},
        then: [{action: 'missing'}],
      },
    ]),
    /unknown action/u,
  );
  assert.equal((await store.loadRaw()).rules, beforeInvalid);

  const beforeInlineSecret = (await store.loadRaw()).app;
  await assert.rejects(
    store.saveRaw(
      'app',
      beforeInlineSecret.replace(
        '${secret:apiToken}',
        'inline-credential-value',
      ),
    ),
    /must use a \$\{secret:name\}/u,
  );
  assert.equal((await store.loadRaw()).app, beforeInlineSecret);

  await store.restore('endpoints', revisions[0].id);
  assert.equal((await store.load()).endpoints.httpServers.length, 0);
  const protectedApp = (await store.loadRaw()).app;
  assert.equal(
    protectedApp.includes('test-private-token-0000000000000000000'),
    false,
  );
  assert.equal(protectedApp.includes('${secret:apiToken}'), true);
});

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function testNetworkConfig() {
  return {
    inbound: {
      allowedSources: ['127.0.0.1', '::1'],
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
      allowedHostnames: ['localhost'],
      allowedAddresses: ['loopback'],
      allowedPorts: [4789],
      maxHttpRequestBytes: 1048576,
      maxHttpResponseBytes: 1048576,
      maxWebSocketMessageBytes: 1048576,
    },
  };
}
