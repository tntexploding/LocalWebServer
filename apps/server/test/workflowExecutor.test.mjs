import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveWorkflowExpressions} from '@las/core';
import {ActionQueue} from '../dist/actionQueue.js';
import {EventWaitBroker} from '../dist/eventWaitBroker.js';
import {InteractionBroker} from '../dist/interactionBroker.js';
import {WorkflowExecutor} from '../dist/workflowExecutor.js';

const event = {
  id: 'event-1',
  traceId: 'trace-1',
  time: '2026-01-01T00:00:00.000Z',
  source: 'http.server.test',
  kind: 'http.request',
  body: {command: 'hello'},
};

test('executes an action and follows the successful logic branch', async () => {
  const records = [];
  const queue = {
    enqueueAndWait: async ({action}) => completedAction(action.id),
  };
  const executor = new WorkflowExecutor(
    queue,
    {append: async value => records.push(value)},
    new EventWaitBroker(),
    () => ({
      actions: [savedAction()],
      endpoints: {httpClients: []},
    }),
  );

  executor.start(successWorkflow(), event);
  await waitUntil(() => executor.snapshot().length === 0);

  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'completed');
  assert.equal(records[0].detail.completedEnds, 1);
  assert.deepEqual(records[0].detail.nodeRunIds, ['child-run']);
});

test('resolves a blocking prompt with a listed option', async () => {
  const broker = new InteractionBroker();
  const pending = broker.prompt({
    title: 'Approval',
    message: 'Continue?',
    options: ['yes', 'no'],
    timeoutMs: 1000,
  });
  const [interaction] = broker.list();

  assert.equal(interaction.type, 'prompt');
  assert.equal(broker.respond(interaction.id, 'yes'), true);
  assert.equal(await pending, 'yes');
  assert.deepEqual(broker.list(), []);
});

test('registers the queue waiter before an immediate action completes', async () => {
  const records = [];
  const queue = new ActionQueue(
    1,
    {execute: async action => completedAction(action.id)},
    {append: async value => records.push(value)},
  );

  const result = await queue.enqueueAndWait({action: savedAction(), event});

  assert.equal(result.status, 'completed');
  assert.equal(result.ok, true);
  assert.equal(records.length, 1);
});

test('passes workflow cancellation to the active queued action', async () => {
  const records = [];
  const queue = new ActionQueue(
    1,
    {
      execute: async (action, _event, signal) => {
        await new Promise(resolve => {
          signal.addEventListener('abort', resolve, {once: true});
        });
        return {
          ...completedAction(action.id),
          status: 'cancelled',
          ok: false,
          error: 'cancelled',
        };
      },
    },
    {append: async value => records.push(value)},
  );
  const executor = new WorkflowExecutor(
    queue,
    {append: async value => records.push(value)},
    new EventWaitBroker(),
    () => ({
      actions: [savedAction()],
      endpoints: {httpClients: []},
    }),
  );

  const run = executor.start(successWorkflow(), event);
  await waitUntil(() => queue.snapshot().running.length === 1);
  executor.cancel(run.id);
  await waitUntil(() => executor.snapshot().length === 0);

  const workflowResult = records.find(item => item.id === run.id);
  assert.equal(workflowResult.status, 'cancelled');
  assert.equal(workflowResult.ok, false);
});

test('passes trigger and prior node results through action bindings', async () => {
  const records = [];
  const executed = [];
  let sequence = 0;
  const queue = {
    enqueueAndWait: async input => {
      sequence += 1;
      const action = resolveWorkflowExpressions(input.action, input.context);
      executed.push({action, context: input.context});
      const result = completedAction(action.id, {
        id: `child-${sequence}`,
        output: action.command,
      });
      input.onQueued?.(result);
      return result;
    },
  };
  const actions = [
    {
      id: 'first-action',
      type: 'command',
      cwd: '.',
      command: 'echo-${{ inputs.value }}',
    },
    {
      id: 'second-action',
      type: 'command',
      cwd: '.',
      command: 'use-${{ inputs.previous }}',
    },
  ];
  const executor = new WorkflowExecutor(
    queue,
    {append: async value => records.push(value)},
    new EventWaitBroker(),
    () => ({actions, endpoints: {httpClients: []}}),
  );

  executor.start(contextWorkflow(), event);
  await waitUntil(() => executor.snapshot().length === 0);

  assert.deepEqual(
    executed.map(item => item.action.command),
    ['echo-hello', 'use-echo-hello'],
  );
  assert.equal(executed[1].context.inputs.previous, 'echo-hello');
  assert.deepEqual(
    records[0].detail.timeline.map(item => [item.nodeId, item.status]),
    [
      ['trigger', 'completed'],
      ['first', 'completed'],
      ['second', 'completed'],
      ['done', 'completed'],
    ],
  );
  assert.deepEqual(records[0].detail.nodeRunIds, ['child-1', 'child-2']);
  assert.equal(
    records[0].detail.context.nodes.second.result.output,
    'use-echo-hello',
  );
});

