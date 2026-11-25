import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkerdCpuExperiment,setupSyntheticWorkerd} from '../scripts/cf-free-workerd-cpu.mjs';

for(const source of ['free','paid','subscription']){
  test('CF Free source-only expiry index A/B: '+source,{timeout:120000},async()=>{
    const report={};
    for(const expiryIndex of ['full','partial']){
      const r=await runWorkerdCpuExperiment({samples:1,warmup:0,source,assertionMode:'select',measureBatches:true,expiryIndex});
      assert.equal(r.expiryIndex,expiryIndex);
      assert.equal(r.freeCertified,false);
      assert.equal(r.assertions.realNetworkCalls,0);
      const cases=r.cases.filter(c=>['ai_generate_mock','ai_delivery_ack'].includes(c.category));
      assert.equal(cases.length,2);
      assert.ok(cases.every(c=>c.localD1BatchTotals.calls>0&&c.localD1BatchTotals.statements>0));
      report[expiryIndex]={assertions:r.assertions,routes:Object.fromEntries(cases.map(c=>[c.category,c.localD1BatchTotals]))};
    }
    assert.deepEqual(report.partial.assertions,report.full.assertions);
    // Do not turn an inconclusive index proposal into a production change.
    const total=(mode,key)=>Object.values(report[mode].routes).reduce((sum,r)=>sum+r[key],0);
    const savedWrites=total('full','rowsWritten')-total('partial','rowsWritten');
    console.log('CF_FREE_EXPIRY_INDEX_AB '+JSON.stringify({source,...report,savedWrites,
      batchReadsDelta:total('partial','rowsRead')-total('full','rowsRead'),decision:'EXPERIMENT_ONLY'}));
  });
}

test('CF Free expiry index preserves local cleanup results; report NULL and non-NULL query plans',{timeout:120000},async()=>{
  const report={};
  for(const expiryIndex of ['full','partial']){
    const setup=await setupSyntheticWorkerd({expiryIndex});
    try{
      const db=setup.db,now=Date.now();
      // Mixed history, only a few expired and unfinished requests. This is
      // synthetic plan evidence, not a production cardinality estimate.
      const insert="INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,response_expires_at) VALUES(?,'benchmark-main-user','2026-11-25',?,?,?,?,?,?,?)";
      for(let base=0;base<300;base+=30){
        await db.batch(Array.from({length:30},(_,offset)=>{
          const i=base+offset,expired=i<3,stale=i>=3&&i<6,active=expired||stale;
          return db.prepare(insert).bind('index-'+i,'nonce-index-'+i,active?'reserved':'succeeded',active?0:1,'synthetic',now-660000-i,expired?'awaiting_delivery':stale?'generating':'unknown',expired?now-1000:stale?null:now+600000);
        }));
      }
      const queries=[
        ["expiry","SELECT request_id FROM ai_requests WHERE status='reserved' AND generation_phase='awaiting_delivery' AND response_expires_at IS NOT NULL AND response_expires_at<? ORDER BY response_expires_at,request_id LIMIT 20",[now]],
        ["stale","SELECT request_id FROM ai_requests WHERE status IN ('reserved','uncertain') AND consumed=0 AND generation_phase='generating' AND raw_response IS NULL AND response_expires_at IS NULL AND created_at<? AND delivery_confirmed_at IS NULL AND delivery_confirmation_id IS NULL AND budget_finalization_ref IS NULL ORDER BY created_at,request_id LIMIT 20",[now-600000]]
      ];
      report[expiryIndex]={};
      for(const [name,sql,args] of queries){
        const rows=await db.prepare(sql).bind(...args).all();
        const plan=await db.prepare('EXPLAIN QUERY PLAN '+sql).bind(...args).all();
        report[expiryIndex][name]={ids:rows.results.map(r=>r.request_id),rowsRead:rows.meta?.rows_read??null,plan:plan.results.map(r=>r.detail)};
      }
      assert.equal(setup.getExternalCalls(),0);
    }finally{await setup.mf.dispose();}
  }
  for(const name of ['expiry','stale']){
    assert.equal(report.full[name].ids.length,3);
    assert.deepEqual(report.partial[name].ids,report.full[name].ids);
  }
  console.log('CF_FREE_EXPIRY_INDEX_PLANS '+JSON.stringify(report));
});
