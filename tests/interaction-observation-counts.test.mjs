import test from 'node:test';
import assert from 'node:assert/strict';
import {safeObservationCounts} from '../interaction-manager/sync/diagnostic.js';
test('observation summary distinguishes repeats, empty pages and quality without leaking unknown fields',()=>{
 const counts={accepted:3,existing:2,emptyPages:1,unsupported:2,unresolvedActors:0,foreignTargets:1,ignored:4,raw:'private fixture'};
 const clean=safeObservationCounts(counts,3,1);
 assert.deepEqual(clean,{accepted:3,existing:2,emptyPages:1,unsupported:2,unresolvedActors:0,foreignTargets:1,ignored:4});
 assert.equal(safeObservationCounts(counts,3,0),null);assert.equal(safeObservationCounts({...counts,emptyPages:4},3,1),null);assert.equal(safeObservationCounts({...counts,unsupported:-1},3,1),null);
 assert.equal(safeObservationCounts(counts,0,1),null);assert.equal(safeObservationCounts(null,3,1),null);
});
