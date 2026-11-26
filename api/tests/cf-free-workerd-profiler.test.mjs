import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeProfiles} from '../scripts/cf-free-workerd-profiler/profile.mjs';
test('profile aggregation separates idle and absent nodes from sampled functions without URLs',()=>{
 const p={nodes:[{id:1,callFrame:{functionName:'(idle)',url:'secret'}},{id:2,callFrame:{functionName:'parseAIOutput',lineNumber:19,url:'secret'}}],samples:[1,2,2,3]};
 assert.deepEqual(mergeProfiles([p,p]),{profiles:2,sampleCount:8,activeSamples:4,idleSamples:2,unknownSamples:2,hotspots:[{functionName:'parseAIOutput',bundleLine:20,samples:4}]});
});
