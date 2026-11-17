import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';

const DAY=86400000;
function grantAdmin(f){
  f.env.ADMIN_PORTAL_ENABLED='1';
  f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
}
function seedUnverifiedSubscriber(f) {
  const now=Date.now(),start=now-2*DAY;
  f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES('sub1','test-user','basic-v1','purchase',6990,'paid',1,9999999999999,1,1,?,?)").run(now,now);
  f.sql.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,provider_trade_id,payment_channel,amount_fen,status,risk_state,created_at,updated_at,paid_at) VALUES('sub-t1','sub1','local_mock','fake-trade','LOCAL_MOCK',6990,'paid','clear',1,1,?)").run(now);
  f.sql.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('period1','test-user','sub1','basic-v1',500,'active',?,?,1,1)").run(start,start+30*DAY);
  f.sql.exec("INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES('period1',2,490,2,1)");
}

test('subscription catalog stays hidden until feature switch is explicitly enabled',async()=>{
  const f=fixture();
  try{
    assert.equal((await f.call('/v1/subscriptions/plans',{method:'GET'})).status,404);
    f.env.SUBSCRIPTIONS_ENABLED='1';
    const r=await f.call('/v1/subscriptions/plans',{method:'GET'});
    assert.equal(r.status,200);
    assert.equal(r.body.autoRenew,false);
    assert.deepEqual(r.body.plans.map(p=>[p.plan_code,p.price_fen,p.daily_limit]),[
      ['basic',6990,500],['pro',11990,1000],['max',17990,1500],['ultra',25990,2000]
    ]);
    assert.equal(r.body.plans.some(p=>p.provider_trade_id||p.user_id),false);
  }finally{f.sql.close();}
});

test('subscription admin data requires active verified administrator',async()=>{
  const f=fixture();
  try{
    f.env.SUBSCRIPTIONS_ENABLED='1';f.env.ADMIN_PORTAL_ENABLED='1';
    const p=await f.call('/v1/admin/subscriptions/plans',{method:'GET'});
    const u=await f.call('/v1/admin/subscriptions/users',{method:'GET'});
    assert.equal(p.status,403);assert.equal(u.status,403);
    grantAdmin(f);
    const valid=await f.call('/v1/admin/subscriptions/plans',{method:'GET'});
    assert.equal(valid.status,200);assert.equal(valid.body.plans.length,4);
    assert.equal((await f.call('/v1/admin/subscriptions/users',{method:'GET'})).body.users.length,0);
    for(const query of ['?status=abc','?plan=enterprise']){
      assert.equal((await f.call('/v1/admin/subscriptions/users'+query,{method:'GET'})).status,400);
    }
  }finally{f.sql.close();}
});

test('admin subscriber list clearly distinguishes paid claim from provider-proof and daily usage',async()=>{
  const f=fixture();
  try{
    f.env.SUBSCRIPTIONS_ENABLED='1';grantAdmin(f);
    seedUnverifiedSubscriber(f);
    let r=await f.call('/v1/admin/subscriptions/users?status=active&plan=basic',{method:'GET'});
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(r.body.users.length,1);
    assert.equal(r.body.users[0].effective_status,'expired_or_unverified');
    assert.equal(r.body.users[0].remaining_today,0);
    assert.equal(r.body.users[0].used_today,490);
    f.sql.exec("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,received_at) VALUES('trusted-event','sub-t1','local_mock','event-key','PAYMENT_SUCCEEDED',6990,1)");
    r=await f.call('/v1/admin/subscriptions/users?status=active&plan=basic',{method:'GET'});
    assert.equal(r.body.users[0].effective_status,'active');
    assert.equal(r.body.users[0].remaining_today,8);
    assert.equal((await f.call('/v1/admin/subscriptions/users?plan=ultra',{method:'GET'})).body.users.length,0);
    f.sql.exec("UPDATE subscription_payment_transactions SET risk_state='manual_review'");
    r=await f.call('/v1/admin/subscriptions/users',{method:'GET'});
    assert.equal(r.body.users[0].remaining_today,0);
  }finally{f.sql.close();}
});


test('admin subscription order audit is bounded, restricted and never grants credits',async()=>{
 const f=fixture();
 try{
   f.env.SUBSCRIPTIONS_ENABLED='1';f.env.ADMIN_PORTAL_ENABLED='1';
   assert.equal((await f.call('/v1/admin/subscriptions/orders',{method:'GET'})).status,403);
   grantAdmin(f);seedUnverifiedSubscriber(f);
   const r=await f.call('/v1/admin/subscriptions/orders',{method:'GET'});
   assert.equal(r.status,200,JSON.stringify(r.body));
   assert.equal(r.body.orders.length,1);
   assert.equal(r.body.orders[0].kind,'purchase');
   assert.equal(r.body.orders[0].amount_fen,6990);
   assert.equal(r.body.orders[0].verified_event_count,0);
   assert.equal((await f.call('/v1/admin/subscriptions/orders?kind=bad',{method:'GET'})).status,400);
   assert.equal((await f.call('/v1/admin/subscriptions/orders?status=bad',{method:'GET'})).status,400);
   f.sql.exec("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,received_at) VALUES('audited-event','sub-t1','local_mock','new-key','PAYMENT_SUCCEEDED',6990,1)");
   const verified=await f.call('/v1/admin/subscriptions/orders?status=paid&kind=purchase',{method:'GET'});
   assert.equal(verified.body.orders[0].verified_event_count,1);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger").get().n,0);
 }finally{f.sql.close();}
});

