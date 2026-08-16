import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateWorkflowLogic, workflowLogicInput} from '../dist/index.js';

const event = {
  id: 'event-1',
  traceId: 'trace-1',
  time: '2026-01-01T00:00:00.000Z',
  source: 'test.event',
  kind: 'http.request',
  body: {message: 'hello world', count: 2},
  meta: {},
};

function context(overrides = {}) {
  return {
    trigger: event,
    inputs: {},
    nodes: {},
    last: {},
    workflow: {
      id: 'workflow',
      runId: 'run',
      traceId: 'trace-1',
      startedAt: event.time,
    },
    ...overrides,
  };
}

function logic(operator, patch = {}) {
  return {
    id: 'logic',
    type: 'logic',
    label: 'Logic',
    logic: {input: 'triggerEvent', operator, ...patch},
  };
}

test('extracts trigger, action-result, and event inputs', () => {
  assert.equal(
    workflowLogicInput(
      logic('equals', {jsonPath: '$.body.message'}),
      context(),
    ),
    'hello world',
  );
  assert.equal(
    workflowLogicInput(
      logic('equals', {input: 'lastResult', jsonPath: '$.output'}),
      context({last: {result: {ok: true, output: 'done'}}}),
    ),
    'done',
  );
  assert.equal(
    workflowLogicInput(
      logic('equals', {input: 'lastEvent', jsonPath: '$.body.value'}),
      context({last: {event: {...event, body: {value: 42}}}}),
    ),
    42,
  );
});

test('evaluates every supported workflow logic operator', () => {
  assert.equal(
    evaluateWorkflowLogic(
      logic('equals', {jsonPath: '$.body.count', value: 2}),
      context(),
    ),
    true,
  );
  assert.equal(
    evaluateWorkflowLogic(
      logic('contains', {jsonPath: '$.body.message', value: 'world'}),
      context(),
    ),
    true,
  );
  assert.equal(
    evaluateWorkflowLogic(
      logic('regex', {jsonPath: '$.body.message', value: '^hello'}),
      context(),
    ),
    true,
  );
  assert.equal(
    evaluateWorkflowLogic(
      logic('truthy', {jsonPath: '$.body.count'}),
      context(),
    ),
    true,
  );
  assert.equal(
    evaluateWorkflowLogic(
      logic('success', {input: 'lastResult'}),
      context({last: {result: {ok: true}}}),
    ),
    true,
  );
});
