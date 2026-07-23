import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actionConfigSchema,
  inspectWorkflowExpressions,
  resolveWorkflowExpressions,
  validateWorkflowExpressionSyntax,
} from '../dist/index.js';

const context = {
  trigger: {
    id: 'event-1',
    traceId: 'trace-1',
    time: '2026-01-01T00:00:00.000Z',
    source: 'http.server.input',
    kind: 'http.request',
    body: {
      count: 3,
      items: [{value: 'first'}],
      metadata: {'display-name': 'LAS'},
    },
    meta: {},
  },
  inputs: {enabled: true},
  nodes: {},
  last: {},
  workflow: {
    id: 'workflow',
    runId: 'run-1',
    traceId: 'trace-1',
    startedAt: '2026-01-01T00:00:00.000Z',
  },
};

test('resolves exact and interpolated workflow expressions safely', () => {
  const resolved = resolveWorkflowExpressions(
    {
      count: '${{ trigger.body.count }}',
      text: 'item=${{ trigger.body.items[0].value }}',
      label: '${{ trigger.body.metadata["display-name"] }}',
      enabled: '${{ inputs.enabled }}',
    },
    context,
  );

  assert.deepEqual(resolved, {
    count: 3,
    text: 'item=first',
    label: 'LAS',
    enabled: true,
  });
});

test('supports JSON fallbacks and explicit missing-value policies', () => {
  assert.equal(
    resolveWorkflowExpressions(
      '${{ trigger.body.missing ?? "fallback" }}',
      context,
    ),
    'fallback',
  );
  assert.equal(
    resolveWorkflowExpressions('${{ trigger.body.missing }}', context, {
      onMissing: 'empty',
    }),
    '',
  );
  assert.equal(
    resolveWorkflowExpressions('${{ trigger.body.missing }}', context, {
      onMissing: 'preserve',
    }),
    '${{ trigger.body.missing }}',
  );
  assert.throws(
    () => resolveWorkflowExpressions('${{ trigger.body.missing }}', context),
    /value is missing/u,
  );
});

test('rejects executable JSONPath features and malformed expressions', () => {
  const unsafe = '${{ trigger.body.items[?(@.value)] }}';
  assert.throws(
    () => resolveWorkflowExpressions(unsafe, context),
    /Only properties, numeric indexes, and quoted keys/u,
  );
  assert.equal(validateWorkflowExpressionSyntax(unsafe).length, 1);
  assert.equal(
    inspectWorkflowExpressions('${{ process.env }}', context)[0].found,
    false,
  );
  assert.equal(
    validateWorkflowExpressionSyntax('${{ trigger.body.count }').length,
    1,
  );
});

test('accepts expression-backed action fields before runtime resolution', () => {
  const action = actionConfigSchema.parse({
    id: 'dynamic-http',
    type: 'send_http',
    method: 'POST',
    url: '${{ inputs.url }}',
    body: {count: '${{ trigger.body.count }}'},
  });

  assert.equal(action.url, '${{ inputs.url }}');
});
