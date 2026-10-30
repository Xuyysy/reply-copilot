import test from 'node:test';
import assert from 'node:assert/strict';
import {generationFixture} from '../scripts/lib/generation-performance-fixture.mjs';
const sourceRoot=new URL('..',import.meta.url).pathname;

test('instrumented content→background→hosted→provider→ACK→editor fixture records timings and exactly one debit',async()=>{
 const run=await generationFixture({sourceRoot});
 assert.deepEqual(run.calls,{generations:1,acks:1,debits:1,insertions:1});
 assert.equal(run.report.outcomes.success,1);
 assert.ok(run.report.metrics.editor_verified.p50>=80);
 for(const stage of ['reply_click','editor_bound','precheck_complete','background_dispatch','background_return','candidates_shown','insert_started','editor_verified','ack','cloud_generate','history_context','owner_check'])assert.ok(run.report.metrics[stage],stage);
 assert.ok(run.marks.insert>=run.marks.ack_end,'draft never appears before ACK');
});
for(const [name,options,expected] of [
 ['closed composer',{closeDuringGeneration:true},{generations:1,acks:1,debits:1,insertions:0}],
 ['user typed while generating',{draftDuringGeneration:true},{generations:1,acks:1,debits:1,insertions:0}],
 ['ACK unavailable',{ackLost:true},{generations:1,acks:1,debits:0,insertions:0}],
 ['invalid three-reply output',{invalidOutput:true},{generations:1,acks:0,debits:0,insertions:0}],
 ['private DNS',{dnsPrivate:true},{generations:0,acks:0,debits:0,insertions:0}],
 ['offline',{offline:true},{generations:0,acks:0,debits:0,insertions:0}],
 ['no credits',{quotaExhausted:true},{generations:0,acks:0,debits:0,insertions:0}],
])test('critical-path changes protect '+name,async()=>{
 const run=await generationFixture({sourceRoot,options:{...options,waitForFailure:true}});
 assert.deepEqual(run.calls,expected);assert.equal(run.elapsedMs,null);
});


test('default-off diagnostics do not change the ACK-to-draft contract',async()=>{
 const run=await generationFixture({sourceRoot,options:{diagnostics:false}});
 assert.deepEqual(run.calls,{generations:1,acks:1,debits:1,insertions:1});
 assert.equal(run.report.samples,0);assert.ok(run.marks.insert>=run.marks.ack_end);
});
