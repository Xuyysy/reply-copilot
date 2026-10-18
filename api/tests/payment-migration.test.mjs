import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {test} from "node:test";

const root=new URL("../",import.meta.url);
const migrations=["0001_init.sql","0002_credits.sql","0003_adjustment_guard.sql","0004_staging_safety.sql","0005_xiaodou_payments.sql","0006_payment_fee_refund_snapshots.sql","0007_credit_batches.sql","0008_generation_phase_legacy_repair.sql","0009_xiaodou_fee_projection.sql"];

test("payment migration preserves legacy USD orders and adds priced CNY payment records",()=>{
  const db=new DatabaseSync(":memory:");
  for(const file of migrations.slice(0,5)) db.exec(readFileSync(new URL(`migrations/${file}`,root),"utf8"));
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES('legacy-user','legacy@example.test',1,1,'legacy-user','legacy-hash')").run();
  db.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,paid_reserved_for_refunds,created_at,updated_at) VALUES('legacy-user',17,83,8,1,1)").run();
  db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,provider_reference,created_at,paid_at,credited_at) VALUES('legacy-order','legacy-user','starter','入门包',400,199,'USD','paid','legacy-provider-ref',1,2,3)").run();
  db.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES('legacy-ledger','legacy-user','signup_grant',200,0,'legacy-grant','legacy row',1)").run();
  db.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,status,created_at,updated_at) VALUES('legacy-tx','legacy-order','xiaodou','CNY',990,'paid',1,2)").run();
  db.prepare("UPDATE credit_accounts SET paid_reserved_for_refunds=8 WHERE user_id='legacy-user'").run();
  db.prepare("INSERT INTO payment_refunds(id,transaction_id,out_refund_no,amount_fen,status,reason,credits_reserved,created_at,updated_at) VALUES('legacy-refund','legacy-tx','legacy-refund-no',100,'pending','legacy pending refund',8,2,2)").run();
  for(const file of migrations.slice(5)) db.exec(readFileSync(new URL(`migrations/${file}`,root),"utf8"));
  const packageColumns=db.prepare("PRAGMA table_info(recharge_packages)").all().map(row=>row.name);
  assert.ok(packageColumns.includes("price_cny_fen"));
  assert.deepEqual({...db.prepare("SELECT price_cents,price_cny_fen FROM recharge_packages WHERE id='starter'").get()},{price_cents:149,price_cny_fen:990});
  assert.deepEqual(db.prepare("SELECT price_cents,price_cny_fen FROM recharge_packages ORDER BY sort_order").all().map(row=>[row.price_cents,row.price_cny_fen]),[[149,990],[299,1990],[499,3290]]);
  assert.ok(db.prepare("PRAGMA table_info(credit_accounts)").all().some(row=>row.name==="paid_reserved_for_refunds"));
  assert.deepEqual({...db.prepare("SELECT amount_cents,currency,status,provider_reference,paid_at,credited_at FROM recharge_orders WHERE id='legacy-order'").get()},{amount_cents:199,currency:"USD",status:"paid",provider_reference:"legacy-provider-ref",paid_at:2,credited_at:3});
  assert.deepEqual({...db.prepare("SELECT id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at FROM credit_ledger WHERE id='legacy-ledger'").get()},{id:"legacy-ledger",user_id:"legacy-user",kind:"signup_grant",free_delta:200,paid_delta:0,reference_id:"legacy-grant",reason:"legacy row",created_at:1});
  const transactionColumns=db.prepare("PRAGMA table_info(payment_transactions)").all().map(row=>row.name);
  for(const name of ["order_id","provider","currency","amount_fen","base_amount_fen","service_fee_fen","fee_rate_bps","principal_refunded_fen","service_fee_refunded_fen","status","provider_trade_id"]) assert.ok(transactionColumns.includes(name));
  for(const name of ["provider_fee_projection_status","provider_fee_projection_json","provider_fee_projection_issue"]) assert.ok(transactionColumns.includes(name));
  assert.deepEqual({...db.prepare("SELECT amount_fen,base_amount_fen,service_fee_fen,fee_rate_bps,principal_refunded_fen,service_fee_refunded_fen FROM payment_transactions WHERE id='legacy-tx'").get()},{amount_fen:990,base_amount_fen:990,service_fee_fen:0,fee_rate_bps:0,principal_refunded_fen:0,service_fee_refunded_fen:0});
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_transactions'").get().sql.toLowerCase().includes("unknown"));
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='credit_ledger'").get().sql.includes("purchase_reversal"));
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_attempts'").get());
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_refunds'").get());
  const refundColumns=db.prepare("PRAGMA table_info(payment_refunds)").all().map(row=>row.name);
  for(const name of ["base_amount_fen","service_fee_amount_fen"]) assert.ok(refundColumns.includes(name));
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='provider_payment_events'").get());
  const batches=db.prepare("SELECT bucket,source_kind,grant_credits,remaining_credits,refund_reserved_credits,history_confidence,status FROM credit_batches WHERE user_id='legacy-user' ORDER BY bucket").all();
  assert.deepEqual(batches.map(row=>[row.bucket,row.source_kind,row.grant_credits,row.remaining_credits,row.refund_reserved_credits,row.history_confidence,row.status]),[
    ["free","legacy_free",17,17,0,"legacy_unknown","active"],
    ["paid","legacy_paid",83,83,8,"legacy_unknown","active"],
  ]);
  assert.equal(db.prepare("SELECT credit_batch_id FROM payment_refunds WHERE id='legacy-refund'").get().credit_batch_id,"legacy-paid:legacy-user");
  assert.equal(db.prepare("SELECT history_confidence FROM credit_batches WHERE id='legacy-paid:legacy-user'").get().history_confidence,"legacy_unknown","legacy lots stay usable but never gain automatic refund eligibility");
  assert.equal(db.prepare("SELECT sum(remaining_credits) n FROM credit_batches WHERE user_id='legacy-user' AND bucket='free'").get().n,db.prepare("SELECT free_balance n FROM credit_accounts WHERE user_id='legacy-user'").get().n);
  assert.equal(db.prepare("SELECT sum(remaining_credits) n FROM credit_batches WHERE user_id='legacy-user' AND bucket='paid'").get().n,db.prepare("SELECT paid_balance n FROM credit_accounts WHERE user_id='legacy-user'").get().n);
  assert.equal(db.prepare("SELECT count(*) n FROM ai_credit_allocations").get().n,0,"legacy requests are not assigned to a purchase lot");
  assert.equal(db.prepare("SELECT amount_fen,base_amount_fen,service_fee_fen,fee_rate_bps FROM payment_transactions WHERE id='legacy-tx'").get().service_fee_fen,0);
  assert.deepEqual({...db.prepare("SELECT provider_fee_projection_status,provider_fee_projection_json,provider_fee_projection_issue FROM payment_transactions WHERE id='legacy-tx'").get()},{provider_fee_projection_status:"legacy_unverified",provider_fee_projection_json:null,provider_fee_projection_issue:"legacy_unverified"});
  db.close();
});

