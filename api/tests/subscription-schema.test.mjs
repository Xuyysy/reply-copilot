import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { SUBSCRIPTION_PERIOD_MS } from '../../domain/subscription-policy.js';

const migrations = new URL('../migrations/', import.meta.url);
function database() {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync(migrations).filter(x => x.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL(name, migrations), 'utf8'));
  return db;
}

test('subscription migration is additive and never changes existing monetary balances', () => {
  const db = database();
  try {
    const plans = db.prepare('SELECT plan_code,price_fen,daily_limit,duration_days FROM subscription_plan_versions ORDER BY daily_limit').all();
    assert.deepEqual(plans.map(p => ({...p})), [
      {plan_code:'basic',price_fen:6990,daily_limit:500,duration_days:30},
      {plan_code:'pro',price_fen:11990,daily_limit:1000,duration_days:30},
      {plan_code:'max',price_fen:17990,daily_limit:1500,duration_days:30},
      {plan_code:'ultra',price_fen:25990,daily_limit:2000,duration_days:30}
    ]);
    for (const table of ['subscription_orders','subscription_payment_transactions','subscription_payment_events','subscription_periods','subscription_daily_usage','subscription_ai_allocations','subscription_usage_events','subscription_tier_changes']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
    }
    assert.equal(db.prepare('SELECT count(*) n FROM credit_accounts').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM credit_batches').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM recharge_orders').get().n,0);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('plan version prices are snapshots; only one current version per plan can exist', () => {
  const db = database();
  try {
    assert.throws(()=>db.exec("INSERT INTO subscription_plan_versions(id,plan_code,version,price_fen,daily_limit,name_zh,name_en,created_at,updated_at) VALUES ('bad','basic',2,1,2000,'bad','bad',1,1)"), /CHECK constraint/);
    assert.throws(()=>db.exec("INSERT INTO subscription_plan_versions(id,plan_code,version,price_fen,daily_limit,name_zh,name_en,created_at,updated_at) VALUES ('bad','basic',2,8990,500,'new','New',1,1)"), /UNIQUE constraint/);
    db.exec("UPDATE subscription_plan_versions SET current=0 WHERE plan_code='basic'");
    db.exec("INSERT INTO subscription_plan_versions(id,plan_code,version,price_fen,daily_limit,name_zh,name_en,created_at,updated_at) VALUES ('basic-v2','basic',2,8990,500,'new','New',1,1)");
    assert.equal(db.prepare("SELECT price_fen FROM subscription_plan_versions WHERE id='basic-v1'").get().price_fen, 6990);
    assert.equal(db.prepare("SELECT price_fen FROM subscription_plan_versions WHERE id='basic-v2'").get().price_fen, 8990);
  } finally { db.close(); }
});

test('subscription allocations and 30-day periods preserve user ownership and single-active-period uniqueness', () => {
  const db=database();
  try {
    const anchor=Date.UTC(2026,10,9,14,30);
    db.prepare("INSERT INTO users(id,email,email_verified_at,created_at) VALUES('subscriber','subscriber@example.test',1,1)").run();
    db.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,quoted_at,quote_expires_at,created_at,updated_at) VALUES('sub-order','subscriber','basic-v1','purchase',6990,1,9999999999999,1,1)").run();
    db.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('sub-period','subscriber','sub-order','basic-v1',500,'active',?,?,1,1)").run(anchor,anchor+SUBSCRIPTION_PERIOD_MS);
    db.prepare("INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES('sub-period',0,480,1,1)").run();
    db.prepare("INSERT INTO ai_requests(request_id,user_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at) VALUES('req-1','subscriber','2026-11-09','req-nonce','reserved',0,'inputhash',1)").run();
    db.prepare("INSERT INTO subscription_ai_allocations(id,user_id,request_id,period_id,day_index,state,created_at) VALUES('alloc-1','subscriber','req-1','sub-period',0,'reserved',1)").run();
    assert.throws(()=>db.prepare("INSERT INTO subscription_ai_allocations(id,user_id,request_id,period_id,day_index,state,created_at) VALUES('alloc-2','subscriber','req-1','sub-period',0,'reserved',1)").run(),/UNIQUE constraint/);
    assert.throws(()=>db.prepare("INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES('sub-period',30,0,0,1)").run(),/CHECK constraint/);
    assert.throws(()=>db.prepare("INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES('sub-period',1,-1,0,1)").run(),/CHECK constraint/);
    db.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,quoted_at,quote_expires_at,created_at,updated_at) VALUES('sub-order-2','subscriber','pro-v1','renewal',11990,1,9999999999999,1,1)").run();
    assert.throws(()=>db.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('sub-period-2','subscriber','sub-order-2','pro-v1',1000,'active',?,?,1,1)").run(anchor,anchor+SUBSCRIPTION_PERIOD_MS),/UNIQUE constraint/);
    db.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,created_at,updated_at) VALUES('sub-period-2','subscriber','sub-order-2','pro-v1',1000,'queued',1,1)").run();
    assert.equal(db.prepare("SELECT count(*) n FROM subscription_periods WHERE user_id='subscriber'").get().n,2);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
});

test('0022 through 0024 preserve a populated 0021 permanent-credit ledger',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const files=readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort();
  const run=name=>db.exec(readFileSync(new URL(name,migrations),'utf8'));
  for(const name of files.filter(name=>name.slice(0,4)<='0021'))run(name);
  db.exec(`INSERT INTO users(id,email,email_verified_at,created_at) VALUES('prior','prior@example.test',1,1);
   INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('prior',73,19,1,1);
   INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at)
     VALUES('ledger-before','prior','purchase_grant',0,19,'old-order','prior verified purchase',1);
   INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at)
     SELECT 'legacy-order','prior',id,'Legacy',19,100,'USD','paid',1 FROM recharge_packages LIMIT 1;`);
  const snapshot=()=>['users','credit_accounts','credit_ledger','credit_batches','recharge_orders']
    .map(table=>db.prepare('SELECT * FROM '+table).all());
  const before=snapshot();
  assert.equal(before[4].length,1);
  for(const name of files.filter(name=>name.slice(0,4)>'0021'))run(name);
  assert.deepEqual(snapshot(),before);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
