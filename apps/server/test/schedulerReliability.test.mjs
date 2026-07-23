import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {JsonFileStore} from '@las/storage';
import {
  nextWorkflowOccurrence,
  WorkflowScheduler,
} from '../dist/workflowScheduler.js';

test('calculates catch-up and IANA time-zone occurrences', () => {
  const now = new Date('2026-01-01T00:30:00.000Z');

  assert.equal(
    nextWorkflowOccurrence(
      {
        mode: 'once',
        at: '2025-12-31T23:00:00.000Z',
        misfirePolicy: 'skip',
      },
      now,
    ),
    undefined,
  );
  assert.equal(
    nextWorkflowOccurrence(
      {
        mode: 'once',
        at: '2025-12-31T23:00:00.000Z',
        misfirePolicy: 'runOnce',
      },
      now,
    ).toISOString(),
    now.toISOString(),
  );
  assert.equal(
    nextWorkflowOccurrence(
      {mode: 'daily', time: '09:00:00', timeZone: 'Asia/Shanghai'},
      now,
    ).toISOString(),
    '2026-01-01T01:00:00.000Z',
  );
});

test('persists a one-time run and does not repeat it after restart', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'las-scheduler-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const store = new JsonFileStore(path.join(directory, 'state.json'));
  const rule = scheduledRule({
    mode: 'once',
    at: new Date(Date.now() - 1000).toISOString(),
    misfirePolicy: 'runOnce',
  });
  const firstDispatches = [];
  const first = new WorkflowScheduler(
    async (_rule, event) => firstDispatches.push(event),
    error => {
      throw error;
    },
    store,
  );
  await first.initialize([rule]);
  await waitUntil(() => firstDispatches.length === 1);
  first.stop();

  const secondDispatches = [];
  const second = new WorkflowScheduler(
    async (_rule, event) => secondDispatches.push(event),
    error => {
      throw error;
    },
    store,
  );
  await second.initialize([rule]);
  await new Promise(resolve => setTimeout(resolve, 30));
  second.stop();

  assert.equal(firstDispatches[0].meta.recovered, true);
  assert.deepEqual(secondDispatches, []);
  assert.deepEqual(second.snapshot(), []);
});

function scheduledRule(schedule) {
  return {
    id: 'scheduled-workflow',
    enabled: true,
    workflow: {
      version: '1.0',
      startNodeId: 'trigger',
      nodes: [
        {
          id: 'trigger',
          type: 'trigger',
          label: 'Trigger',
          trigger: {type: 'time', schedule},
        },
        {
          id: 'end',
          type: 'end',
          label: 'End',
          end: {status: 'completed'},
        },
      ],
      edges: [
        {id: 'trigger-end', from: 'trigger', to: 'end', outcome: 'always'},
      ],
    },
  };
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for state.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
