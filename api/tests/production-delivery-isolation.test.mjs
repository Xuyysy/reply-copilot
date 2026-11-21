import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fixture,temp} from './helpers/payment-v2.mjs';
buildSync({entryPoints:[new URL('../src/quota.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',outfile:temp+'/delivery-isolation.cjs'});
const {reserveGeneration,finishGeneration}=createRequire(import.meta.url)(temp+'/delivery-isolation.cjs');
const session={user_id:'test-user',kind:'extension'};
const reserve=(f,id,hash=id)=>reserveGeneration(f.env,session,id,hash,100);
async function ready(f){f.env.ENVIRONMENT='production';await reserve(f,'11111111-1111-4111-8111-111111111111');await finishGeneration(f.env,'test-user','11111111-1111-4111-8111-111111111111','stored result',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});}
test('an unacknowledged generated result does not block an independent next reply',async()=>{const f=fixture();try{await ready(f);assert.equal((await reserve(f,'22222222-2222-4222-8222-222222222222')).kind,'new');assert.deepEqual({...f.sql.prepare('SELECT free_balance,free_generation_reserved FROM credit_accounts').get()},{free_balance:200,free_generation_reserved:2});assert.equal(f.sql.prepare("SELECT raw_response FROM ai_requests WHERE request_id='11111111-1111-4111-8111-111111111111'").get().raw_response,'stored result');assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,0);}finally{f.sql.close();}});
test('a genuine provider generation never blocks a separately funded next request',async()=>{const f=fixture();try{f.env.ENVIRONMENT='production';await reserve(f,'first');assert.equal((await reserve(f,'22222222-2222-4222-8222-222222222222')).kind,'new');assert.equal(f.sql.prepare('SELECT free_generation_reserved FROM credit_accounts').get().free_generation_reserved,2);}finally{f.sql.close();}});
test('pending result replay remains idempotent and enforces the original payload',async()=>{const f=fixture();try{await ready(f);assert.equal((await reserve(f,'11111111-1111-4111-8111-111111111111')).raw,'stored result');await assert.rejects(reserve(f,'11111111-1111-4111-8111-111111111111','different'),e=>e.code==='IDEMPOTENCY_CONFLICT');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM ai_requests').get().n,1);assert.equal(f.sql.prepare('SELECT free_generation_reserved FROM credit_accounts').get().free_generation_reserved,1);}finally{f.sql.close();}});
test('a pending delivery never bypasses remaining account quota',async()=>{const f=fixture();try{f.sql.exec('UPDATE credit_accounts SET free_balance=1; UPDATE credit_batches SET grant_credits=1,remaining_credits=1');await ready(f);await assert.rejects(reserve(f,'22222222-2222-4222-8222-222222222222'),e=>e.code==='INSUFFICIENT_CREDITS');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM ai_requests').get().n,1);}finally{f.sql.close();}});
test('concurrent next requests get independent credit reservations while first awaits ACK',async()=>{const f=fixture();try{await ready(f);const results=await Promise.allSettled([reserve(f,'next-a'),reserve(f,'next-b')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,2);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM ai_requests WHERE status='reserved' AND generation_phase='generating'").get().n,2);assert.equal(f.sql.prepare('SELECT free_generation_reserved FROM credit_accounts').get().free_generation_reserved,3);}finally{f.sql.close();}});
test('acknowledging either result debits only its own allocation and duplicate ack is harmless',async()=>{const f=fixture();try{await ready(f);await reserve(f,'22222222-2222-4222-8222-222222222222');await finishGeneration(f.env,'test-user','22222222-2222-4222-8222-222222222222','next result',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});f.sql.exec("UPDATE sessions SET kind='extension'");const headers={Authorization:'Bearer '+'b'.repeat(64),Origin:f.env.EXTENSION_ORIGIN};for(const id of ['22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111']){const r=await f.call('/v1/ai/requests/'+id+'/delivered',{headers,body:{requestId:id}});assert.equal(r.status,200,JSON.stringify(r.body));}assert.deepEqual({...f.sql.prepare('SELECT free_balance,free_generation_reserved FROM credit_accounts').get()},{free_balance:198,free_generation_reserved:0});assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,2);assert.equal(f.sql.prepare('SELECT consumed_credits FROM credit_batches').get().consumed_credits,2);}finally{f.sql.close();}});

test('two concurrent requests for last paid credit reserve once and repeated ACK never double-debits',async()=>{
 const f=fixture();try{
   f.env.ENVIRONMENT='production';
   f.sql.exec("UPDATE credit_accounts SET free_balance=0,paid_balance=1; UPDATE credit_batches SET bucket='paid',grant_credits=1,remaining_credits=1,generation_reserved_credits=0,consumed_credits=0");
   const ids=['77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888'];
   const results=await Promise.allSettled(ids.map(id=>reserve(f,id)));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'only one provider can reserve the last paid credit');
   assert.equal(f.sql.prepare('SELECT paid_generation_reserved FROM credit_accounts').get().paid_generation_reserved,1);
   const winner=ids[results.findIndex(r=>r.status==='fulfilled')];
   await finishGeneration(f.env,'test-user',winner,'valid result',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
   f.sql.exec("UPDATE sessions SET kind='extension'");
   const headers={Authorization:'Bearer '+'b'.repeat(64),Origin:f.env.EXTENSION_ORIGIN};
   for(let attempt=0;attempt<2;attempt++){
     const result=await f.call('/v1/ai/requests/'+winner+'/delivered',{headers,body:{requestId:winner}});
     assert.equal(result.status,200,JSON.stringify(result.body));
     assert.equal(result.body.alreadyConfirmed,attempt===1);
   }
   assert.deepEqual({...f.sql.prepare('SELECT free_balance,paid_balance,free_generation_reserved,paid_generation_reserved FROM credit_accounts').get()},{free_balance:0,paid_balance:0,free_generation_reserved:0,paid_generation_reserved:0});
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,1);
 }finally{f.sql.close();}
});

for(const [label,update] of [['missing result',"raw_response=NULL"],['missing expiry',"response_expires_at=NULL"],['unknown phase',"generation_phase='unknown'"]])test(`an incomplete old ${label} does not gate a different request`,async()=>{const f=fixture();try{await ready(f);f.sql.exec(`UPDATE ai_requests SET ${update}`);assert.equal((await reserve(f,'new-request')).kind,'new');assert.equal(f.sql.prepare('SELECT free_generation_reserved FROM credit_accounts').get().free_generation_reserved,2);}finally{f.sql.close();}});
test('an unacknowledged result cannot bypass the daily cost budget',async()=>{const f=fixture();try{await ready(f);f.sql.exec("UPDATE system_settings SET value='1' WHERE key='daily_cost_limit_micro_usd'");await assert.rejects(reserve(f,'new-request'),e=>e.code==='AI_BUDGET_EXHAUSTED');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM ai_requests').get().n,1);}finally{f.sql.close();}});
