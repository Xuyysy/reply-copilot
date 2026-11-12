import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { releaseUnusableCreditCheckout } from '../api/src/payment-retry-release.js';
import { checkoutOrderFromError, checkoutOrderMessage } from '../web/src/lib/checkout-status.mjs';
const id='11111111-1111-4111-8111-111111111111', uid='22222222-2222-4222-8222-222222222222';

function fixture(provider='mk99', marker='unknown:MK99_TIMEOUT') {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE recharge_orders(id TEXT,user_id TEXT,package_id TEXT,status TEXT,paid_at INTEGER,credited_at INTEGER);
    CREATE TABLE payment_transactions(id TEXT,order_id TEXT,merchant_provider TEXT,payment_protocol TEXT,status TEXT,risk_state TEXT,provider_payment_id TEXT,paid_at INTEGER,actual_paid_fen INTEGER,cashier_url TEXT);
    CREATE TABLE payment_attempts(id TEXT,transaction_id TEXT,attempt_number INTEGER,state TEXT,provider_code TEXT,cashier_url TEXT);
    CREATE TABLE provider_payment_events(id TEXT,transaction_id TEXT);
    CREATE TABLE payment_refunds(id TEXT,transaction_id TEXT);
    CREATE TABLE credit_ledger(id TEXT,kind TEXT,reference_id TEXT);
    CREATE TABLE credit_batches(id TEXT,source_order_id TEXT);`);
  db.prepare("INSERT INTO recharge_orders VALUES (?,?,?,'awaiting_payment',NULL,NULL)").run(id,uid,'starter');
  db.prepare("INSERT INTO payment_transactions VALUES ('t1',?,?,'rsa2','unknown','clear',NULL,NULL,NULL,NULL)").run(id,provider);
  db.prepare("INSERT INTO payment_attempts VALUES ('a1','t1',1,?,?,NULL)").run(marker.includes(':rejected:')?'failed':'unknown',marker);
  const env={DB:{prepare(sql){const stmt=db.prepare(sql);return {bind(...args){return {run(){const result=stmt.run(...args);return {meta:{changes:result.changes}};}};}}}}};
  return {db,env,merchant:provider,orderStatus:()=>db.prepare('SELECT status FROM recharge_orders').get().status};
}
const release=f=>releaseUnusableCreditCheckout(f.env,{userId:uid,merchant:f.merchant,orderId:id});
test('MK99 timeout safely releases local retry and keeps original provider transaction',async()=>{
 const f=fixture();assert.equal(await release(f),true);assert.equal(f.orderStatus(),'expired');
 assert.equal(f.db.prepare("SELECT status FROM payment_transactions").get().status,'unknown');
 assert.equal(f.db.prepare("SELECT provider_code FROM payment_attempts").get().provider_code,'unknown:MK99_TIMEOUT');
 assert.equal(await release(f),false,'idempotent');
 assert.equal(f.db.prepare("SELECT count(*) n FROM recharge_orders WHERE status IN ('pending','awaiting_payment')").get().n,0);
});
test('same user and package only; no cross-package or cross-user release',async()=>{
 const f=fixture();
 assert.equal(await releaseUnusableCreditCheckout(f.env,{userId:uid,merchant:'mk99',packageId:'other'}),false);
 assert.equal(await releaseUnusableCreditCheckout(f.env,{userId:'33333333-3333-4333-8333-333333333333',merchant:'mk99',packageId:'starter'}),false);
 assert.equal(f.orderStatus(),'awaiting_payment');
 assert.equal(await releaseUnusableCreditCheckout(f.env,{userId:uid,merchant:'mk99',packageId:'starter'}),true);
});
test('Xiaodou linkless unknown/rejected/unavailable first attempts can retry',async()=>{
 for(const [marker,state] of [['checkout-v2:unknown:CHECKOUT_RESULT_UNCONFIRMED','unknown'],['checkout-v2:rejected:OPEN_API_SOURCE_IP_REJECTED','failed'],['checkout-v2:unavailable:CHECKOUT_LINK_MISSING','pending']]){
   const f=fixture('xiaodou',marker);f.db.prepare("UPDATE payment_attempts SET state=?").run(state);
   if(state==='pending')f.db.exec("UPDATE payment_transactions SET status='pending'");
   assert.equal(await release(f),true,marker);
 }
});
test('confirmation required never releases',async()=>{
 const f=fixture('xiaodou','checkout-v2:confirmation_required:CHECKOUT_PAYMENT_CONFIRMATION_REQUIRED');
 assert.equal(await release(f),false);
});
test('protect paid, pending cashier, provider identity, risk, grants, refunds and extra attempts',async()=>{
 const mutations=[
  "UPDATE payment_transactions SET provider_payment_id='known'",
  "UPDATE payment_transactions SET cashier_url='https://mk99.cn/cashier'",
  "UPDATE payment_attempts SET cashier_url='https://mk99.cn/cashier'",
  "UPDATE payment_transactions SET paid_at=1",
  "UPDATE payment_transactions SET actual_paid_fen=1043",
  "UPDATE payment_transactions SET status='paid'",
  "UPDATE payment_transactions SET risk_state='manual_review'",
  "UPDATE payment_attempts SET state='prepared'",
  "UPDATE payment_attempts SET provider_code='ready:MK99_PAY_URL_READY'",
  "UPDATE recharge_orders SET paid_at=1",
  "UPDATE recharge_orders SET credited_at=1",
  "INSERT INTO provider_payment_events VALUES ('e1','t1')",
  "INSERT INTO payment_refunds VALUES ('r1','t1')",
  "INSERT INTO credit_ledger VALUES ('l1','purchase_grant','11111111-1111-4111-8111-111111111111')",
  "INSERT INTO credit_batches VALUES ('b1','11111111-1111-4111-8111-111111111111')",
  "INSERT INTO payment_attempts VALUES ('a2','t1',2,'unknown','unknown:MK99_TIMEOUT',NULL)",
  "UPDATE recharge_orders SET status='paid'"
 ];
 for(const mutation of mutations){
  const f=fixture();f.db.exec(mutation);
  assert.equal(await release(f),false,mutation);assert.notEqual(f.orderStatus(),'expired',mutation);
 }
});
test('bad scope and another merchant fail closed',async()=>{
 const f=fixture();assert.equal(await releaseUnusableCreditCheckout(f.env,{userId:uid,merchant:'xiaodou',orderId:id}),false);
 await assert.rejects(releaseUnusableCreditCheckout(f.env,{userId:uid,merchant:'other',orderId:id}));
 await assert.rejects(releaseUnusableCreditCheckout(f.env,{userId:uid,merchant:'mk99',orderId:id,packageId:'starter'}));
});
test('released failure does not latch browser checkout and customer sees retry message',()=>{
 const order={id,status:'unknown',amountFen:1043,credits:400,baseAmountFen:1000,serviceFeeFen:43,currency:'CNY',paymentProtocol:'rsa2'};
 assert.deepEqual(checkoutOrderFromError({order}),order);
 assert.equal(checkoutOrderFromError({order:{...order,retryAvailable:true}}),null);
 assert.match(checkoutOrderMessage({...order,retryAvailable:true},'zh'),/重新购买/);
 assert.match(checkoutOrderMessage({...order,retryAvailable:true},'en'),/buy again/);
});

test('legacy and test accounts use bound non-UUID user IDs without diagnostic warnings',async()=>{
 const f=fixture();f.db.prepare("UPDATE recharge_orders SET user_id='test-user'").run();
 assert.equal(await releaseUnusableCreditCheckout(f.env,{userId:'test-user',merchant:'mk99',packageId:'starter'}),true);
 assert.equal(f.orderStatus(),'expired');
});
