import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeProfiles,classifyBundleFrames} from '../scripts/cf-free-workerd-profiler/profile.mjs';
test('profile aggregation separates idle and absent nodes from sampled functions without URLs',()=>{
 const p={nodes:[{id:1,callFrame:{functionName:'(idle)',url:'secret'}},{id:2,callFrame:{functionName:'parseAIOutput',lineNumber:19,url:'secret'}}],samples:[1,2,2,3]};
 assert.deepEqual(mergeProfiles([p,p]),{profiles:2,sampleCount:8,activeSamples:4,idleSamples:2,unknownSamples:2,hotspots:[{functionName:'parseAIOutput',bundleLine:20,samples:4}]});
});

test('bundle section mapping identifies app versus synthetic adapter without inventing precise source lines',()=>{
 const [g]=classifyBundleFrames([{hotspots:[{bundleLine:2},{bundleLine:4},{bundleLine:null}]}],'// api/src/ai.ts\nfunction generate(){}\n// api/scripts/cf-free-workerd-profiler/worker.mjs\nfunction fetch(){}');
 assert.deepEqual(g.hotspots.map(h=>h.sourceSection),['api/src/ai.ts','api/scripts/cf-free-workerd-profiler/worker.mjs',null]);
});
