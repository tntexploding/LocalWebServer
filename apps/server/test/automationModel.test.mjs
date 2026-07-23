import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionsConfigSchema,
  explainRuleMatch,
  rulesConfigSchema,
} from '@las/core';
import {EventWaitBroker} from '../dist/eventWaitBroker.js';
import {nextWorkflowOccurrence} from '../dist/workflowScheduler.js';

test('normalizes legacy workflow event triggers', () => {
  const config = rulesConfigSchema.parse({
    rules: [workflowRule({source: 'http.server.input'})],
  });
  const trigger = config.rules[0].workflow.nodes[0].trigger;

  assert.deepEqual(trigger, {
    type: 'event',
    event: {source: 'http.server.input'},
  });
});

test('does not match a time workflow through ordinary event evaluation', () => {
  const rule = rulesConfigSchema.parse({
    rules: [
      workflowRule({
        type: 'time',
        schedule: {mode: 'interval', everyMs: 60000},
      }),
    ],
  }).rules[0];
  const checks = explainRuleMatch(inboundEvent(), rule);

  assert.equal(
    checks.some(check => check.field === 'trigger'),
    true,
  );
  assert.equal(
    checks.every(check => check.matched),
    false,
  );
});

test('validates every reusable action type', () => {
  const actions = actionsConfigSchema.parse({
    actions: [
      {id: 'command', type: 'command', cwd: '.', command: 'node'},
      {
        id: 'script',
        type: 'script',
        cwd: '.',
        interpreter: 'node',
        script: 'script.js',
      },
      {
        id: 'http',
        type: 'send_http',
        method: 'POST',
        url: 'http://127.0.0.1:4789/',
      },
      {id: 'ws', type: 'send_ws', target: 'control'},
      {
        id: 'notification',
        type: 'notification',
        title: 'LAS',
        message: 'Done',
      },
      {
        id: 'prompt',
        type: 'prompt',
        title: 'LAS',
        message: 'Continue?',
        options: ['yes', 'no'],
      },
      {
        id: 'wait',
        type: 'wait_event',
        source: 'http.server.input',
        timeoutMs: 1000,
      },
    ],
  }).actions;

  assert.deepEqual(
    actions.map(action => action.type),
    [
      'command',
      'script',
      'send_http',
      'send_ws',
      'notification',
      'prompt',
      'wait_event',
    ],
  );
});

test('calculates one-time, interval, and daily trigger occurrences', () => {
  const now = new Date(2026, 0, 2, 10, 30, 0, 0);
  const once = new Date(2026, 0, 2, 11, 0, 0, 0);

  assert.equal(
    nextWorkflowOccurrence(
      {mode: 'once', at: once.toISOString()},
      now,
    ).getTime(),
    once.getTime(),
  );
  assert.equal(
    nextWorkflowOccurrence(
      {
        mode: 'interval',
        everyMs: 60000,
        startAt: new Date(2026, 0, 2, 10, 28, 30).toISOString(),
      },
      now,
    ).getTime(),
    new Date(2026, 0, 2, 10, 30, 30).getTime(),
  );
  assert.equal(
    nextWorkflowOccurrence({mode: 'daily', time: '10:00:00'}, now).getTime(),
    new Date(2026, 0, 3, 10, 0, 0, 0).getTime(),
  );
});

test('releases reusable event waits from the shared event stream', async () => {
  const waits = new EventWaitBroker();
  const pending = waits.wait(
    {source: 'http.server.input', kind: 'http.request'},
    1000,
  );
  waits.accept(inboundEvent());

  assert.equal((await pending).id, 'event-1');
});

function workflowRule(trigger) {
  return {
    id: 'workflow',
    enabled: true,
    workflow: {
      version: '1.0',
      startNodeId: 'trigger',
      nodes: [
        {id: 'trigger', type: 'trigger', label: 'Trigger', trigger},
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

function inboundEvent() {
  return {
    id: 'event-1',
    traceId: 'trace-1',
    time: '2026-01-01T00:00:00.000Z',
    source: 'http.server.input',
    kind: 'http.request',
    body: {command: 'hello'},
    meta: {},
  };
}
