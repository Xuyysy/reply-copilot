import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {temp} from './helpers/payment-v2.mjs';
buildSync({entryPoints:[new URL('../src/quota.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',outfile:temp+'/quota.cjs'});
const {finishGeneration}=createRequire(import.meta.url)(temp+'/quota.cjs');
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';
function stuck(f,{age=11*60000,phase='generating',raw=null,consumed=0,status='reserved'}={}){
 const now=Date.now();
 f.sql.prepare("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,raw_response,budget_day,budget_reserved_micro_usd) VALUES('stuck','test-user','2026-10-28','nonce',?,?, 'hash',?,?,?,'2026-10-28',100)").run(status,consumed,now-age,phase,raw);
 f.sql.exec("INSERT INTO ai_budget_days(budget_day,reserved_micro_usd) VALUES('2026-10-28',100); INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,credits,state,created_at) VALUES('allocation','test-user','stuck','free-batch',1,'reserved',1); UPDATE credit_batches SET generation_reserved_credits=1; UPDATE credit_accounts SET free_generation_reserved=1");
}
async function usage(f){return f.call('/v1/usage',{method:'GET'});}
for(const status of ['reserved','uncertain'])test('Staging timed out '+status+' releases only reservation, retains cost, and is idempotent',async()=>{
 const f=fixture();try{stuck(f,{status});const r=await usage(f);assert.equal(r.status,200);assert.equal(r.body.quota.freeRemaining,200);
 assert.deepEqual({...f.sql.prepare('SELECT free_balance,free_generation_reserved FROM credit_accounts').get()},{free_balance:200,free_generation_reserved:0});
 assert.equal(f.sql.prepare('SELECT consumed FROM ai_requests').get().consumed,0);
 assert.equal(f.sql.prepare('SELECT state FROM ai_credit_allocations').get().state,'released');
 assert.deepEqual({...f.sql.prepare('SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days').get()},{reserved_micro_usd:0,settled_micro_usd:100});
 await usage(f);assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_release'").get().n,1);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,0);
 }finally{f.sql.close();}
});
for(const [label,opts] of [['recent',{age:60000}],['result',{raw:'valid-result'}],['consumed',{consumed:1}],['awaiting',{phase:'awaiting_delivery',raw:'valid-result'}]])test('does not release '+label,async()=>{const f=fixture();try{stuck(f,opts);await usage(f);assert.equal(f.sql.prepare('SELECT state FROM ai_credit_allocations').get().state,'reserved');}finally{f.sql.close();}});
test('Production timeout policy stays untouched',async()=>{const f=fixture();try{stuck(f);f.env.ENVIRONMENT='production';await usage(f);assert.equal(f.sql.prepare('SELECT state FROM ai_credit_allocations').get().state,'reserved');}finally{f.sql.close();}});
test('unauthenticated caller cannot trigger scoped release',async()=>{const f=fixture();try{stuck(f);assert.equal((await f.call('/v1/usage',{method:'GET',headers:{Cookie:''}})).status,401);assert.equal(f.sql.prepare('SELECT state FROM ai_credit_allocations').get().state,'reserved');}finally{f.sql.close();}});
test('reservation inconsistency rolls the whole cleanup back',async()=>{const f=fixture();try{stuck(f);f.sql.exec('UPDATE ai_budget_days SET reserved_micro_usd=0');assert.equal((await usage(f)).status,503);assert.equal(f.sql.prepare('SELECT status FROM ai_requests').get().status,'reserved');assert.equal(f.sql.prepare('SELECT state FROM ai_credit_allocations').get().state,'reserved');assert.equal(f.sql.prepare('SELECT free_generation_reserved FROM credit_accounts').get().free_generation_reserved,1);assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_release'").get().n,0);}finally{f.sql.close();}});
test('authenticated usage never releases another users stale request',async()=>{const f=fixture();try{stuck(f);f.sql.exec("BEGIN; PRAGMA defer_foreign_keys=ON; INSERT INTO users(id,email,email_verified_at,created_at) VALUES('other','other@example.test',1,1); UPDATE ai_requests SET user_id='other'; UPDATE ai_credit_allocations SET user_id='other'; COMMIT");await usage(f);assert.equal(f.sql.prepare('SELECT status FROM ai_requests').get().status,'reserved');}finally{f.sql.close();}});

test('late provider completion cannot resurrect a released request or charge twice',async()=>{const f=fixture();try{stuck(f);await usage(f);await finishGeneration(f.env,'test-user','stuck','late-result',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:2});await finishGeneration(f.env,'test-user','stuck',null);assert.equal(f.sql.prepare('SELECT status FROM ai_requests').get().status,'upstream_failed');assert.equal(f.sql.prepare('SELECT raw_response FROM ai_requests').get().raw_response,null);assert.equal(f.sql.prepare('SELECT settled_micro_usd FROM ai_budget_days').get().settled_micro_usd,100);assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts').get().free_balance,200);}finally{f.sql.close();}});
