import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';

function adminFixture(){
 const f=fixture();
 f.env.ADMIN_PORTAL_ENABLED='1';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
 return f;
}
function seed(f){
 const now=Date.now();
 f.sql.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES('free-1','test-user','signup_grant',200,0,'welcome-a','Welcome',?)").run(now-7000);
 f.sql.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES('paid-1','test-user','generation_debit',0,-1,'req-paid-a','Delivered',?)").run(now-6000);
 f.sql.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES('released-1','test-user','generation_release',0,0,'req-release-a','Failed reservation',?)").run(now-5000);
 f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES('order-1','test-user','basic-v1','purchase',6990,'paid',1,9999999999999,1,?, ?,?)").run(now-4000,now-4000,now-4000);
 f.sql.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('period-1','test-user','order-1','basic-v1',500,'active',?,?,?,?)").run(now-4000,now-4000+30*86400000,now-4000,now-4000);
 f.sql.prepare("INSERT INTO subscription_usage_events(id,user_id,period_id,request_id,day_index,event_type,created_at) VALUES('sub-reserve','test-user','period-1','req-sub-a',0,'reserve',?)").run(now-3000);
 f.sql.prepare("INSERT INTO subscription_usage_events(id,user_id,period_id,request_id,day_index,event_type,created_at) VALUES('sub-release','test-user','period-1','req-sub-a',0,'release',?)").run(now-2000);
 f.sql.prepare("INSERT INTO subscription_usage_events(id,user_id,period_id,request_id,day_index,event_type,created_at) VALUES('sub-consume','test-user','period-1','req-sub-b',0,'consume',?)").run(now-1000);
 f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES('order-2','test-user','basic-v1','renewal',6990,'paid',1,9999999999999,1,?,?,?)").run(now-950,now-950,now-950);
 f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,target_period_id,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES('order-3','test-user','pro-v1','upgrade','period-1',5000,'paid',1,9999999999999,1,?,?,?)").run(now-900,now-900,now-900);
 return now;
}
test('admin entitlement activity merges free, permanent, subscription orders, consumed and released events without modifying balances',async()=>{
 const f=adminFixture();
 try{
  seed(f);
  const before=f.sql.prepare('SELECT free_balance,paid_balance FROM credit_accounts WHERE user_id=?').get('test-user');
  const result=await f.call('/v1/admin/entitlement-activity',{method:'GET'});
  assert.equal(result.status,200,JSON.stringify(result.body));
  const rows=result.body.items;
  assert.equal(rows.length,8);
  assert.ok(rows.every((r,i)=>i===0||rows[i-1].occurred_at>=r.occurred_at));
  assert.deepEqual(new Set(rows.map(x=>x.event_type)),new Set(['signup_grant','generation_debit','generation_release','subscription_purchase','subscription_renewal','subscription_upgrade','subscription_release','subscription_consume']));
  assert.equal(rows.find(x=>x.event_type==='subscription_consume').subscription_delta,-1);
  assert.equal(rows.find(x=>x.event_type==='subscription_release').subscription_delta,0);
  assert.ok(rows.every(x=>x.event_type!=='subscription_reserve'));
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM subscription_usage_events WHERE event_type='reserve'").get().n,1,'underlying reservation audit is preserved');
  assert.equal(rows.find(x=>x.event_type==='subscription_purchase').daily_limit,500);
  assert.equal(rows.find(x=>x.event_type==='subscription_upgrade').daily_limit,1000);
  assert.equal(rows.find(x=>x.event_type==='generation_release').source,'unknown');
  const after=f.sql.prepare('SELECT free_balance,paid_balance FROM credit_accounts WHERE user_id=?').get('test-user');
  assert.deepEqual(after,before);
  for(const source of ['subscription','free','paid','unknown']){
   const filtered=await f.call('/v1/admin/entitlement-activity?source='+source,{method:'GET'});
   assert.equal(filtered.status,200,JSON.stringify(filtered.body));
   assert.ok(filtered.body.items.length>0&&filtered.body.items.every(x=>x.source===source),source);
  }
 }finally{f.sql.close();}
});
test('read-only activity respects admin authorization, exact email and bounded filters',async()=>{
 const f=adminFixture();
 try{
  seed(f);
  let res=await f.call('/v1/admin/entitlement-activity?q=v2%40example.test',{method:'GET'});
  assert.equal(res.status,200);assert.equal(res.body.items.length,8);
  res=await f.call('/v1/admin/entitlement-activity?q=wrong%40example.test',{method:'GET'});
  assert.equal(res.status,200);assert.equal(res.body.items.length,0);
  for(const q of ['source=bogus','cursor=garbage','from=10&to=9','q='+('x'.repeat(121))]){
   res=await f.call('/v1/admin/entitlement-activity?'+q,{method:'GET'});
   assert.equal(res.status,400,q);
  }
  f.env.ADMIN_PORTAL_ENABLED='0';
  res=await f.call('/v1/admin/entitlement-activity',{method:'GET'});
  assert.equal(res.status,404);
 }finally{f.sql.close();}
});
test('entitlement keyset pagination is stable and covers all rows exactly once',async()=>{
 const f=adminFixture();
 try{
  const now=Date.now();
  for(let i=0;i<61;i++)f.sql.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) VALUES(?,'test-user','signup_grant',1,0,?,?)").run('p-'+i,'p-ref-'+i,now-i);
  const first=await f.call('/v1/admin/entitlement-activity?source=free',{method:'GET'});
  assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.items.length,50);
  assert.equal(first.body.hasMore,true);assert.ok(first.body.nextCursor);
  const next=await f.call('/v1/admin/entitlement-activity?source=free&cursor='+encodeURIComponent(first.body.nextCursor),{method:'GET'});
  assert.equal(next.status,200,JSON.stringify(next.body));assert.equal(next.body.items.length,11);
  assert.equal(next.body.nextCursor,null);
  assert.equal(new Set([...first.body.items,...next.body.items].map(x=>x.id)).size,61);
 }finally{f.sql.close();}
});

