import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  allocatePort,
  baseAppConfig,
  createTestProject,
  startServer,
  startServerExpectFailure,
} from '../support/testProject.mjs';

test(
  'rejects a corrupt config without rewriting it and starts after repair',
  {timeout: 20000},
  async t => {
    const port = await allocatePort();
    const project = await createTestProject({app: baseAppConfig(port)});
    let runtime;
    t.after(async () => {
      await runtime?.stop();
      await project.dispose();
    });
    const endpointsPath = path.join(project.root, 'config', 'endpoints.yaml');
    const valid = await readFile(endpointsPath, 'utf8');
    const corrupt = 'version: 1\nhttpServers:\n  - id: [invalid\n';
    await writeFile(endpointsPath, corrupt, 'utf8');

    const failure = await startServerExpectFailure(project.root);
    assert.notEqual(failure.code, 0);
    assert.match(failure.output, /endpoints\.yaml|YAML|flow sequence/iu);
    assert.equal(await readFile(endpointsPath, 'utf8'), corrupt);

    await writeFile(endpointsPath, valid, 'utf8');
    runtime = await startServer(project.root, port);
    assert.equal((await fetch(`${runtime.baseUrl}/api/health`)).status, 200);
  },
);
