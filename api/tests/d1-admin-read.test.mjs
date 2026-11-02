import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';
const NOW=Date.UTC(2026,10,2,12);
function setup(){const f=fixture();f.env.ADMIN_PORTAL_ENABLED='1';f.env.AI_MODE='production';f.sql.exec("UPDATE users SET role='admin';INSERT INTO site_administrator VALUES(1,'test-user',1)");return f;}
const dashboard=f=>f.call('/v1/admin/dashboard',{method:'GET'});
test('historical dashboard counters coalesce/cache30s while cost, flags and global reservations remain current',async()=>{
 const clock=Date.now;let now=NOW;Date.now=()=>now;const f=setup(),seen=[],prepare=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{seen.push(sql);return prepare(sql)};
 try{
  const [one,two]=await Promise.all([dashboard(f),dashboard(f)]);assert.equal(one.status,200);assert.deepEqual(one.body,two.body);
  assert.equal(seen.filter(q=>q.includes('FROM credit_grants')).length,1,'concurrent requests share historical totals');
  assert.equal(seen.filter(q=>q.includes('FROM ai_usage_costs u')).length,2,'one cost scan per dashboard, never four');
  f.sql.exec("INSERT INTO users(id,email,email_verified_at,created_at) VALUES('later','later@example.test',1,1);UPDATE system_settings SET value='100' WHERE key='daily_cost_limit_micro_usd';UPDATE system_settings SET value='0' WHERE key='ai_enabled';INSERT INTO ai_budget_days(budget_day,settled_micro_usd,reserved_micro_usd) VALUES('2026-11-02',70,30)");
  f.sql.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) VALUES('test-user','failure-cost','unknown-estimated',4,5,70,?)").run(now);
  const fresh=await dashboard(f);assert.equal(fresh.body.users,1,'historical total may lag at most30s');
  assert.equal(fresh.body.aiService.enabled,false);assert.equal(fresh.body.dailyCostMicroUsd,70);assert.equal(fresh.body.reservedCostMicroUsd,30);assert.equal(fresh.body.circuitOpen,true);
  assert.deepEqual(fresh.body.todayCost,{inputTokens:4,outputTokens:5,costMicroUsd:70});
  now+=30001;assert.equal((await dashboard(f)).body.users,2);assert.equal(seen.filter(q=>q.includes('FROM credit_grants')).length,2);
  f.sql.exec("UPDATE users SET role='user' WHERE id='test-user'");assert.equal((await dashboard(f)).status,403,'cached aggregates cannot bypass admin authorization');
 }finally{f.sql.close();Date.now=clock}
});
test('a failed historical read is evicted and a separate database binding never shares its counters',async()=>{
 const clock=Date.now;Date.now=()=>NOW;const f=setup(),prepare=f.DB.prepare.bind(f.DB);let fail=true;
 f.DB.prepare=sql=>{const s=prepare(sql);if(sql.includes('FROM credit_grants')&&fail)s.first=async()=>{throw Error('Synthetic local read failure')};return s};
 try{
  assert.equal((await dashboard(f)).status,503);fail=false;assert.equal((await dashboard(f)).status,200);
  const other=setup();try{other.sql.exec("INSERT INTO users(id,email,email_verified_at,created_at) VALUES('other','other@example.test',1,1)");assert.equal((await dashboard(other)).body.users,2)}finally{other.sql.close()}
 }finally{f.sql.close();Date.now=clock}
});