test('CF Free: keyset pagination merges all bounded source branches without missing tied events',async()=>{
 const f=adminFixture();try{
  seed(f);
  const at=Date.now()-100;
  for(let i=0;i<61;i++)
   f.sql.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) VALUES(?,'test-user','signup_grant',1,0,?,?)")
    .run('merge-'+String(i).padStart(3,'0'),'merge-ref-'+i,at);
  const ids=[],times=[];
  let cursor=null,iterations=0;
  do{
   const q='?source=all'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
   const r=await f.call('/v1/admin/entitlement-activity'+q,{method:'GET'});
   assert.equal(r.status,200,JSON.stringify(r));
   ids.push(...r.body.items.map(x=>x.id));
   times.push(...r.body.items.map(x=>[x.occurred_at,x.id]));
   cursor=r.body.nextCursor;iterations++;
   assert.ok(iterations<8,'must terminate without repeated pages');
  }while(cursor);
  assert.equal(ids.length,69,'61 synthetic credit events plus eight independent seeded activity records');
  assert.equal(new Set(ids).size,69,'stable cursor cannot duplicate or skip rows');
  for(let i=1;i<times.length;i++)
   assert.ok(times[i-1][0]>times[i][0]||(times[i-1][0]===times[i][0]&&times[i-1][1]>times[i][1]),
      'same-timestamp ordering uses binary descending stable IDs');
  const sub=await f.call('/v1/admin/entitlement-activity?source=subscription',{method:'GET'});
  assert.equal(sub.status,200);assert.ok(sub.body.items.length>0);
  assert.ok(sub.body.items.every(x=>x.source==='subscription'));
  const byEmail=await f.call('/v1/admin/entitlement-activity?q=v2%40example.test',{method:'GET'});
  assert.equal(byEmail.status,200);assert.equal(byEmail.body.items.length,50);
  assert.equal((await f.call('/v1/admin/entitlement-activity?q=unknown%40example.test',{method:'GET'})).body.items.length,0);
 }finally{f.sql.close();}
});
