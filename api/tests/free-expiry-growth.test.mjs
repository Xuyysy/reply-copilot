import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {runtime} from '../scripts/lib/free-profile-runtime.mjs';
test('measure existing expiry safety transaction growth without replacing its global invariants',{timeout:120000},async()=>{
 const report=[];
 for(const accounts of [100,2000]){
  const r=await runtime({history:1000});try{
   const seq=`WITH RECURSIVE seq(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM seq WHERE i<${accounts})`;
   await r.db.prepare(`${seq} INSERT INTO users(id,email,email_verified_at,created_at) SELECT 'extra-'||i,'extra-'||i||'@example.test',1,1 FROM seq`).run();
   await r.db.prepare(`${seq} INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) SELECT 'extra-'||i,1,0,1,1 FROM seq`).run();
   await r.db.prepare(`${seq} INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) SELECT 'extra-'||i,'extra-'||i,'free','signup',1,1,1,'tracked','active' FROM seq`).run();
   const now=Date.now();await r.db.prepare("UPDATE credit_accounts SET free_generation_reserved=1 WHERE user_id='profile-user'").run();await r.db.prepare("UPDATE credit_batches SET generation_reserved_credits=1 WHERE id='profile-batch'").run();
   await r.db.prepare("INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,raw_response,response_expires_at,budget_finalization_ref) VALUES('profile-user','expired','2026-11-03','expired','reserved',0,'hash',?,'awaiting_delivery','stored synthetic result',?,'finished')").bind(now-700000,now-1000).run();
   await r.db.prepare("INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,state,created_at) VALUES('expired','profile-user','expired','profile-batch','reserved',?)").bind(now-700000).run();
   const a=await r.request('/__profile/expire?scoped=1');assert.equal(a.status,200,a.text);const measured=JSON.parse(a.text);
   assert.equal((await r.db.prepare("SELECT free_generation_reserved FROM credit_accounts WHERE user_id='profile-user'").first()).free_generation_reserved,0);
   assert.equal((await r.db.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_release'").first()).n,1);
   const again=await r.request('/__profile/expire?scoped=1');assert.equal(again.status,200);
   assert.equal((await r.db.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_release'").first()).n,1);
   report.push({accounts,first:measured,duplicate:JSON.parse(again.text)});
  }finally{await r.close()}
 }
 assert.ok(report[1].first.rowsRead>report[0].first.rowsRead*5,'baseline global consistency work must be documented, not hidden');
 if(process.env.FREE_EXPIRY_REPORT)writeFileSync(process.env.FREE_EXPIRY_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
});