test('completes queue waiters even when run persistence fails', async () => {
  const persistenceErrors = [];
  const queue = new ActionQueue(
    1,
    {execute: async action => completedAction(action.id)},
    {append: async () => Promise.reject(new Error('disk unavailable'))},
    error => persistenceErrors.push(error),
  );

  const result = await queue.enqueueAndWait({action: savedAction(), event});

  assert.equal(result.status, 'completed');
  assert.equal(queue.snapshot().running.length, 0);
  assert.equal(persistenceErrors.length, 1);
});

function savedAction() {
  return {
    id: 'saved-action',
    type: 'command',
    cwd: '.',
    command: 'node',
  };
}

function completedAction(actionId, overrides = {}) {
  return {
    id: 'child-run',
    traceId: event.traceId,
    actionId,
    eventId: event.id,
    status: 'completed',
    ok: true,
    startedAt: event.time,
    finishedAt: event.time,
    output: 'success',
    detail: {direction: 'local'},
    ...overrides,
  };
}

function contextWorkflow() {
  return {
    id: 'context-workflow',
    enabled: true,
    workflow: {
      version: '1.0',
      startNodeId: 'trigger',
      nodes: [
        {
          id: 'trigger',
          type: 'trigger',
          label: 'Trigger',
          trigger: {type: 'event', event: {anySource: true}},
        },
        {
          id: 'first',
          type: 'action',
          label: 'First',
          action: {
            type: 'reference',
            actionId: 'first-action',
            with: {value: '${{ trigger.body.command }}'},
          },
        },
        {
          id: 'second',
          type: 'action',
          label: 'Second',
          action: {
            type: 'reference',
            actionId: 'second-action',
            with: {previous: '${{ nodes.first.result.output }}'},
          },
        },
        {
          id: 'done',
          type: 'end',
          label: 'Done',
          end: {status: 'completed'},
        },
      ],
      edges: [
        {id: 'e1', from: 'trigger', to: 'first', outcome: 'always'},
        {id: 'e2', from: 'first', to: 'second', outcome: 'success'},
        {id: 'e3', from: 'second', to: 'done', outcome: 'success'},
      ],
    },
  };
}

function successWorkflow() {
  return {
    id: 'test-workflow',
    enabled: true,
    workflow: {
      version: '1.0',
      startNodeId: 'trigger',
      nodes: [
        {
          id: 'trigger',
          type: 'trigger',
          label: 'Trigger',
          trigger: {type: 'event', event: {anySource: true}},
        },
        {
          id: 'action',
          type: 'action',
          label: 'Action',
          action: {type: 'reference', actionId: 'saved-action'},
        },
        {
          id: 'logic',
          type: 'logic',
          label: 'Logic',
          logic: {input: 'lastResult', operator: 'success'},
        },
        {
          id: 'done',
          type: 'end',
          label: 'Done',
          end: {status: 'completed'},
        },
        {
          id: 'failed',
          type: 'end',
          label: 'Failed',
          end: {status: 'failed'},
        },
      ],
      edges: [
        {id: 'e1', from: 'trigger', to: 'action', outcome: 'always'},
        {id: 'e2', from: 'action', to: 'logic', outcome: 'success'},
        {id: 'e3', from: 'action', to: 'failed', outcome: 'failure'},
        {id: 'e4', from: 'logic', to: 'done', outcome: 'true'},
        {id: 'e5', from: 'logic', to: 'failed', outcome: 'false'},
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
