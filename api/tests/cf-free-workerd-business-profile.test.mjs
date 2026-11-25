import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkerdCpuExperiment} from '../scripts/cf-free-workerd-cpu.mjs';
import {ROUTES,parseOptions} from '../scripts/lib/workerd-cpu-evidence.mjs';

test('CF Free local profiler rejects unknown funding sources and oversized workloads',()=>{
  assert.equal(parseOptions(['--source','subscription']).source,'subscription');
  for(const args of [['--source','production'],['--source'],['--samples','5'],['--warmup','2'],['--remote']])assert.throws(()=>parseOptions(args));
});

for(const source of ['free','paid','subscription']){
  test('CF Free workerd offline business routes: '+source,{timeout:60000},async()=>{
    const report=await runWorkerdCpuExperiment({samples:1,warmup:0,source});
    assert.equal(report.source,source);
    assert.equal(report.freeCertified,false);
    assert.equal(report.productionHotspotsConfirmed,false);
    assert.equal(report.assertions.realNetworkCalls,0);
    assert.equal(report.assertions.endingReservedCredits,0);
    assert.equal(report.assertions.creditDebits,source==='subscription'?0:1);
    assert.equal(report.assertions.subscriptionUsed,source==='subscription'?1:0);
    assert.deepEqual(report.cases.map(x=>x.category),ROUTES);
    console.log('CF_FREE_OFFLINE_ROUTE_PROFILE '+JSON.stringify(report));
  });
}
