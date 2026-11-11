import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';

function admin(){
 const f=fixture();f.env.ADMIN_PORTAL_ENABLED='1';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
 return f;
}
function insertRequest(f,id,ack,when=Date.now()){
 f.sql.prepare(`INSERT INTO ai_requests
 (request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,delivery_confirmed_at,delivery_confirmation_id,credit_source)
 VALUES (?,'test-user','2026-11-11',?,'succeeded',1,?,?,?,?, 'free')`)
 .run(id,'nonce-'+id,'hash-'+id,when,ack?when:null,ack?'ack-'+id:null);
}
function seedPeriod(f,id,now,status='paid'){
 f.sql.prepare(`INSERT INTO subscription_orders
 (id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at)
 VALUES (?,'test-user','basic-v1','purchase',6990,?,1,9999999999999,?,?,?,?)`)
 .run(id,status,now,now,status==='paid'?now:null,status==='paid'?now:null);
 if(status!=='paid')return null;
 const start=now-86400000;
 const period='period-'+id;
 f.sql.prepare(`INSERT INTO subscription_periods
 (id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at)
 VALUES (?,'test-user',?,'basic-v1',500,'active',?,?,?,?)`)
 .run(period,id,start,start+30*86400000,now,now);
 f.sql.prepare('INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES (?,1,1,0,?)').run(period,now);
 return period;
}

test('Admin B5 shows a truthful bounded subscription ACK sample and AI costs',async()=>{
 const f=admin();
 try{
  const now=Date.now(),period=seedPeriod(f,'sub-success',now);
  insertRequest(f,'delivered-sub',true,now);
  insertRequest(f,'delivered-free',true,now-200);
  insertRequest(f,'unacknowledged',false,now-300);
  f.sql.prepare(`INSERT INTO subscription_ai_allocations
   (id,user_id,request_id,period_id,day_index,state,created_at,consumed_at)
   VALUES ('alloc1','test-user','delivered-sub',?,1,'consumed',?,?)`)
   .run(period,now,now);
  f.sql.prepare(`INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at)
   VALUES ('test-user','delivered-sub','deepseek-chat',80,20,120,?)`).run(now);
  const r=await f.call('/v1/admin/ops-insights',{method:'GET'});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.aiUsage.rowsSampled,2);
  assert.equal(r.body.aiUsage.subscription,1);
  assert.equal(r.body.aiUsage.free,1);
  assert.equal(r.body.aiUsage.plans[0].plan,'basic');
  assert.equal(r.body.aiUsage.plans[0].deliveries,1);
  assert.equal(r.body.aiUsage.plans[0].deliveryCostMicroUsd,120);
  assert.equal(r.body.aiUsage.plans[0].avgCostMicroUsd,120);
  assert.equal(r.body.aiUsage.moreThanSample,false);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM credit_ledger').get().n,0);
 }finally{f.sql.close();}
});

test('Admin B5 risk inbox surfaces only genuine unresolved states, never simulated receipts',async()=>{
 const f=admin();
 try{
  const now=Date.now();seedPeriod(f,'review-sub',now,'unknown');
  const pkg=f.sql.prepare('SELECT id FROM recharge_packages LIMIT 1').get().id;
  f.sql.prepare(`INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at)
   VALUES ('credit-unknown','test-user',?,'Starter',400,149,'USD','awaiting_payment',?)`).run(pkg,now);
  f.sql.prepare(`INSERT INTO payment_transactions
   (id,order_id,provider,currency,amount_fen,status,created_at,updated_at,merchant_provider)
   VALUES ('txn-unknown','credit-unknown','xiaodou','CNY',699,'unknown',?,?,'mk99')`)
   .run(now,now);
  const r=await f.call('/v1/admin/ops-insights',{method:'GET'});
  assert.equal(r.status,200,JSON.stringify(r.body));
  const alerts=r.body.alerts;
  assert.ok(alerts.some(a=>a.type==='subscription_review'&&a.order_id==='review-sub'));
  assert.ok(alerts.some(a=>a.type==='credit_payment_unknown'&&a.order_id==='credit-unknown'));
  assert.ok(alerts.every(a=>['orders','subscriptions','cost'].includes(a.target)));
  assert.equal(f.sql.prepare('SELECT status FROM recharge_orders WHERE id=?').get('credit-unknown').status,'awaiting_payment');
 }finally{f.sql.close();}
});
test('Operations insights API refuses non-admin access and never starts merchant queries',async()=>{
 const f=fixture();
 try{
  f.env.ADMIN_PORTAL_ENABLED='1';
  assert.equal((await f.call('/v1/admin/ops-insights',{method:'GET'})).status,403);
  const trace=f.sql.prepare('SELECT COUNT(*) n FROM admin_audit_logs').get().n;
  assert.equal(trace,0);
 }finally{f.sql.close();}
});

test('Subscription exception inbox uses existing partial-index filter in isolated SQLite',()=>{
 const f=admin();
 try{
  const plan=f.sql.prepare(`EXPLAIN QUERY PLAN SELECT id,user_id,status,created_at FROM subscription_orders
    WHERE status IN ('pending','unknown','manual_review') AND status<>'pending' AND created_at>=?
    ORDER BY created_at DESC,id DESC LIMIT 8`).all(Date.now()-30*86400000);
  assert.ok(plan.some(x=>String(x.detail).includes('subscription_orders_pending_idx')),
   'Partial index must be used so dashboard risk polling does not scan every subscription order');
 }finally{f.sql.close();}
});
