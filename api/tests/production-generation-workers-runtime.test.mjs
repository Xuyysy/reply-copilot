import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';

test('Production stale-generation cleanup is atomic under real Workers D1 concurrent calls',async()=>{
 const script=buildSync({stdin:{contents:`import {releaseExpiredDeliveryReservations,finishGeneration} from './api/src/quota.ts';export default {async fetch(req,env){const action=new URL(req.url).pathname;if(action==='/global')await releaseExpiredDeliveryReservations(env,Date.now());else if(action==='/scoped')await releaseExpiredDeliveryReservations(env,Date.now(),'test-user');else if(action==='/late')await finishGeneration(env,'test-user','stuck',null);return new Response('ok')}}`,resolveDir:process.cwd(),sourcefile:'production-timeout-runtime.ts'},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'}).outputFiles[0].text;
 const mf=new Miniflare({workers:[{config:{name:'production-timeout-test',compatibilityDate:'2026-10-14',env:{DB:{type:'d1',id:'isolated-production-timeout'},ENVIRONMENT:{type:'text',value:'production'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:script}}}}}]});
 try{
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()){
   const sql=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replace(/^\s*--.*$/gm,'');
   for(const statement of sql.split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();
  }
  const statements=[
   "INSERT INTO users(id,email,email_verified_at,created_at) VALUES('test-user','isolated@example.test',1,1)",
   "INSERT INTO credit_accounts(user_id,free_balance,paid_balance,free_generation_reserved,created_at,updated_at) VALUES('test-user',200,0,1,1,1)",
   "INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,generation_reserved_credits,granted_at,history_confidence,status) VALUES('batch','test-user','free','signup',200,200,1,1,'tracked','active')",
   "INSERT INTO ai_budget_days(budget_day,reserved_micro_usd) VALUES('2026-10-28',100)",
   `INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,budget_day,budget_reserved_micro_usd) VALUES('stuck','test-user','2026-10-28','nonce','reserved',0,'hash',${Date.now()-660000},'generating','2026-10-28',100)`,
   "INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at) VALUES('allocation','test-user','stuck','batch',1,'reserved',1)"
  ];
  for(const sql of statements)await db.prepare(sql).run();
  const responses=await Promise.all(['/global','/scoped','/late','/global'].map(path=>mf.dispatchFetch('https://isolated.test'+path)));
  for(const r of responses)assert.equal(r.status,200);
  assert.deepEqual(await db.prepare('SELECT free_balance,free_generation_reserved FROM credit_accounts').first(),{free_balance:200,free_generation_reserved:0});
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_release' AND free_delta=0 AND paid_delta=0").first()).n,1);
  assert.equal((await db.prepare('SELECT status FROM ai_requests').first()).status,'upstream_failed');
 }finally{await mf.dispose();}
});
