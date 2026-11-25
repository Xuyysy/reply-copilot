// One integrated lab, all three funding sources, no remote D1 or cloud operations.
import assert from 'node:assert/strict';
import {runWorkerdCpuExperiment} from './cf-free-workerd-cpu.mjs';
const configurations={baseline:{passwordMode:'native',assertionMode:'legacy',expiryIndex:'full'},
  candidate:{passwordMode:'wasm_do',assertionMode:'select',expiryIndex:'partial'}};
for(const source of ['free','paid','subscription']){
  const results={};
  for(const [name,options] of Object.entries(configurations)){
    // V8 sampling and D1 instrumentation are distinct passes.
    const profile=await runWorkerdCpuExperiment({source,...options,extendedLogin:true,samples:4,warmup:1,profile:true});
    const batches=await runWorkerdCpuExperiment({source,...options,extendedLogin:true,samples:2,warmup:0,measureBatches:true});
    assert.equal(profile.cases.length,11);assert.equal(batches.cases.length,11);
    assert.equal(profile.assertions.realNetworkCalls,0);assert.equal(batches.assertions.realNetworkCalls,0);
    results[name]={profile,batches};
  }
  assert.deepEqual(results.baseline.profile.assertions,results.candidate.profile.assertions);
  assert.deepEqual(results.baseline.batches.assertions,results.candidate.batches.assertions);
  const routes=['ai_generate_mock','ai_delivery_ack'];
  const totals=(r,key)=>r.batches.cases.filter(x=>routes.includes(x.category)).reduce((n,x)=>n+x.localD1BatchTotals[key],0);
  const before=totals(results.baseline,'rowsWritten'),after=totals(results.candidate,'rowsWritten');
  assert.ok(after<before,'combined candidate must reduce measured generation and ACK batch writes');
  const result={source,scope:'LOCAL_WORKERD_ONLY',freeCertified:false,matchedAccounting:true,
    measuredGenerationAckWrites:{baseline:before,candidate:after,delta:after-before},
    baseline:results.baseline,candidate:results.candidate};
  console.log('CF_FREE_INTEGRATED_BUSINESS_AB '+JSON.stringify(result));
}
