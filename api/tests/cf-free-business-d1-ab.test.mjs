import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkerdCpuExperiment} from '../scripts/cf-free-workerd-cpu.mjs';

for(const source of ['free','paid','subscription']){
  test('CF Free real local D1 batch A/B: '+source,{timeout:120000},async()=>{
    const report={};
    for(const assertionMode of ['legacy','select']){
      const r=await runWorkerdCpuExperiment({samples:1,warmup:0,source,assertionMode,measureBatches:true});
      assert.equal(r.freeCertified,false);
      assert.equal(r.assertions.realNetworkCalls,0);
      const cases=r.cases.filter(c=>['ai_generate_mock','ai_delivery_ack'].includes(c.category));
      assert.equal(cases.length,2);
      for(const c of cases){
        assert.ok(c.localD1BatchTotals.calls>0);
        assert.ok(c.localD1BatchTotals.statements>0);
        assert.ok(c.localD1BatchTotals.rowsWritten>0);
      }
      report[assertionMode]={assertions:r.assertions,routes:Object.fromEntries(cases.map(c=>[c.category,c.localD1BatchTotals]))};
    }
    assert.deepEqual(report.select.assertions,report.legacy.assertions);
    for(const key of ['ai_generate_mock','ai_delivery_ack']){
      assert.ok(report.select.routes[key].statements<report.legacy.routes[key].statements,key+' statement reduction');
      assert.ok(report.select.routes[key].rowsWritten<report.legacy.routes[key].rowsWritten,key+' write reduction');
    }
    console.log('CF_FREE_BUSINESS_D1_AB '+JSON.stringify({source,...report}));
  });
}
