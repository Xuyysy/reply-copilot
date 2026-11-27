import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSyntheticWorkerd} from '../scripts/cf-free-workerd-cpu.mjs';

test('actual scheduled export on isolated Workerd D1 preserves allocations and prunes orphan rows',{timeout:120000},async()=>{
 const f=await setupSyntheticWorkerd({source:'subscription',productionProvider:'legacy',syntheticUpstream:()=>{throw Error('Unexpected synthetic provider call')}});
 try {
  const db=f.db,u='benchmark-main-user',now=Date.now(),old=now-31*86400000;
  const run=(q,...args)=>db.prepare(q).bind(...args).run();
  const all=async(q,...args)=>(await db.prepare(q).bind(...args).all()).results;
  const seed=(id,status)=>run("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,completed_at,raw_response,response_expires_at,generation_phase) VALUES(?,?,'2026-10-27',?,?,?,'synthetic-hash',?,?,'synthetic-payload',?,'unknown')",id,u,'nonce:'+id,status,status==='succeeded'?1:0,old,old+1,now-1000);
  await run("INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES('synthetic-period',0,1,0,1)");
  for(const [id,status] of [['credit-parent','upstream_failed'],['sub-parent','succeeded'],['orphan','succeeded']])await seed(id,status);
  await run("INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,state,created_at,released_at) VALUES('credit-ref',?,'credit-parent','synthetic-credit-batch','released',?,?)",u,old,old+1);
  await run("INSERT INTO subscription_ai_allocations(id,user_id,request_id,period_id,day_index,state,created_at,consumed_at) VALUES('sub-ref',?,'sub-parent','synthetic-period',0,'consumed',?,?)",u,old,old+1);
  await run("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES('expired-cron-session','fake-cron-token',?,'web',1,?)",u,now-2*86400000);
  const tables=['credit_accounts','credit_batches','ai_credit_allocations','subscription_ai_allocations','subscription_daily_usage','subscription_orders','subscription_periods','credit_ledger','subscription_usage_events'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,await all('SELECT * FROM '+t+' ORDER BY 1,2')])));
  const before=await snapshot();
  // Negative control: genuine local D1, not an exception stub. No remote DB.
  await assert.rejects(run("DELETE FROM ai_requests WHERE created_at<? AND status IN ('succeeded','upstream_failed')",now-30*86400000),/FOREIGN KEY constraint failed|SQLITE_CONSTRAINT/i);
  const service=await f.mf.getWorker('cf-free-offline-synthetic');
  const dispatch=async()=>{const r=await service.scheduled({cron:'0 3 * * *',scheduledTime:new Date(now)});assert.equal(r.outcome,'ok',JSON.stringify(r));};
  await dispatch();
  const rows=await all("SELECT request_id,raw_response,response_expires_at FROM ai_requests ORDER BY request_id");
  assert.deepEqual(rows,[{request_id:'credit-parent',raw_response:null,response_expires_at:null},{request_id:'sub-parent',raw_response:null,response_expires_at:null}]);
  assert.equal((await all("SELECT count(*) n FROM sessions WHERE id='expired-cron-session'"))[0].n,0);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual(await all('PRAGMA foreign_key_check'),[]);
  await dispatch();
  assert.deepEqual(await all("SELECT request_id,raw_response,response_expires_at FROM ai_requests ORDER BY request_id"),rows);
  assert.deepEqual(await snapshot(),before);
  assert.equal(f.getExternalCalls(),0);
  console.log('XRH_CRON_WORKERD '+JSON.stringify({scope:'SYNTHETIC_LOCAL_D1',scheduledRuns:2,outcome:'ok',retained:2,pruned:1,financialRowsUnchanged:true,externalCalls:0,idempotent:true}));
 }finally{await f.mf.dispose();}
});
