import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryRefresh } from '../options/history-list.js';

test('concurrent history refresh commits only the latest complete snapshot', async () => {
  const pending = [], commits = [];
  const refresh = createHistoryRefresh(() => new Promise(resolve => pending.push(resolve)), rows => commits.push(rows));
  const old = refresh(), latest = refresh();
  pending[1]([{ id: 'new' }]); await latest;
  pending[0]([{ id: 'old' }]); await old;
  assert.deepEqual(commits, [[{ id: 'new' }]]);
});
test('identical reply text from separate saved records remains intact', async () => {
  const rows = [{ id: 'a', reply: 'same' }, { id: 'b', reply: 'same' }];
  let result;
  await createHistoryRefresh(async () => rows, value => { result = value; })();
  assert.deepEqual(result, rows);
});
