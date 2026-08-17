import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';

const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workflowPath = path.join(
  rootDir,
  '.github',
  'workflows',
  'container.yml',
);
const source = await readFile(workflowPath, 'utf8');
const workflow = YAML.parse(source);

test('container workflow separates validation from publication', () => {
  assert.ok(Object.hasOwn(workflow.on, 'pull_request'));
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.deepEqual(workflow.on.push.tags, ['v*']);
  assert.equal(workflow.jobs.quality.permissions.contents, 'read');
  assert.equal(workflow.jobs.validate.permissions.contents, 'read');
  assert.equal(workflow.jobs.validate.permissions.packages, undefined);
  assert.equal(workflow.jobs.publish.permissions.packages, 'write');
  assert.equal(workflow.jobs.publish.permissions['id-token'], 'write');
  assert.equal(workflow.jobs.publish.permissions.attestations, 'write');
  assert.deepEqual(workflow.jobs.publish.needs, ['quality']);
  assert.equal(
    actionStep(workflow.jobs.quality, 'actions/checkout@').with['fetch-depth'],
    0,
  );
  assert.ok(
    workflow.jobs.quality.steps.some(
      step => step.run === 'npm run audit:dependencies',
    ),
  );
  assert.ok(
    workflow.jobs.quality.steps.some(
      step => step.run === 'npm run test:container',
    ),
  );
});

test('container workflow validates and publishes both target platforms', () => {
  const validationBuild = actionStep(
    workflow.jobs.validate,
    'docker/build-push-action@',
  );
  assert.equal(validationBuild.with.platforms, 'linux/amd64,linux/arm64');
  assert.equal(validationBuild.with.push, false);

  const publicationBuild = actionStep(
    workflow.jobs.publish,
    'docker/build-push-action@',
  );
  assert.equal(publicationBuild.with.platforms, 'linux/amd64,linux/arm64');
  assert.equal(publicationBuild.with.push, true);
  assert.equal(publicationBuild.with.provenance, 'mode=max');
  assert.equal(publicationBuild.with.sbom, true);
  assert.ok(actionStep(workflow.jobs.publish, 'actions/attest@'));
  assert.ok(actionStep(workflow.jobs.publish, 'sigstore/cosign-installer@'));
});

test('container workflow pins every external action to a commit', () => {
  const references = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map(
    match => match[1],
  );
  assert.ok(references.length > 0);
  for (const reference of references) {
    if (reference.startsWith('./')) continue;
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/u);
  }
});

function actionStep(job, prefix) {
  return job.steps.find(
    step => typeof step.uses === 'string' && step.uses.startsWith(prefix),
  );
}
