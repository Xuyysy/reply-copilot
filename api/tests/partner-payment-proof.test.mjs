import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {paymentEvidencePlan,classifyPaymentEvidence} from '../src/partner-payment-proof.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE recharge_orders(id TEXT,user_id TEXT,status TEXT,paid_at INTEGER,credited_at INTEGER,credits INTEGER);
 CREATE TABLE payment_transactions(id TEXT,order_id TEXT,merchant_provider TEXT,status TEXT,risk_state TEXT,currency TEXT,amount_fen INTEGER,base_amount_fen INTEGER,service_fee_fen INTEGER,principal_refunded_fen INTEGER,provider_trade_id TEXT,provider_payment_id TEXT,paid_at INTEGER);
 CREATE TABLE provider_payment_events(transaction_id TEXT,merchant_provider TEXT,event_type TEXT,amount_fen INTEGER,currency TEXT);
 CREATE TABLE credit_ledger(kind TEXT,reference_id TEXT,user_id TEXT,paid_delta INTEGER);
 CREATE TABLE credit_batches(source_order_id TEXT,user_id TEXT,source_kind TEXT,grant_credits INTEGER);
 CREATE TABLE payment_refunds(transaction_id TEXT,status TEXT,base_amount_fen INTEGER);
 INSERT INTO recharge_orders VALUES('r','buyer','paid',100,101,500);
 INSERT INTO payment_transactions VALUES('t','r','mk99','paid','clear','CNY',1053,1000,0,0,'out-r','pay-r',100);
 INSERT INTO provider_payment_events VALUES('t','mk99','PAYMENT_SUCCEEDED',1053,'CNY');
 INSERT INTO credit_ledger VALUES('purchase_grant','r','buyer',500);
 INSERT INTO credit_batches VALUES('r','buyer','purchase',500);
 CREATE TABLE subscription_orders(id TEXT,user_id TEXT,kind TEXT,status TEXT,paid_at INTEGER,applied_at INTEGER,amount_fen INTEGER,target_period_id TEXT);
 CREATE TABLE subscription_payment_transactions(id TEXT,order_id TEXT,merchant_provider TEXT,status TEXT,risk_state TEXT,currency TEXT,amount_fen INTEGER,provider_trade_id TEXT,provider_payment_id TEXT,paid_at INTEGER);
 CREATE TABLE subscription_payment_events(transaction_id TEXT,merchant_provider TEXT,event_type TEXT,amount_fen INTEGER,body_sha256 TEXT);
 CREATE TABLE subscription_periods(id TEXT,source_order_id TEXT,user_id TEXT);
 CREATE TABLE subscription_tier_changes(order_id TEXT,period_id TEXT,charged_fen INTEGER);
 INSERT INTO subscription_orders VALUES('s','buyer','upgrade','paid',200,201,300,'p');
 INSERT INTO subscription_payment_transactions VALUES('st','s','xiaodou','paid','clear','CNY',300,'out-s','pay-s',200);
 INSERT INTO subscription_payment_events VALUES('st','xiaodou','PAYMENT_SUCCEEDED',300,'fixture');
 INSERT INTO subscription_periods VALUES('p','old','buyer');
 INSERT INTO subscription_tier_changes VALUES('s','p',300);`);
 return db;
}
function preview(db,d,id){const p=paymentEvidencePlan(d,id);return classifyPaymentEvidence(d,db.prepare(p.sql).all(...p.params));}
test('recharge preview uses persisted product principal, not buyer fee or estimated net',t=>{
 const db=fixture(t);const r=preview(db,'recharge','r');
 assert.equal(r.eligible,true);assert.equal(r.principalFen,1000);assert.equal(r.buyerFen,1053);
 db.exec("INSERT INTO payment_refunds VALUES('t','succeeded',100); UPDATE payment_transactions SET principal_refunded_fen=100");
 assert.equal(preview(db,'recharge','r').refundedPrincipalFen,100);
 db.exec("UPDATE payment_transactions SET principal_refunded_fen=101");
 assert.equal(preview(db,'recharge','r').reason,'refund_requires_reconciliation');
});
test('risk, unconfirmed refund, missing application, duplicate and unsupported rails fail closed',t=>{
 const db=fixture(t);
 db.exec("UPDATE payment_transactions SET risk_state='manual_review'");
 assert.equal(preview(db,'recharge','r').reason,'risk_or_pending_refund');
 db.exec("UPDATE payment_transactions SET risk_state='clear'; INSERT INTO payment_refunds VALUES('t','unknown',50)");
 assert.equal(preview(db,'recharge','r').reason,'risk_or_pending_refund');
 db.exec("DELETE FROM payment_refunds; DELETE FROM credit_batches");
 assert.equal(preview(db,'recharge','r').reason,'missing_settlement_proof');
 db.exec("UPDATE payment_transactions SET merchant_provider='local_mock'");
 assert.equal(preview(db,'recharge','r').reason,'unsupported_provider');
 db.exec("INSERT INTO payment_transactions SELECT 't2',order_id,merchant_provider,status,risk_state,currency,amount_fen,base_amount_fen,service_fee_fen,principal_refunded_fen,provider_trade_id,provider_payment_id,paid_at FROM payment_transactions");
 assert.equal(preview(db,'recharge','r').reason,'ambiguous_transaction');
 assert.equal(preview(db,'recharge','missing').reason,'no_fiat_evidence');
 assert.throws(()=>paymentEvidencePlan('boltutil','r'));
});
test('subscription upgrade uses incremental paid amount and applied tier-change proof',t=>{
 const db=fixture(t);assert.equal(preview(db,'subscription','s').principalFen,300);
 db.exec("UPDATE subscription_tier_changes SET charged_fen=301");
 assert.equal(preview(db,'subscription','s').reason,'missing_settlement_proof');
 db.exec("UPDATE subscription_orders SET kind='renewal'; UPDATE subscription_periods SET source_order_id='s'");
 assert.equal(preview(db,'subscription','s').eligible,true);
 db.exec("UPDATE subscription_payment_events SET body_sha256=NULL");
 assert.equal(preview(db,'subscription','s').reason,'missing_settlement_proof');
});

test('provider identity collision across recharge and subscription blocks both orders',t=>{
 const db=fixture(t);
 db.exec("UPDATE subscription_payment_transactions SET merchant_provider='mk99',provider_payment_id='pay-r'; UPDATE subscription_payment_events SET merchant_provider='mk99'");
 assert.equal(preview(db,'recharge','r').reason,'payment_identity_review');
 assert.equal(preview(db,'subscription','s').reason,'payment_identity_review');
 db.exec("UPDATE subscription_payment_transactions SET provider_payment_id='pay-s',provider_trade_id='out-r'");
 assert.equal(preview(db,'recharge','r').reason,'payment_identity_review');
 db.exec("UPDATE subscription_payment_transactions SET provider_trade_id='out-s'; UPDATE payment_transactions SET provider_payment_id=NULL");
 assert.equal(preview(db,'recharge','r').reason,'payment_identity_review');
 db.exec("UPDATE payment_transactions SET provider_payment_id='pay-r',paid_at=99");
 assert.equal(preview(db,'recharge','r').reason,'payment_identity_review');
});
