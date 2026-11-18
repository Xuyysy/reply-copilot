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
  // Modern credit allocations override misleading legacy credit_source hints.
  f.sql.exec("UPDATE ai_requests SET credit_source='paid' WHERE request_id='delivered-free'");
  f.sql.prepare("INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,state,created_at,consumed_at) VALUES('free-source','test-user','delivered-free','free-batch','consumed',?,?)").run(now,now);
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
  assert.equal(r.body.aiUsage.paid,0,'authoritative free allocation beats legacy source hint');
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

test('Provider-confirmed but unfulfilled payments become review alerts without automatic grants',async()=>{
 const f=admin();
 try{
  const at=Date.now()-10*60_000;
  seedPeriod(f,'subscription-unfulfilled',at,'paid');
  f.sql.exec("UPDATE subscription_orders SET applied_at=NULL WHERE id='subscription-unfulfilled'");
  f.sql.prepare(`INSERT INTO subscription_payment_transactions
   (id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,
    amount_fen,notification_sign_type,status,risk_state,created_at,updated_at,paid_at)
   VALUES ('stx-review','subscription-unfulfilled','mk99','m1','trade-review','ALIPAY_H5',6990,'MD5','paid','clear',?,?,?)`)
   .run(at,at,at);
  f.sql.prepare(`INSERT INTO subscription_payment_events
   (id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at)
   VALUES ('sev-review','stx-review','mk99','verified-review','PAYMENT_SUCCEEDED',6990,?,?)`)
   .run('a'.repeat(64),at);

  const pkg=f.sql.prepare('SELECT id FROM recharge_packages LIMIT 1').get().id;
  f.sql.prepare(`INSERT INTO recharge_orders
   (id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at,paid_at)
   VALUES ('credit-unfulfilled','test-user',?,'Starter',400,149,'USD','paid',?,?)`)
   .run(pkg,at,at);
  f.sql.prepare(`INSERT INTO payment_transactions
   (id,order_id,provider,currency,amount_fen,status,created_at,updated_at,paid_at,merchant_provider)
   VALUES ('ctx-review','credit-unfulfilled','xiaodou','CNY',699,'paid',?,?,?,'mk99')`)
   .run(at,at,at);
  f.sql.prepare(`INSERT INTO provider_payment_events
   (id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at,merchant_provider)
   VALUES ('cev-review','xiaodou','proof-credit-review','ctx-review','PAYMENT_SUCCEEDED',699,'CNY',?,?,'mk99')`)
   .run('b'.repeat(64),at);
  const resp=await f.call('/v1/admin/ops-insights',{method:'GET'});
  assert.equal(resp.status,200,JSON.stringify(resp.body));
  assert.ok(resp.body.alerts.some(a=>a.type==='subscription_entitlement_gap'&&a.order_id==='subscription-unfulfilled'));
  assert.ok(resp.body.alerts.some(a=>a.type==='credit_entitlement_gap'&&a.order_id==='credit-unfulfilled'));
  // A read-only alert must never repair or mutate the business ledger itself.
  assert.equal(f.sql.prepare("SELECT applied_at FROM subscription_orders WHERE id='subscription-unfulfilled'").get().applied_at,null);
  assert.equal(f.sql.prepare("SELECT credited_at FROM recharge_orders WHERE id='credit-unfulfilled'").get().credited_at,null);
 }finally{f.sql.close();}
});

test('Alert-only view skips AI request reads and preserves payment review items',async()=>{
 const f=admin();
 try{
  const original=f.env.DB.prepare.bind(f.env.DB);
  const queries=[];
  f.env.DB.prepare=sql=>{queries.push(String(sql));return original(sql);};
  const r=await f.call('/v1/admin/ops-insights?view=alerts',{method:'GET'});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.aiFailures24h,undefined);
  assert.ok(r.body.alerts.every(item=>item.type!=='ai_failures'));
  assert.equal(r.body.aiUsage.rowsSampled,0);
  assert.equal(queries.some(q=>q.includes('FROM ai_requests')),false,'Overview risk panel must never read AI requests');
 }finally{f.sql.close();}
});
test('Cost-only view skips payment risk queries',async()=>{
 const f=admin();
 try{
  const original=f.env.DB.prepare.bind(f.env.DB);
  const queries=[];
  f.env.DB.prepare=sql=>{queries.push(String(sql));return original(sql);};
  const r=await f.call('/v1/admin/ops-insights?view=plans',{method:'GET'});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body.alerts,[]);
  assert.equal(queries.some(q=>q.includes('FROM payment_transactions t JOIN recharge_orders')),false);
  assert.equal(queries.some(q=>q.includes('FROM subscription_orders o JOIN subscription_payment_transactions')),false);
 }finally{f.sql.close();}
});
