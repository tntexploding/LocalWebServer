import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {assertSupportedRuntime} from '../dist/runtimePolicy.js';

test('runtime policy accepts the active supported major', async t => {
  const root = await temporaryPolicyRoot(t, {
    schemaVersion: 1,
    minimumNodeVersion: '0.0.1',
    supportedNodeMajor: Number(process.versions.node.split('.')[0]),
  });
  await assert.doesNotReject(assertSupportedRuntime(root));
});

test('runtime policy rejects an unsupported security baseline', async t => {
  const root = await temporaryPolicyRoot(t, {
    schemaVersion: 1,
    minimumNodeVersion: '99.0.0',
    supportedNodeMajor: Number(process.versions.node.split('.')[0]),
  });
  await assert.rejects(
    assertSupportedRuntime(root),
    /below the security baseline/u,
  );
});

async function temporaryPolicyRoot(t, policy) {
  const root = await mkdtemp(path.join(tmpdir(), 'las-runtime-policy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(root, {recursive: true});
  await writeFile(
    path.join(root, 'release.config.json'),
    `${JSON.stringify(policy)}\n`,
    'utf8',
  );
  return root;
}
