import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {bootstrapContainerRuntime} from '../../scripts/container-runtime.mjs';

const codeRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('container bootstrap initializes missing files without replacing data', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'las-container-'));
  t.after(() => rm(rootDir, {recursive: true, force: true}));

  const copied = await bootstrapContainerRuntime({codeRoot, rootDir});
  assert.deepEqual(copied.sort(), [
    'actions.yaml',
    'app.yaml',
    'endpoints.yaml',
    'rules.yaml',
  ]);
  const app = await readFile(path.join(rootDir, 'config', 'app.yaml'), 'utf8');
  assert.match(app, /host: '0\.0\.0\.0'/u);

  const customActions = 'version: 1\nactions: []\n# preserved\n';
  await writeFile(
    path.join(rootDir, 'config', 'actions.yaml'),
    customActions,
    'utf8',
  );
  const secondCopy = await bootstrapContainerRuntime({codeRoot, rootDir});
  assert.deepEqual(secondCopy, []);
  assert.equal(
    await readFile(path.join(rootDir, 'config', 'actions.yaml'), 'utf8'),
    customActions,
  );
});
