import test from 'node:test';
import assert from 'node:assert/strict';
import {runCampaignBatches} from '../src/lib/campaign-runner.mjs';
const stats=(remaining,succeeded=0)=>({total:remaining+succeeded,remaining,succeeded,failed:0});
test('explicit invocation sends sequential independent batches',async()=>{
 let calls=0,inflight=0;const operationIds=[];const updates=[];
 const sendBatch=async()=>{assert.equal(inflight++,0);operationIds.push(`operation-${++calls}`);await Promise.resolve();inflight--;return {stats:stats(6-calls*3,calls*3)};};
 assert.equal(calls,0);
 const result=await runCampaignBatches({initialStats:stats(6),sendBatch,onProgress:s=>updates.push(s),shouldStop:()=>false});
 assert.equal(result.reason,'complete');assert.equal(calls,2);assert.equal(updates.length,2);assert.equal(new Set(operationIds).size,2);
});
test('uncertain request stops immediately without retry',async()=>{
 let calls=0;const error=new Error('network result unknown');const result=await runCampaignBatches({initialStats:stats(9),sendBatch:async()=>{calls++;throw error;},onProgress:()=>assert.fail(),shouldStop:()=>false});
 assert.equal(calls,1);assert.equal(result.reason,'error');assert.equal(result.error,error);
});
test('no progress and malformed response stop safely',async()=>{
 for(const response of [{stats:stats(9)},{}]) {let calls=0;const result=await runCampaignBatches({initialStats:stats(9),sendBatch:async()=>{calls++;return response;},onProgress:()=>{},shouldStop:()=>false});assert.equal(calls,1);assert.ok(['no-progress','uncertain'].includes(result.reason));}
});
test('stop waits for current batch, resume starts from latest progress',async()=>{
 let stop=false,calls=0;const result=await runCampaignBatches({initialStats:stats(9),sendBatch:async()=>{calls++;stop=true;return {stats:stats(6,3)};},onProgress:()=>{},shouldStop:()=>stop});assert.equal(result.reason,'stopped');assert.equal(calls,1);assert.equal(result.stats.remaining,6);
 stop=false;const resumed=await runCampaignBatches({initialStats:result.stats,sendBatch:async()=>{calls++;return {stats:stats(0,9)};},onProgress:()=>{},shouldStop:()=>stop});assert.equal(resumed.reason,'complete');assert.equal(calls,2);
});
test('250 batch ceiling; complete and stopped work send nothing',async()=>{
 let calls=0;const options={initialStats:stats(1000),sendBatch:async()=>({stats:stats(1000-++calls,calls)}),onProgress:()=>{},shouldStop:()=>false,maxBatches:999};const result=await runCampaignBatches(options);assert.equal(result.reason,'limit');assert.equal(calls,250);
 for(const extra of [{initialStats:stats(0)},{shouldStop:()=>true}]){await runCampaignBatches({...options,...extra});assert.equal(calls,250);}
});
