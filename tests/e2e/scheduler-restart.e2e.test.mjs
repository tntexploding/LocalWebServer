import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocatePort,
  apiFetch,
  baseAppConfig,
  createTestProject,
  startServer,
  waitFor,
} from '../support/testProject.mjs';

test(
  'persists a missed one-time schedule across process restarts',
  {timeout: 30000},
  async t => {
    const controlPort = await allocatePort();
    const project = await createTestProject({
      app: baseAppConfig(controlPort),
      rules: {
        version: 1,
        rules: [scheduledWorkflow()],
      },
    });
    let activeRuntime;
    t.after(async () => {
      await activeRuntime?.stop();
      await project.dispose();
    });

    activeRuntime = await startServer(project.root, controlPort);
    await waitFor(
      async () => (await workflowRuns(activeRuntime.baseUrl)).length === 1,
    );
    await activeRuntime.stop();

    activeRuntime = await startServer(project.root, controlPort);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal((await workflowRuns(activeRuntime.baseUrl)).length, 1);
  },
);

async function workflowRuns(baseUrl) {
  const response = await apiFetch(baseUrl, '/api/workflows/scheduled/runs');
  assert.equal(response.status, 200);
  return response.json();
}

function scheduledWorkflow() {
  return {
    id: 'scheduled',
    enabled: true,
    workflow: {
      version: '1.0',
      startNodeId: 'trigger',
      nodes: [
        {
          id: 'trigger',
          type: 'trigger',
          label: 'Once',
          trigger: {
            type: 'time',
            schedule: {
              mode: 'once',
              at: new Date(Date.now() - 1000).toISOString(),
              misfirePolicy: 'runOnce',
            },
          },
        },
        {
          id: 'notify',
          type: 'action',
          label: 'Notify',
          action: {
            type: 'notification',
            title: 'Scheduled',
            message: 'Recovered once.',
          },
        },
        {
          id: 'end',
          type: 'end',
          label: 'Done',
          end: {status: 'completed'},
        },
      ],
      edges: [
        {id: 'start', from: 'trigger', to: 'notify', outcome: 'always'},
        {id: 'done', from: 'notify', to: 'end', outcome: 'success'},
      ],
    },
  };
}
