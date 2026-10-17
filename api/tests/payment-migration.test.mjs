import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {test} from "node:test";

const root=new URL("../",import.meta.url);
const migrations=["0001_init.sql","0002_credits.sql","0003_adjustment_guard.sql","0004_staging_safety.sql","0005_xiaodou_payments.sql"];

test("payment migration preserves legacy USD orders and adds priced CNY payment records",()=>{
  const db=new DatabaseSync(":memory:");
  for(const file of migrations.slice(0,-1)) db.exec(readFileSync(new URL(`migrations/${file}`,root),"utf8"));
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES('legacy-user','legacy@example.test',1,1,'legacy-user','legacy-hash')").run();
  db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,provider_reference,created_at,paid_at,credited_at) VALUES('legacy-order','legacy-user','starter','入门包',400,199,'USD','paid','legacy-provider-ref',1,2,3)").run();
  db.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES('legacy-ledger','legacy-user','signup_grant',200,0,'legacy-grant','legacy row',1)").run();
  db.exec(readFileSync(new URL(`migrations/${migrations.at(-1)}`,root),"utf8"));
  const packageColumns=db.prepare("PRAGMA table_info(recharge_packages)").all().map(row=>row.name);
  assert.ok(packageColumns.includes("price_cny_fen"));
  assert.deepEqual({...db.prepare("SELECT price_cents,price_cny_fen FROM recharge_packages WHERE id='starter'").get()},{price_cents:149,price_cny_fen:990});
  assert.deepEqual(db.prepare("SELECT price_cents,price_cny_fen FROM recharge_packages ORDER BY sort_order").all().map(row=>[row.price_cents,row.price_cny_fen]),[[149,990],[299,1990],[499,3290]]);
  assert.ok(db.prepare("PRAGMA table_info(credit_accounts)").all().some(row=>row.name==="paid_reserved_for_refunds"));
  assert.deepEqual({...db.prepare("SELECT amount_cents,currency,status,provider_reference,paid_at,credited_at FROM recharge_orders WHERE id='legacy-order'").get()},{amount_cents:199,currency:"USD",status:"paid",provider_reference:"legacy-provider-ref",paid_at:2,credited_at:3});
  assert.deepEqual({...db.prepare("SELECT id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at FROM credit_ledger WHERE id='legacy-ledger'").get()},{id:"legacy-ledger",user_id:"legacy-user",kind:"signup_grant",free_delta:200,paid_delta:0,reference_id:"legacy-grant",reason:"legacy row",created_at:1});
  const transactionColumns=db.prepare("PRAGMA table_info(payment_transactions)").all().map(row=>row.name);
  for(const name of ["order_id","provider","currency","amount_fen","status","provider_trade_id"]) assert.ok(transactionColumns.includes(name));
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_transactions'").get().sql.toLowerCase().includes("unknown"));
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='credit_ledger'").get().sql.includes("purchase_reversal"));
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_attempts'").get());
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_refunds'").get());
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='provider_payment_events'").get());
  db.close();
});
