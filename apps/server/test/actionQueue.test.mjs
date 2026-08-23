import assert from 'node:assert/strict';
import test from 'node:test';
import {ActionQueue} from '../dist/actionQueue.js';

test('bounds the internal recent-run map to the visible snapshot limit', () => {
  const queue = new ActionQueue(
    0,
    {execute: async () => assert.fail('queued actions must not execute')},
    {append: async () => undefined},
  );
  const ids = [];

  for (let index = 0; index < 75; index += 1) {
    ids.push(
      queue.enqueue({
        action: {
          id: `notification-${index}`,
          type: 'notification',
          title: 'Queue retention test',
          message: String(index),
        },
        event: {
          id: `event-${index}`,
          traceId: `trace-${index}`,
          time: new Date(index).toISOString(),
          source: 'test.action-queue',
          kind: 'manual',
          body: {index},
        },
      }).id,
    );
  }

  assert.equal(queue.recent.size, 50);
  assert.deepEqual(
    queue.snapshot().recent.map(run => run.id),
    ids.slice(-50).reverse(),
  );
  assert.equal(queue.recent.has(ids[24]), false);
  assert.equal(queue.recent.has(ids[25]), true);
});
