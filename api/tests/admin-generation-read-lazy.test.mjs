import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';

const USER='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
function setup(){
 const f=fixture();
 f.env.ADMIN_PORTAL_ENABLED='1';f.env.AI_MODE='production';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user';INSERT INTO site_administrator VALUES(1,'test-user',1)");
 f.sql.prepare("INSERT INTO users(id,email,role,created_at,email_verified_at) VALUES(?,'counted-user@example.test','user',1,1)").run(USER);
 f.sql.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,0,0,1,1)").run(USER);
 return f;
}
function confirmed(f,id,{userId=USER,status='succeeded',consumed=1,marker='ack',time=Date.now()}={}){
 f.sql.prepare("INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase,delivery_confirmed_at,delivery_confirmation_id) VALUES(?,?,'2026-11-18',?,?,?,'hash',?,'awaiting_delivery',?,?)")
  .run(userId,id,id,status,consumed,time,time,marker);
}
function spy(f){
 const seen=[],original=f.DB.prepare.bind(f.DB);
 f.DB.prepare=sql=>{seen.push(String(sql));return original(sql);};
 return seen;
}
const get=(f,path)=>f.call(path,{method:'GET'});
const monthScan=q=>q.includes('COUNT(*) monthGenerations')&&q.includes('FROM ai_requests');
const lifetimeScan=q=>q.includes('COUNT(*) generations')&&q.includes('FROM ai_requests r');

test('CF Free: overview/cost skip the exact month scan without misrepresenting unloaded counts as zero',async()=>{
 const f=setup();try{
  const now=Date.now();
  const dayStart=new Date(now);dayStart.setUTCHours(0,0,0,0);
  const withinDay=Math.max(dayStart.getTime()+1,now-1000);
  confirmed(f,'ack-valid',{time:withinDay});
  confirmed(f,'pending',{time:withinDay,status:'reserved',consumed:0});
  confirmed(f,'missing-ack',{time:withinDay,marker:null});
  confirmed(f,'bad-ack',{time:withinDay,marker:''});
  const seen=spy(f);
  for(const view of ['overview&generation_counts=lazy','cost']){
   seen.length=0;
   const r=await get(f,'/v1/admin/dashboard?view='+view);
   assert.equal(r.status,200,JSON.stringify(r));
   assert.equal(Object.hasOwn(r.body,'todayGenerations'),false);
   assert.equal(Object.hasOwn(r.body,'monthGenerations'),false);
   assert.equal(seen.some(monthScan),false,'routine admin reads cannot scan confirmed history');
   assert.ok(Object.hasOwn(r.body,'dailyCostMicroUsd'),'current budget must remain available');
  }
  seen.length=0;
  const exact=await get(f,'/v1/admin/dashboard?view=generations');
  assert.equal(exact.status,200);
  assert.deepEqual(exact.body,{todayGenerations:1,monthGenerations:1});
  assert.equal(seen.filter(monthScan).length,1,'explicit demand executes one exact ACK count');
  assert.equal(seen.some(q=>q.includes('FROM credit_ledger')),false,'no unrelated all-history ledger scan');
  seen.length=0;
  const oldOverview=await get(f,'/v1/admin/dashboard?view=overview');
  assert.equal(oldOverview.status,200);
  assert.equal(oldOverview.body.todayGenerations,1);
  assert.equal(oldOverview.body.monthGenerations,1);
  assert.equal(seen.filter(monthScan).length,1,'Worker-first rollout preserves old Pages exact KPIs');
  seen.length=0;
  const legacy=await get(f,'/v1/admin/dashboard');
  assert.equal(legacy.status,200);
  assert.equal(legacy.body.todayGenerations,1);
  assert.equal(legacy.body.monthGenerations,1);
  assert.equal(seen.filter(monthScan).length,1,'legacy response remains exact');
 }finally{f.sql.close();}
});

test('CF Free: selected-user light detail omits the lifetime scan; explicit detail and legacy API retain exact ACK count',async()=>{
 const f=setup();try{
  confirmed(f,'ack-valid');
  confirmed(f,'missing-marker',{marker:null});
  confirmed(f,'unconfirmed',{status:'reserved',consumed:0});
  const seen=spy(f);
  let result=await get(f,'/v1/admin/users/'+USER+'?view=light');
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.body.user.generations,null);
  assert.equal(result.body.user.email,'counted-user@example.test');
  assert.ok(Array.isArray(result.body.ledger));
  assert.ok(Array.isArray(result.body.orders));
  assert.ok(Array.isArray(result.body.usage));
  assert.equal(seen.some(lifetimeScan),false,'basic detail avoids all-history count');
  seen.length=0;
  result=await get(f,'/v1/admin/users/'+USER+'?view=generations');
  assert.equal(result.status,200);
  assert.deepEqual(result.body,{generations:1});
  assert.equal(seen.filter(lifetimeScan).length,1);
  seen.length=0;
  result=await get(f,'/v1/admin/users/'+USER);
  assert.equal(result.status,200);
  assert.equal(result.body.user.generations,1);
  assert.equal(seen.filter(lifetimeScan).length,1,'no-view API stays backwards compatible');
  assert.equal((await get(f,'/v1/admin/users/00000000-0000-4000-8000-000000000000?view=generations')).status,404);
 }finally{f.sql.close();}
});

test('CF Free: all new generation read views remain restricted to the original admin authentication',async()=>{
 const f=setup();try{
  f.sql.exec("UPDATE users SET role='user' WHERE id='test-user'");
  for(const path of ['/v1/admin/dashboard?view=generations','/v1/admin/users/'+USER+'?view=light','/v1/admin/users/'+USER+'?view=generations'])
   assert.equal((await get(f,path)).status,403,path);
  const unauth=fixture();try{
   assert.equal((await get(unauth,'/v1/admin/dashboard?view=generations')).status,404);
  }finally{unauth.sql.close();}
 }finally{f.sql.close();}
});