test("credit batch schema rejects negative balances and duplicate purchase lots",()=>{
  const db=new DatabaseSync(":memory:");
  for(const file of migrations)db.exec(readFileSync(new URL(`migrations/${file}`,root),"utf8"));
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES('new-user','new@example.test',1,1,'new-user','hash')").run();
  db.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('new-user',0,0,1,1)").run();
  db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) VALUES('order-1','new-user','starter','starter',400,149,'USD','pending',1)").run();
  assert.throws(()=>db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,consumed_credits,permanently_revoked_credits,generation_reserved_credits,refund_reserved_credits,granted_at,history_confidence,status) VALUES('bad','new-user','paid','purchase',5,-1,0,0,0,0,1,'tracked','active')").run());
  db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,source_order_id,grant_credits,remaining_credits,consumed_credits,permanently_revoked_credits,generation_reserved_credits,refund_reserved_credits,granted_at,history_confidence,status) VALUES('lot-1','new-user','paid','purchase','order-1',5,5,0,0,0,0,1,'tracked','active')").run();
  assert.throws(()=>db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,source_order_id,grant_credits,remaining_credits,consumed_credits,permanently_revoked_credits,generation_reserved_credits,refund_reserved_credits,granted_at,history_confidence,status) VALUES('lot-2','new-user','paid','purchase','order-1',5,5,0,0,0,0,1,'tracked','active')").run());
  db.close();
});
