import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePasswordRpcCpu} from '../scripts/cf-free-do-cpu-proof.mjs';

test('real local workerd RPC isolates expensive legacy PBKDF2 from HTTP without weaker hashes',{timeout:120000},async()=>{
  const result=await comparePasswordRpcCpu({samples:3});
  assert.equal(result.status,'SYNTHETIC_LOCAL_ONLY');
  assert.equal(result.freeCertified,false);
  assert.equal(result.productionCertified,false);
  assert.deepEqual(result.comparisons.map(x=>x.mode),['http_local','do_rpc']);
  for(const mode of result.comparisons){
    assert.equal(mode.wrongPasswordDenied,true);
    assert.equal(mode.storedFactorUnchanged,true);
    assert.equal(mode.externalCalls,0);
    assert.deepEqual(mode.cases.map(x=>x.factor),[10000,100000,210000]);
    for(const c of mode.cases)assert.equal(c.wall.metric,'node_dispatch_roundtrip_wall_ms');
  }
  const direct=result.comparisons[0].cases.find(c=>c.factor===100000);
  const offload=result.comparisons[1].cases.find(c=>c.factor===100000);
  assert.equal(direct.httpCpu.status,'SAMPLED');
  assert.equal(offload.verifierCpu.status,'SAMPLED');
  assert.ok(direct.httpCpu.topFunctions.some(x=>x.name==='deriveBits'),'No baseline PBKDF2 CPU samples');
  assert.ok(offload.verifierCpu.topFunctions.some(x=>x.name==='deriveBits'),'No DO PBKDF2 CPU samples');
  // Do NOT label an empty HTTP sample as CPU=0 or as Free eligibility.
  for(const group of result.comparisons)for(const c of group.cases){
    assert.ok(['INSUFFICIENT','SAMPLED'].includes(c.httpCpu.status));
  }
  const output=JSON.stringify(result);
  for(const sensitive of ['synthetic-rpc-proof-pepper','rc_session=','/v1/auth/login','test-100000@example.test'])
    assert.equal(output.includes(sensitive),false);
  console.log(JSON.stringify({event:'local_pbkdf2_rpc_cpu_comparison',freeCertified:false,
    cases:result.comparisons.map(group=>({mode:group.mode,
      samples:group.cases.map(c=>({factor:c.factor,wallP50Ms:c.wall.p50Ms,
        httpCpu:c.httpCpu,verifierCpu:c.verifierCpu??null}))}))}));
});
