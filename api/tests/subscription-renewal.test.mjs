import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';

const DAY=86400000, PERIOD=30*DAY;
function setup({risk='clear',priorValid=false}={}){
 const f=fixture(), now=Date.now(),oldStart=now-(priorValid?5:31)*DAY;
 f.env.SUBSCRIPTIONS_ENABLED='1';
 const plans=[['first','basic-v1',6990],['second','pro-v1',11990]];
 for(const [id,version,price] of plans){
  f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES(?,'test-user',?,?,?,'paid',1,9999999999999,1,1,?,?)")
   .run(id,version,id==='first'?'purchase':'renewal',price,now,now);
  f.sql.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,provider_trade_id,payment_channel,amount_fen,status,risk_state,created_at,updated_at,paid_at) VALUES(?,?,'local_mock',?,'LOCAL_MOCK',?,'paid',?,1,1,?)")
   .run('tx-'+id,id,'trade-'+id,price,id==='second'?risk:'clear',now);
  f.sql.prepare("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,received_at) VALUES(?,?,'local_mock',?,'PAYMENT_SUCCEEDED',?,1)")
   .run('event-'+id,'tx-'+id,'paid-'+id,price);
 }
 f.sql.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('first-period','test-user','first','basic-v1',500,'active',?,?,1,1)")
  .run(oldStart,oldStart+PERIOD);
 f.sql.exec("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,created_at,updated_at) VALUES('second-period','test-user','second','pro-v1',1000,'queued',2,2)");
 return f;
}
const check=async f=>f.call('/v1/usage',{method:'GET'});
const state=f=>f.sql.prepare("SELECT id,status,start_at,end_at FROM subscription_periods ORDER BY id").all();

test('expired paid period atomically gives way to queued renewal with 30 full new days',async()=>{
 const f=setup();
 try{
  const r=await check(f);assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.subscription.status,'active');
  assert.equal(r.body.subscription.plan,'pro');
  assert.equal(r.body.subscription.remainingToday,1000);
  const rows=state(f),old=rows.find(x=>x.id==='first-period'),next=rows.find(x=>x.id==='second-period');
  assert.equal(old.status,'expired');
  assert.equal(next.status,'active');
  assert.ok(next.start_at<=Date.now()&&next.start_at>Date.now()-60000);
  assert.equal(next.end_at-next.start_at,PERIOD);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_periods WHERE status='active'").get().n,1);
  const again=await check(f);assert.equal(again.body.subscription.plan,'pro');
  assert.equal(state(f).find(x=>x.id==='second-period').start_at,next.start_at);
 }finally{f.sql.close();}
});

test('unexpired paid subscription remains the only active period',async()=>{
 const f=setup({priorValid:true});
 try{
  const r=await check(f);
  assert.equal(r.status,200);
  assert.equal(r.body.subscription.plan,'basic');
  assert.equal(state(f).find(x=>x.id==='second-period').status,'queued');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_periods WHERE status='active'").get().n,1);
 }finally{f.sql.close();}
});

test('refund risk or invalid paid proof prevents queued renewal activation',async()=>{
 const f=setup({risk:'frozen'});
 try{
  const r=await check(f);assert.equal(r.status,200);
  assert.equal(r.body.subscription.status,'none');
  assert.equal(state(f).find(x=>x.id==='second-period').status,'queued');
  f.sql.exec("UPDATE subscription_payment_transactions SET risk_state='clear',status='refunded' WHERE order_id='second'");
  assert.equal((await check(f)).body.subscription.status,'none');
 }finally{f.sql.close();}
});

test('disabled subscription flag never queries new subscription periods or changes statuses',async()=>{
 const f=setup();
 try{
  f.env.SUBSCRIPTIONS_ENABLED='0';
  assert.equal((await check(f)).body.subscription.status,'none');
  assert.equal(state(f).find(x=>x.id==='first-period').status,'active');
  assert.equal(state(f).find(x=>x.id==='second-period').status,'queued');
 }finally{f.sql.close();}
});

test('refund review cannot activate an already paid renewal before its original predecessor expires',async()=>{
 const f=setup({priorValid:true});
 try{
  f.sql.exec("UPDATE subscription_orders SET status='refund_pending' WHERE id='first'; UPDATE subscription_payment_transactions SET risk_state='frozen' WHERE order_id='first'; UPDATE subscription_periods SET status='refund_pending' WHERE id='first-period'");
  assert.equal((await check(f)).body.subscription.status,'none');
  assert.equal(state(f).find(x=>x.id==='second-period').status,'queued');
  const end=Date.now()-1000;
  f.sql.prepare("UPDATE subscription_periods SET start_at=?,end_at=? WHERE id='first-period'").run(end-PERIOD,end);
  assert.equal((await check(f)).body.subscription.plan,'pro');
  assert.equal(state(f).find(x=>x.id==='first-period').status,'refund_pending');
 }finally{f.sql.close();}
});
