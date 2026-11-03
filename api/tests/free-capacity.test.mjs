import test from 'node:test';
import assert from 'node:assert/strict';
import {capacity} from '../scripts/lib/free-capacity.mjs';
test('capacity includes shared staging, cache misses and expiry cost without claiming CPU compatibility',()=>{
 const a=capacity({dashboards:100,cacheMisses:0}),b=capacity({dashboards:100,cacheMisses:100});
 assert.equal(b.reads-a.reads,100*a.coldExtra);assert.equal(a.cpuCompatible.startsWith('not established'),true);
 assert.equal(capacity({stageReads:6000000}).withinDailyFreeCounts,false);
 assert.equal(capacity({generations:5000}).withinDailyFreeCounts,false);
 assert.throws(()=>capacity({cacheMisses:21,dashboards:20}));assert.throws(()=>capacity({users:-1}));
});
