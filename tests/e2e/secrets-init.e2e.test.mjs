import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const projectRoot = path.resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);

test('moves an inline HTTP authorization header into the local secret store', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'las-secrets-init-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'config'), {recursive: true});

  await writeYaml(path.join(root, 'config', 'app.yaml'), {
    version: 1,
    security: {
      apiToken: 'test-admin-token-00000000000000000000',
      operatorToken: 'test-operator-token-00000000000000000',
      readToken: 'test-reader-token-0000000000000000000',
    },
  });
  const authorizationHeader = 'Bearer test-plugin-authorization';
  await writeYaml(path.join(root, 'config', 'endpoints.yaml'), {
    version: 1,
    httpServers: [],
    wsServers: [],
    httpClients: [
      {
        id: 'qq-plugin',
        enabled: true,
        baseUrl: 'http://example.invalid',
        headers: {authorization: authorizationHeader},
      },
    ],
    wsClients: [],
  });

  runInitializer(root);

  const endpoints = YAML.parse(
    await readFile(path.join(root, 'config', 'endpoints.yaml'), 'utf8'),
  );
  const secrets = YAML.parse(
    await readFile(path.join(root, 'config', 'secrets.yaml'), 'utf8'),
  );
  const reference = endpoints.httpClients[0].headers.authorization;
  const match = /^\$\{secret:([A-Za-z][A-Za-z0-9_.-]*)\}$/u.exec(reference);
  assert.ok(match);
  assert.equal(secrets.secrets[match[1]], authorizationHeader);
  assert.equal(
    (
      await readFile(path.join(root, 'config', 'endpoints.yaml'), 'utf8')
    ).includes(authorizationHeader),
    false,
  );

  runInitializer(root);
  const repeated = YAML.parse(
    await readFile(path.join(root, 'config', 'endpoints.yaml'), 'utf8'),
  );
  assert.equal(repeated.httpClients[0].headers.authorization, reference);
});

function runInitializer(root) {
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, 'scripts', 'init-secrets.mjs')],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {...process.env, LAS_ROOT_DIR: root},
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
}

async function writeYaml(filePath, value) {
  await writeFile(filePath, YAML.stringify(value), 'utf8');
}
