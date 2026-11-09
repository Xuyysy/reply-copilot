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
