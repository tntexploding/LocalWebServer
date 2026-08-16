import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {reportRuntimeRecommendation} from '../dist/runtimePolicy.js';

test('runtime policy accepts a runtime matching the recommendation', async t => {
  const root = await temporaryPolicyRoot(t, {
    schemaVersion: 1,
    recommendedNodeVersion: '0.0.1',
    recommendedNodeMajor: Number(process.versions.node.split('.')[0]),
  });
  assert.equal(await reportRuntimeRecommendation(root), true);
});

test('runtime policy warns without blocking an older runtime', async t => {
  const root = await temporaryPolicyRoot(t, {
    schemaVersion: 1,
    recommendedNodeVersion: '99.0.0',
    recommendedNodeMajor: Number(process.versions.node.split('.')[0]),
  });
  const warnings = [];
  assert.equal(
    await reportRuntimeRecommendation(root, message => warnings.push(message)),
    false,
  );
  assert.match(warnings[0], /startup will continue/u);
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
