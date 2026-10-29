import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,temp} from './helpers/payment-v2.mjs';

buildSync({entryPoints:[new URL('../src/quota.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',outfile:temp+'/production-quota.cjs'});
const {releaseExpiredDeliveryReservations,finishGeneration}=createRequire(import.meta.url)(temp+'/production-quota.cjs');
function prepare(f,{age=11*60000,status='reserved',phase='generating',raw=null,consumed=0,confirmed=null}={}) {
 const now=Date.now();f.env.ENVIRONMENT='production';
 f.sql.prepare("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,raw_response,delivery_confirmed_at,budget_day,budget_reserved_micro_usd) VALUES('stuck','test-user','2026-10-28','nonce',?,?, 'hash',?,?,?,?, '2026-10-28',100)").run(status,consumed,now-age,phase,raw,confirmed);
 f.sql.exec("INSERT INTO ai_budget_days(budget_day,reserved_micro_usd) VALUES('2026-10-28',100); INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at) VALUES('allocation','test-user','stuck','free-batch',1,'reserved',1); UPDATE credit_batches SET generation_reserved_credits=1; UPDATE credit_accounts SET free_generation_reserved=1");
}
const cleanup=f=>releaseExpiredDeliveryReservations(f.env,Date.now(),'test-user');
for(const status of ['reserved','uncertain'])test(`Production releases abandoned ${status} exactly once without changing balances`,async()=>{
 const f=fixture();try{prepare(f,{status});await cleanup(f);await cleanup(f);
 assert.deepEqual({...f.sql.prepare('SELECT free_balance,paid_balance,free_generation_reserved FROM credit_accounts').get()},{free_balance:200,paid_balance:0,free_generation_reserved:0});
 assert.equal(f.sql.prepare('SELECT status FROM ai_requests').get().status,'upstream_failed');
 assert.equal(f.sql.prepare('SELECT state FROM ai_credit_allocations').get().state,'released');
 assert.deepEqual({...f.sql.prepare('SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days').get()},{reserved_micro_usd:0,settled_micro_usd:100});
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_release' AND free_delta=0 AND paid_delta=0").get().n,1);
 }finally{f.sql.close();}
});
for(const [label,options] of [['recent',{age:60000}],['raw result',{raw:'result'}],['consumed',{consumed:1}],['confirmed',{confirmed:1}],['awaiting delivery',{phase:'awaiting_delivery',raw:'result'}],['succeeded',{status:'succeeded'}]])test(`Production keeps ${label} untouched`,async()=>{
 const f=fixture();try{prepare(f,options);await cleanup(f);assert.equal(f.sql.prepare('SELECT state FROM ai_credit_allocations').get().state,'reserved');}finally{f.sql.close();}
});
test('Production budget inconsistency rolls the entire cleanup back',async()=>{
 const f=fixture();try{prepare(f);f.sql.exec('UPDATE ai_budget_days SET reserved_micro_usd=0');await assert.rejects(cleanup(f));assert.equal(f.sql.prepare('SELECT status FROM ai_requests').get().status,'reserved');assert.equal(f.sql.prepare('SELECT state FROM ai_credit_allocations').get().state,'reserved');assert.equal(f.sql.prepare('SELECT free_generation_reserved FROM credit_accounts').get().free_generation_reserved,1);}finally{f.sql.close();}
});
test('late success after cleanup cannot revive the request or debit credits',async()=>{
 const f=fixture();try{prepare(f);await cleanup(f);await finishGeneration(f.env,'test-user','stuck','late result',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:2});assert.equal(f.sql.prepare('SELECT status FROM ai_requests').get().status,'upstream_failed');assert.equal(f.sql.prepare('SELECT raw_response FROM ai_requests').get().raw_response,null);assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts').get().free_balance,200);}finally{f.sql.close();}
});
test('cleanup and late completion or another cleanup do not grant or debit credits twice',async()=>{
 const f=fixture();try{prepare(f);await Promise.all([cleanup(f),cleanup(f),finishGeneration(f.env,'test-user','stuck','late result',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:2})]);const r=f.sql.prepare('SELECT status,raw_response,consumed FROM ai_requests').get();assert.equal(r.consumed,0);assert.ok(r.status==='upstream_failed'||(r.status==='reserved'&&r.raw_response==='late result'));assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts').get().free_balance,200);assert.ok(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_release'").get().n<=1);}finally{f.sql.close();}
});
test('a successful result that wins the race remains available for delivery',async()=>{
 const f=fixture();try{prepare(f);await finishGeneration(f.env,'test-user','stuck','provider result',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:2});await cleanup(f);const row=f.sql.prepare('SELECT status,generation_phase,raw_response FROM ai_requests').get();assert.deepEqual({...row},{status:'reserved',generation_phase:'awaiting_delivery',raw_response:'provider result'});assert.equal(f.sql.prepare('SELECT state FROM ai_credit_allocations').get().state,'reserved');}finally{f.sql.close();}
});
test('multiple abandoned requests have distinct claims and are each released once',async()=>{
 const f=fixture();try{prepare(f);f.sql.exec("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,budget_day,budget_reserved_micro_usd) SELECT 'second',user_id,quota_date,'nonce2',status,0,'hash2',created_at,generation_phase,budget_day,100 FROM ai_requests WHERE request_id='stuck'; INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at) VALUES('allocation2','test-user','second','free-batch',1,'reserved',1); UPDATE credit_batches SET generation_reserved_credits=2; UPDATE credit_accounts SET free_generation_reserved=2; UPDATE ai_budget_days SET reserved_micro_usd=200");
 await releaseExpiredDeliveryReservations(f.env,Date.now());assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM ai_requests WHERE status='upstream_failed'").get().n,2);assert.equal(f.sql.prepare('SELECT COUNT(DISTINCT budget_finalization_ref) n FROM ai_requests').get().n,2);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_release'").get().n,2);assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts').get().free_balance,200);
 }finally{f.sql.close();}
});
test('scoped cleanup does not release another account',async()=>{
 const f=fixture();try{prepare(f);f.sql.exec("INSERT INTO users(id,email,email_verified_at,created_at) VALUES('other','other@example.test',1,1); INSERT INTO credit_accounts(user_id,free_balance,paid_balance,free_generation_reserved,created_at,updated_at) VALUES('other',10,0,1,1,1); INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,generation_reserved_credits,granted_at,history_confidence,status) VALUES('other-batch','other','free','signup',10,10,1,1,'tracked','active'); INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,budget_day,budget_reserved_micro_usd) SELECT 'other-request','other',quota_date,'other-nonce','reserved',0,'other-hash',created_at,'generating',budget_day,100 FROM ai_requests WHERE request_id='stuck'; INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at) VALUES('other-allocation','other','other-request','other-batch',1,'reserved',1); UPDATE ai_budget_days SET reserved_micro_usd=200");
 await cleanup(f);assert.equal(f.sql.prepare("SELECT status FROM ai_requests WHERE user_id='test-user'").get().status,'upstream_failed');assert.equal(f.sql.prepare("SELECT status FROM ai_requests WHERE user_id='other'").get().status,'reserved');assert.equal(f.sql.prepare("SELECT free_generation_reserved FROM credit_accounts WHERE user_id='other'").get().free_generation_reserved,1);
 }finally{f.sql.close();}
});
test('scheduled global cleanup and scoped request cleanup do not release twice',async()=>{
 const f=fixture();try{prepare(f);await Promise.all([releaseExpiredDeliveryReservations(f.env,Date.now()),cleanup(f)]);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_release'").get().n,1);assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts').get().free_balance,200);assert.equal(f.sql.prepare('SELECT free_generation_reserved FROM credit_accounts').get().free_generation_reserved,0);}finally{f.sql.close();}
});
test('late failure racing cleanup cannot release a different reservation in the same millisecond',async()=>{
 const f=fixture(),realNow=Date.now,fixed=realNow();Date.now=()=>fixed;
 try{prepare(f);f.sql.exec("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,budget_day,budget_reserved_micro_usd) SELECT 'fresh',user_id,quota_date,'nonce-fresh','reserved',0,'fresh-hash',created_at+660000,'generating',budget_day,100 FROM ai_requests WHERE request_id='stuck'; INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at) VALUES('allocation-fresh','test-user','fresh','free-batch',1,'reserved',1); UPDATE credit_batches SET generation_reserved_credits=2; UPDATE credit_accounts SET free_generation_reserved=2; UPDATE ai_budget_days SET reserved_micro_usd=200");
 let resume,seen;const gate=new Promise(r=>resume=r),ready=new Promise(r=>seen=r),prepareOriginal=f.env.DB.prepare.bind(f.env.DB);
 f.env.DB.prepare=sql=>{const statement=prepareOriginal(sql);if(sql.startsWith('SELECT credit_batch_id FROM ai_credit_allocations')){const first=statement.first.bind(statement);statement.first=async()=>{const value=await first();seen();await gate;return value;};}return statement;};
 const late=finishGeneration(f.env,'test-user','stuck',null);await ready;await cleanup(f);resume();await late;
 assert.equal(f.sql.prepare("SELECT state FROM ai_credit_allocations WHERE request_id='fresh'").get().state,'reserved');assert.equal(f.sql.prepare('SELECT generation_reserved_credits FROM credit_batches').get().generation_reserved_credits,1);assert.equal(f.sql.prepare('SELECT free_generation_reserved FROM credit_accounts').get().free_generation_reserved,1);assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts').get().free_balance,200);
 }finally{Date.now=realNow;f.sql.close();}
});
