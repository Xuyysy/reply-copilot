import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';

function adminFixture(){
 const f=fixture();
 f.env.ADMIN_PORTAL_ENABLED='1';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
 return f;
}
function delivery(f,id,source,when=Date.now(),ack=true){
 f.sql.prepare("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,delivery_confirmed_at,delivery_confirmation_id,credit_source) VALUES(?,'test-user','2026-11-10',?,'succeeded',1,?,?,?, ?,?)")
  .run(id,'nonce-'+id,'hash-'+id,when,ack?when:null,ack?'ack-'+id:null,source);
}
function subscription(f,merchant='local_mock',id='sub1',includePeriod=true){
 const now=Date.now(),tid='txn-'+id;
 f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES(?,'test-user','basic-v1','purchase',6990,'paid',1,9999999999999,1,1,?,?)").run(id,now,now);
 f.sql.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,status,risk_state,created_at,updated_at,paid_at) VALUES(?,?,?,?,?,?,?,?, 'paid','clear',1,1,?)")
   .run(tid,id,merchant,merchant==='local_mock'?null:'merchant-1','trade-'+id,merchant==='local_mock'?'LOCAL_MOCK':'ALIPAY_H5',6990,merchant==='local_mock'?null:'MD5',now);
 f.sql.prepare("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at) VALUES(?,?,?,?, 'PAYMENT_SUCCEEDED',6990,?,?)")
   .run('event-'+id,tid,merchant,'notification-'+id,merchant==='local_mock'?null:'a'.repeat(64),now);
 if(!includePeriod)return null;
 f.sql.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES(?,'test-user',?,'basic-v1',500,'active',?,?,1,1)")
   .run('period-'+id,id,now-1000,now+30*86400000);
 f.sql.prepare("INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES(?,0,1,0,?)").run('period-'+id,now);
 return 'period-'+id;
}

test('unified admin AI ledger shows ACK-proven subscription and free delivery without counting twice',async()=>{
 const f=adminFixture();
 try{
  const now=Date.now();
  const period=subscription(f);
  delivery(f,'sub-used','free',now);
  delivery(f,'free-used','free',now-100);
  delivery(f,'no-ack','free',now-200,false);
  f.sql.prepare("INSERT INTO subscription_ai_allocations(id,user_id,request_id,period_id,day_index,state,created_at,consumed_at) VALUES('subscription-alloc','test-user','sub-used',?,0,'consumed',?,?)").run(period,now,now);
  f.sql.prepare("INSERT INTO subscription_usage_events(id,user_id,period_id,request_id,day_index,event_type,created_at) VALUES('sub-event','test-user',?,'sub-used',0,'consume',?)").run(period,now);
  f.sql.prepare("INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,state,created_at,consumed_at) VALUES('credit-alloc','test-user','free-used','free-batch','consumed',?,?)").run(now,now);
  let r=await f.call('/v1/admin/usage-ledger',{method:'GET'});
  assert.equal(r.status,200,JSON.stringify(r));
  assert.deepEqual(r.body.items.map(x=>[x.request_id,x.source]),[['sub-used','subscription'],['free-used','free']]);
  assert.equal(r.body.items[0].period_plan,'basic');
  assert.equal(r.body.items[0].source_evidence,'subscription_allocation');
  assert.equal(r.body.items[1].source_evidence,'credit_allocation');
  assert.ok(!JSON.stringify(r.body).includes('no-ack'));
  r=await f.call('/v1/admin/usage-ledger?source=subscription',{method:'GET'});
  assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].request_id,'sub-used');
  r=await f.call('/v1/admin/usage-ledger?source=free',{method:'GET'});
  assert.deepEqual(r.body.items.map(x=>x.request_id),['free-used']);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM credit_ledger').get().n,0);
 }finally{f.sql.close();}
});

test('unified usage is admin-only with bounded input and rejects misleading filters',async()=>{
 const f=fixture();
 try{
  f.env.ADMIN_PORTAL_ENABLED='1';
  assert.equal((await f.call('/v1/admin/usage-ledger',{method:'GET'})).status,403);
  for(const q of ['source=bogus','from=1&to=999999999999999','q='+('a'.repeat(125)),'cursor=bad']){
   f.env.ADMIN_PORTAL_ENABLED='1';
   f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT OR IGNORE INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
   assert.equal((await f.call('/v1/admin/usage-ledger?'+q,{method:'GET'})).status,400,q);
  }
 }finally{f.sql.close();}
});

test('subscriber payment evidence counts as paid while staging local mocks do not',async()=>{
 const f=adminFixture();
 try{
  subscription(f,'local_mock','mock1');
  let r=await f.call('/v1/admin/users?paid=paid',{method:'GET'});
  assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.users.length,0);
  subscription(f,'mk99','real1',false);
  r=await f.call('/v1/admin/users?paid=paid',{method:'GET'});
  assert.equal(r.status,200);assert.equal(r.body.users.length,1);
  assert.equal(r.body.users[0].id,'test-user');
  assert.equal((await f.call('/v1/admin/users?paid=unpaid',{method:'GET'})).body.users.length,0);
 }finally{f.sql.close();}
});
