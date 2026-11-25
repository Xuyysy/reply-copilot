import assert from 'node:assert/strict';
import {runWorkerdCpuExperiment} from './cf-free-workerd-cpu.mjs';
for(const source of ['free','paid','subscription']){
 const r=await runWorkerdCpuExperiment({source,samples:2,warmup:0,assertionMode:'select',expiryIndex:'partial',measureBatches:true});
 const routes=Object.fromEntries(r.cases.map(c=>[c.category,{standalone:c.localD1StandaloneCalls,batches:c.localD1BatchTotals.calls,rowsReadInBatch:c.localD1BatchTotals.rowsRead,rowsWrittenInBatch:c.localD1BatchTotals.rowsWritten}]));
 assert.ok(Object.values(routes).every(x=>Number.isSafeInteger(x.standalone)&&x.standalone>=0));
 assert.equal(r.assertions.realNetworkCalls,0);
 console.log('CF_FREE_HOT_PATH_FULL_CALLS '+JSON.stringify({source,scope:'LOCAL_WORKERD_ONLY',routes,assertions:r.assertions}));
}
