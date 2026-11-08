import test from 'node:test';
import assert from 'node:assert/strict';
import {createMomentumMutationQueue} from '../../services/creator-momentum.js';

test('momentum preference mutations commit in received order even when an earlier write is slow', async () => {
  const run = createMomentumMutationQueue();
  const started = [];
  const committed = [];
  let releaseFirst;
  const first = run(async () => {
    started.push('on');
    await new Promise(resolve => { releaseFirst = resolve; });
    committed.push('on');
    return true;
  });
  const second = run(async () => { started.push('off'); committed.push('off'); return false; });
  const third = run(async () => { started.push('on-final'); committed.push('on-final'); return true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, ['on']);
  releaseFirst();
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(await third, true);
  assert.deepEqual(started, ['on', 'off', 'on-final']);
  assert.deepEqual(committed, ['on', 'off', 'on-final']);
});

test('a failed mutation does not poison later preference writes', async () => {
  const run = createMomentumMutationQueue();
  await assert.rejects(run(async () => { throw Error('storage failure'); }), /storage failure/);
  assert.equal(await run(async () => 'saved'), 'saved');
});