test('admin plan publishing needs reauthentication and preserves the original price snapshot',async()=>{
 const f=fixture();
 try{
  f.env.SUBSCRIPTIONS_ENABLED='1';grantAdmin(f);seedUnverifiedSubscriber(f);
  const body={operationId:crypto.randomUUID(),reason:'Update plan for future sales',expectedId:'basic-v1',
   priceFen:7290,nameZh:'基础订阅',nameEn:'Basic',descriptionZh:'',descriptionEn:'',active:true};
  const route='/v1/admin/subscriptions/plans/basic';
  assert.equal((await f.call(route,{body})).status,403);
  f.sql.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) SELECT id,? FROM sessions WHERE user_id='test-user'").run(Date.now()+60000);
  assert.equal((await f.call(route,{body})).status,200);
  assert.equal((await f.call(route,{body})).status,200);
  assert.deepEqual(f.sql.prepare("SELECT price_fen,current FROM subscription_plan_versions WHERE plan_code='basic' ORDER BY version").all()
   .map(row=>[row.price_fen,row.current]),[[6990,0],[7290,1]]);
  assert.equal(f.sql.prepare("SELECT amount_fen FROM subscription_orders WHERE id='sub1'").get().amount_fen,6990);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM admin_audit_logs WHERE action='subscription_plan_publish'").get().n,1);
 }finally{f.sql.close();}
});

test('admin hold requires CSRF and preserves recorded usage and permanent credits',async()=>{
 const f=fixture();
 try{
  f.env.SUBSCRIPTIONS_ENABLED='1';grantAdmin(f);seedUnverifiedSubscriber(f);
  f.sql.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) SELECT id,? FROM sessions WHERE user_id='test-user'").run(Date.now()+60000);
  const body={operationId:crypto.randomUUID(),reason:'Review possible payment dispute'};
  const route='/v1/admin/subscriptions/orders/sub1/hold';
  assert.equal((await f.call(route,{body,headers:{'X-CSRF-Token':'invalid'}})).status,403);
  assert.equal((await f.call(route,{body})).status,200);
  assert.equal((await f.call(route,{body})).body.replayed,true);
  assert.equal(f.sql.prepare("SELECT status FROM subscription_periods WHERE id='period1'").get().status,'refund_pending');
  assert.equal(f.sql.prepare("SELECT used FROM subscription_daily_usage WHERE period_id='period1'").get().used,490);
  assert.equal(f.sql.prepare("SELECT free_balance FROM credit_accounts WHERE user_id='test-user'").get().free_balance,200);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM admin_audit_logs WHERE action='subscription_order_hold'").get().n,1);
 }finally{f.sql.close();}
});

test('finance summary skips historical usage and provider-cost SQL while exact legacy finance stays correct',async()=>{
 const f=fixture();
 try{
  f.env.SUBSCRIPTIONS_ENABLED='1';grantAdmin(f);seedUnverifiedSubscriber(f);
  const now=Date.now();
  f.sql.prepare("INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at) VALUES('test-user','usage-1','2026-11-17','nonce','succeeded',1,'hash',?)").run(now);
  f.sql.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) VALUES('test-user','usage-1','mock',2,3,150,?)").run(now);
  f.sql.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) VALUES('test-user','unallocated-1','mock',1,1,700,?)").run(now);
  f.sql.prepare("INSERT INTO subscription_ai_allocations(id,user_id,request_id,period_id,day_index,state,created_at) VALUES('alloc-1','test-user','usage-1','period1',2,'consumed',?)").run(now);
  f.sql.prepare("INSERT INTO subscription_usage_events(id,user_id,period_id,request_id,day_index,event_type,created_at) VALUES('usage-event-1','test-user','period1','usage-1',2,'consume',?)").run(now);
  const seen=[],original=f.DB.prepare.bind(f.DB);
  f.DB.prepare=sql=>{seen.push(sql);return original(sql);};
  const summary=await f.call('/v1/admin/subscriptions/finance?view=summary',{method:'GET'});
  assert.equal(summary.status,200,JSON.stringify(summary.body));
  assert.equal(summary.body.detailScope,'summary');
  assert.equal(summary.body.usage,null,'unqueried history must not be shown as zero');
  assert.equal(summary.body.from>now-31*DAY,true);
  assert.ok(!seen.some(sql=>/subscription_usage_events|FROM ai_usage_costs/.test(sql)),'summary must not prepare either history SQL');
  seen.length=0;
  const full=await f.call('/v1/admin/subscriptions/finance',{method:'GET'});
  assert.equal(full.status,200,JSON.stringify(full.body));
  assert.equal(full.body.detailScope,'full');
  assert.deepEqual(full.body.orders,summary.body.orders,'verified payment totals unchanged');
  assert.deepEqual(full.body.usage,{consumed:1,cost_micro_usd:150},'only subscription-allocated provider cost counted');
  assert.ok(seen.some(sql=>/subscription_usage_events/.test(sql)),'legacy exact usage remains available');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger").get().n,0,'read-only finance must not grant credits');
 }finally{f.sql.close();}
});

test('subscription summary route requires active verified admin exactly as legacy full finance',async()=>{
 const f=fixture();
 try{
  f.env.SUBSCRIPTIONS_ENABLED='1';f.env.ADMIN_PORTAL_ENABLED='1';
  for(const path of ['/v1/admin/subscriptions/finance?view=summary','/v1/admin/subscriptions/finance']){
   assert.equal((await f.call(path,{method:'GET'})).status,403);
  }
  grantAdmin(f);
  assert.equal((await f.call('/v1/admin/subscriptions/finance?view=summary',{method:'GET'})).status,200);
 }finally{f.sql.close();}
});
