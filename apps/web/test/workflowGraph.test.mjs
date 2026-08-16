import assert from 'node:assert/strict';
import test from 'node:test';
import {removeWorkflowConnection} from '../src/workflowGraph.ts';

const workflow = {
  version: '1.0',
  startNodeId: 'trigger',
  nodes: [],
  edges: [
    {from: 'trigger', to: 'action', outcome: 'always'},
    {from: 'logic', to: 'action', outcome: 'true'},
    {from: 'logic', to: 'action', outcome: 'always'},
    {from: 'logic', to: 'end', outcome: 'false'},
  ],
};

test('removes every branch between one selected node pair', () => {
  const result = removeWorkflowConnection(workflow, 'logic', 'action');
  assert.deepEqual(result.edges, [
    {from: 'trigger', to: 'action', outcome: 'always'},
    {from: 'logic', to: 'end', outcome: 'false'},
  ]);
});

test('keeps graph identity when the selected pair is not connected', () => {
  assert.equal(
    removeWorkflowConnection(workflow, 'action', 'trigger'),
    workflow,
  );
});
