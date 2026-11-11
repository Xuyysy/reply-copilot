import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// LOCAL SQLITE ONLY. No network, secrets, Cloudflare SDK or remote D1 access.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(root, 'api/migrations');
const proposal = join(root, 'api/sql-proposals/0025_subscription_xiaodou_rsa2.sql');

export function rehearseXiaodou0025Locally() {
  const names = readdirSync(migrations).filter(x => /^\d{4}.*\.sql$/.test(x)).sort();
  assert.equal(names.length, 24, 'Do not put unapproved 0025 into Production migrations');
  assert.equal(names.at(-1), '0024_subscription_upgrade_quotes.sql');
  assert.equal(existsSync(join(migrations, '0025_subscription_xiaodou_rsa2.sql')), false);
  assert.ok(existsSync(proposal));
  const sql = readFileSync(proposal, 'utf8');
  assert.match(sql, /PRAGMA defer_foreign_keys = on/);
  assert.match(sql, /PRAGMA foreign_key_check/);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of names) db.exec(readFileSync(join(migrations, name), 'utf8'));
    assert.equal(db.prepare("SELECT value FROM system_settings WHERE key='purchase_enabled'").get().value, '0');
    db.exec("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES('local-user','local@example.test',1,1,'local-user','hash')");
    db.exec("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,quoted_at,quote_expires_at,created_at,updated_at,status) VALUES('local-old-order','local-user','basic-v1','purchase',6990,1,1000,1,1,'paid')");
    db.exec("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,provider_payment_id,payment_channel,amount_fen,notification_sign_type,created_at,updated_at,status,paid_at,checkout_state,cashier_url) VALUES('local-old-tx','local-old-order','mk99','mk99-fixture','MK99_OLD_001','MK99_PAYMENT_001','ALIPAY_H5',6990,'MD5',1,2,'paid',2,'ready','https://cashier.example.test/mk99')");
    db.exec("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at) VALUES('local-old-event','local-old-tx','mk99','mk99-old-event','PAYMENT_SUCCEEDED',6990,'mock-proof',2)");
    const txQuery = 'SELECT * FROM subscription_payment_transactions ORDER BY id';
    const eventQuery = 'SELECT * FROM subscription_payment_events ORDER BY id';
    const txBefore = db.prepare(txQuery).all();
    const eventsBefore = db.prepare(eventQuery).all();
    assert.equal(txBefore.length, 1);
    assert.equal(eventsBefore.length, 1);

    // The schema proposal runs only against this disposable in-memory database.
    db.exec(sql);
    assert.deepEqual(db.prepare(txQuery).all(), txBefore, 'MK99 transaction history changed');
    assert.deepEqual(db.prepare(eventQuery).all(), eventsBefore, 'MK99 signed event history changed');
    assert.equal(db.prepare("SELECT value FROM system_settings WHERE key='purchase_enabled'").get().value, '0');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');

    db.exec("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,quoted_at,quote_expires_at,created_at,updated_at) VALUES('local-xd-order','local-user','basic-v1','purchase',6990,1,1000,1,1)");
    db.exec("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,created_at,updated_at) VALUES('local-xd-tx','local-xd-order','xiaodou','xdop_local_fixture','XD_LOCAL_001','ALIPAY_H5',6990,'mkid_local_fixture',1,1)");
    assert.equal(db.prepare("SELECT merchant_provider FROM subscription_payment_transactions WHERE id='local-xd-tx'").get().merchant_provider, 'xiaodou');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM subscription_payment_events').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM subscription_periods').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM credit_ledger').get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='_subscription_events_backup_0025'").get().n, 0);
    return {
      execution: 'local-memory-only',
      remoteD1Touched: false,
      productionMigrations: names.length,
      proposal: 'api/sql-proposals/0025_subscription_xiaodou_rsa2.sql',
      historicalMk99TransactionPreserved: true,
      historicalMk99EventPreserved: true,
      xiaodouSchemaAccepted: true,
      foreignKeysValid: true,
      purchaseDefaultStillClosed: true,
      noEntitlementsGranted: true,
      productionReady: false,
      requiresSeparateRemoteD1AndMerchantApproval: true
    };
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(rehearseXiaodou0025Locally(), null, 2));
  } catch (error) {
    console.error('LOCAL REHEARSAL FAILED:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
