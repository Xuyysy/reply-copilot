import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {subscriptionRetryableSql,subscriptionBlocksNewCheckoutSql} from '../api/src/subscription-retry-release.js';
function fixture(merchant='mk99'){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE subscription_orders(id TEXT PRIMARY KEY,user_id TEXT,operation_id TEXT,plan_version_id TEXT,kind TEXT,status TEXT,paid_at INTEGER,applied_at INTEGER);
 CREATE TABLE subscription_payment_transactions(id TEXT,order_id TEXT,merchant_provider TEXT,status TEXT,checkout_state TEXT,checkout_attempted_at INTEGER,cashier_ready_at INTEGER,risk_state TEXT,paid_at INTEGER,provider_payment_id TEXT,cashier_url TEXT);
 CREATE TABLE subscription_payment_events(id TEXT,transaction_id TEXT);
 CREATE TABLE subscription_periods(id TEXT,source_order_id TEXT);
 CREATE TABLE subscription_tier_changes(id TEXT,order_id TEXT);`);
 db.prepare("INSERT INTO subscription_orders VALUES ('o1','u1','op1','basic-v1','purchase','unknown',NULL,NULL)").run();
 db.prepare("INSERT INTO subscription_payment_transactions VALUES ('t1','o1',?,'unknown','unknown',100,NULL,'clear',NULL,NULL,NULL)").run(merchant);
 return {db,eligible:()=>db.prepare(`SELECT ${subscriptionRetryableSql('o')} as retryable FROM subscription_orders o WHERE o.id='o1'`).get().retryable,blocks:()=>db.prepare(`SELECT ${subscriptionBlocksNewCheckoutSql('o')} as blocks FROM subscription_orders o WHERE o.id='o1'`).get().blocks};
}
test('MK99 and Xiaodou linkless subscriptions retry without changing original money state',()=>{
 for(const merchant of ['mk99','xiaodou']){const f=fixture(merchant);
 assert.equal(f.eligible(),1);assert.equal(f.blocks(),0);
 assert.equal(f.db.prepare("SELECT status FROM subscription_orders").get().status,'unknown');
 assert.equal(f.db.prepare("SELECT status FROM subscription_payment_transactions").get().status,'unknown');f.db.close();}
});
test('provider identity, cashier, paid proof, risk, extra state or entitlement always block retry',()=>{
 const cases=[
  "UPDATE subscription_payment_transactions SET provider_payment_id='real-id'",
  "UPDATE subscription_payment_transactions SET cashier_url='https://cashier.example.test/pay'",
  "UPDATE subscription_payment_transactions SET cashier_ready_at=123",
  "UPDATE subscription_payment_transactions SET checkout_state='ready'",
  "UPDATE subscription_payment_transactions SET checkout_attempted_at=NULL",
  "UPDATE subscription_payment_transactions SET paid_at=123",
  "UPDATE subscription_payment_transactions SET risk_state='manual_review'",
  "UPDATE subscription_payment_transactions SET status='paid'",
  "UPDATE subscription_orders SET paid_at=123",
  "UPDATE subscription_orders SET applied_at=123",
  "UPDATE subscription_orders SET status='pending'",
  "UPDATE subscription_orders SET status='manual_review'",
  "INSERT INTO subscription_payment_events VALUES('e','t1')",
  "INSERT INTO subscription_periods VALUES('p','o1')",
  "INSERT INTO subscription_tier_changes VALUES('c','o1')"];
 for(const sql of cases){const f=fixture();f.db.exec(sql);assert.equal(f.eligible(),0,sql);assert.equal(f.blocks(),1,sql);f.db.close();}
});
test('gate permits exactly one new buyer attempt after an eligible UNKNOWN',()=>{
 const f=fixture('xiaodou');
 const stmt=`INSERT INTO subscription_orders(id,user_id,operation_id,plan_version_id,kind,status) SELECT ?,'u1',?,'basic-v1','purchase','pending' WHERE NOT EXISTS(SELECT 1 FROM subscription_orders x WHERE x.user_id='u1' AND ${subscriptionBlocksNewCheckoutSql('x')})`;
 assert.equal(f.db.prepare(stmt).run('o2','op2').changes,1);
 assert.equal(f.db.prepare(stmt).run('o3','op3').changes,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM subscription_orders').get().n,2);f.db.close();
});
test('late payment event automatically revokes the old checkout release eligibility',()=>{
 const f=fixture();assert.equal(f.eligible(),1);f.db.exec("INSERT INTO subscription_payment_events VALUES('late','t1')");
 assert.equal(f.eligible(),0);assert.equal(f.blocks(),1);f.db.close();
});
test('only allowlisted constant SQL aliases accepted',()=>{
 for(const alias of ['p','x;DROP TABLE users','',null]){assert.throws(()=>subscriptionRetryableSql(alias));assert.throws(()=>subscriptionBlocksNewCheckoutSql(alias));}
});
