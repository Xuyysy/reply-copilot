import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fixture,temp} from './helpers/payment-v2.mjs';
import {GENERATION_TOTALS_SQL} from '../src/admin-read-queries.js';
buildSync({entryPoints:[new URL('../src/quota.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',outfile:temp+'/stats-quota.cjs'});
const {reserveGeneration,finishGeneration}=createRequire(import.meta.url)(temp+'/stats-quota.cjs');
const NOW=Date.UTC(2026,10,1,0,1),DAY=Date.UTC(2026,10,1),MONTH=DAY;
const counts=(f,now=NOW)=>({...f.sql.prepare(GENERATION_TOTALS_SQL).get(Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth(),new Date(now).getUTCDate()),Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth(),1),now)});
function insert(f,id,{status='succeeded',consumed=1,created=NOW-10000,completed=null,ack=NOW-1000,marker='confirmation',phase='awaiting_delivery'}={}){
 f.sql.prepare(`INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,completed_at,generation_phase,delivery_confirmed_at,delivery_confirmation_id) VALUES('test-user',?,'2026-11-01',?,?,?,'hash',?,?,?,?,?)`).run(id,id,status,consumed,created,completed,phase,ack,marker);
}
test('confirmed deliveries use ACK time even with NULL/different completed time; ambiguous legacy/provider-only records never count',()=>{
 const f=fixture();try{
  insert(f,'modern');insert(f,'historical-ack',{created:DAY-86400000,completed:DAY-1000,phase:'unknown'});
  insert(f,'old-no-ack',{completed:NOW-1,ack:null,marker:null,phase:'unknown'});
  insert(f,'provider-only',{status:'reserved',consumed:0,completed:NOW-1,ack:null,marker:null});
  insert(f,'failed',{status:'upstream_failed',consumed:0,completed:NOW-1,ack:null,marker:null});
  insert(f,'expired',{status:'uncertain',consumed:0,completed:NOW-1,ack:null,marker:null});
  insert(f,'bad-marker',{marker:''});insert(f,'missing-marker',{marker:null});insert(f,'not-consumed',{consumed:0});
  insert(f,'future',{ack:NOW+1});insert(f,'previous-month',{ack:DAY-1,completed:NOW-1});
  assert.deepEqual(counts(f),{monthGenerations:2,todayGenerations:2});
 }finally{f.sql.close()}
});
test('UTC midnight/month boundary uses delivery confirmation rather than creation/provider completion',()=>{
 const f=fixture();try{
  insert(f,'boundary',{created:DAY-1000,completed:DAY-500,ack:DAY+1});
  assert.deepEqual(counts(f,DAY-1),{monthGenerations:0,todayGenerations:0});
  assert.deepEqual(counts(f),{monthGenerations:1,todayGenerations:1});
  assert.deepEqual(counts(f,DAY+86400000),{monthGenerations:1,todayGenerations:0});
 }finally{f.sql.close()}
});
test('real reserve/finish/ACK flow increments live dashboard once, even while historical counters are cached',async()=>{
 const clock=Date.now;let now=NOW;Date.now=()=>now;const f=fixture();
 try{
  f.env.ADMIN_PORTAL_ENABLED='1';f.sql.exec("UPDATE users SET role='admin';INSERT INTO site_administrator VALUES(1,'test-user',1)");
  const dashboard=()=>f.call('/v1/admin/dashboard',{method:'GET'});
  assert.equal((await dashboard()).body.todayGenerations,0);
  const id='11111111-1111-4111-8111-111111111111';
  await reserveGeneration(f.env,{user_id:'test-user',kind:'extension'},id,'hash',100);
  await finishGeneration(f.env,'test-user',id,'stored validated result',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
  assert.equal((await dashboard()).body.todayGenerations,0,'provider success is not delivery');
  f.sql.exec("UPDATE sessions SET kind='extension'");now+=1000;
  const headers={Cookie:'',Authorization:'Bearer '+'b'.repeat(64),Origin:f.env.EXTENSION_ORIGIN};
  for(let i=0;i<2;i++)assert.equal((await f.call('/v1/ai/requests/'+id+'/delivered',{headers,body:{requestId:id}})).status,200);
  assert.equal(f.sql.prepare('SELECT completed_at FROM ai_requests').get().completed_at,null,'reporting fix must not rewrite lifecycle timestamps');
  f.sql.exec("UPDATE sessions SET kind='web'");
  const d=await dashboard();assert.equal(d.status,200);assert.equal(d.body.todayGenerations,1);assert.equal(d.body.monthGenerations,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,1);
  assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts').get().free_balance,199);
 }finally{f.sql.close();Date.now=clock}
});
