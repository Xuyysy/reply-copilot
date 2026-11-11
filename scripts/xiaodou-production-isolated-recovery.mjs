import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';

// 100% local, synthetic-data-only rehearsal. NEVER attach a real D1 database,
// inspect credentials, read user rows or deploy anything from this module.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'api/migrations');
const proposalFile = join(root, 'api/sql-proposals/0025_subscription_xiaodou_rsa2.sql');
const tables = Object.freeze([
  ['subscription_orders','id'],
  ['subscription_payment_transactions','id'],
  ['subscription_payment_events','id'],
  ['subscription_periods','id'],
  ['recharge_orders','id'],
  ['payment_transactions','id'],
  ['credit_accounts','user_id'],
  ['credit_ledger','id'],
  ['system_settings','key']
]);
export const syntheticProductionShape = Object.freeze({
  mk99SubscriptionPaid: 3,
  mk99SubscriptionClosed: 2,
  mk99SubscriptionEvents: 3,
  activePeriods: 3,
  mk99CreditPaid: 11,
  mk99CreditClosed: 3,
  rechargePaid: 11,
  rechargeExpired: 3
});
const count = (db,sql) => db.prepare(sql).get().n;
const sha = value => createHash('sha256').update(value).digest('hex');
const assertFk = db => {
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'orphan references detected');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
};
function snapshot(db) {
  const hashes = {};
  for (const [table,key] of tables) {
    const rows = db.prepare('SELECT * FROM ' + table + ' ORDER BY ' + key).all();
    hashes[table] = sha(JSON.stringify(rows,(_key,value)=>typeof value === 'bigint' ? value.toString() : value));
  }
  return hashes;
}
function assertUnchanged(db,before) {
  assert.deepEqual(snapshot(db), before, 'historic financial, credit, period or merchant-state data changed');
}
function groupCounts(db) {
  return {
    mk99SubscriptionPaid:count(db,"SELECT COUNT(*) n FROM subscription_payment_transactions WHERE merchant_provider='mk99' AND status='paid'"),
    mk99SubscriptionClosed:count(db,"SELECT COUNT(*) n FROM subscription_payment_transactions WHERE merchant_provider='mk99' AND status='closed'"),
    mk99SubscriptionEvents:count(db,"SELECT COUNT(*) n FROM subscription_payment_events WHERE merchant_provider='mk99'"),
    activePeriods:count(db,"SELECT COUNT(*) n FROM subscription_periods WHERE status='active'"),
    mk99CreditPaid:count(db,"SELECT COUNT(*) n FROM payment_transactions WHERE merchant_provider='mk99' AND status='paid'"),
    mk99CreditClosed:count(db,"SELECT COUNT(*) n FROM payment_transactions WHERE merchant_provider='mk99' AND status='closed'"),
    rechargePaid:count(db,"SELECT COUNT(*) n FROM recharge_orders WHERE status='paid'"),
    rechargeExpired:count(db,"SELECT COUNT(*) n FROM recharge_orders WHERE status='expired'")
  };
}
function syntheticSeed(db) {
  const user = db.prepare('INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES(?,?,?,?,?,?)');
  const account = db.prepare('INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,?,?,?,?)');
  const grant = db.prepare('INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) VALUES(?,?,?,?,?,?,?)');
  for(let i=1;i<=3;i++){
    const id='synthetic-user-'+i;
    user.run(id,'test-'+i+'@example.invalid',1,1,'synthetic-'+i,'never-a-real-password');
    account.run(id,200,0,1,1);
    grant.run('synthetic-grant-'+i,id,'signup_grant',200,0,'synthetic-grant-ref-'+i,1);
  }
  const orders=db.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  const tx=db.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,provider_payment_id,payment_channel,amount_fen,notification_sign_type,status,created_at,updated_at,paid_at,checkout_state,cashier_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const evt=db.prepare("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at) VALUES(?,?,?,?,?,?,?,?)");
  const period=db.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
  for(let i=1;i<=5;i++){
    const id='synthetic-sub-'+i;
    const uid='synthetic-user-'+((i-1)%3+1);
    const paid=i<=3;
    orders.run(id,uid,'basic-v1',i===5?'renewal':'purchase',6990,paid?'paid':'closed',1,1000,1,2,paid?2:null);
    tx.run(id+'-tx',id,'mk99','synthetic-mk99','TEST-SUB-'+i,paid?'TEST-PAID-'+i:null,'ALIPAY_H5',6990,'MD5',paid?'paid':'closed',1,2,paid?2:null,paid?'ready':'unprepared',paid?'https://example.invalid/paid':null);
    if(paid){
      evt.run(id+'-event',id+'-tx','mk99','TEST-EVENT-'+i,'PAYMENT_SUCCEEDED',6990,sha(id),2);
      period.run(id+'-period',uid,id,'basic-v1',500,'active',1000,2592001000,1,2);
    }
  }
  const creditOrder=db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at,paid_at,credited_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  const creditTx=db.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,status,provider_trade_id,created_at,updated_at,paid_at,merchant_provider,merchant_account,notification_sign_type,provider_payment_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for(let i=1;i<=14;i++){
    const paid=i<=11,id='synthetic-credit-'+i;
    creditOrder.run(id,'synthetic-user-'+((i-1)%3+1),'starter','Starter',400,149,'USD',paid?'paid':'expired',1,paid?2:null,paid?2:null);
    creditTx.run(id+'-tx',id,'xiaodou','CNY',1059,paid?'paid':'closed','TEST-CREDIT-'+i,1,2,paid?2:null,'mk99','synthetic-mk99','MD5',paid?'TEST-CREDIT-PAID-'+i:null);
  }
  for (const [key,value] of [
    ['active_merchant','mk99'],['purchase_enabled','1'],['payment_mk99_enabled','1'],
    ['payment_rsa2_enabled','1'],['payment_rsa2_alipay_released','0']
  ])db.prepare('INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
  assert.deepEqual(groupCounts(db),syntheticProductionShape);
  assert.equal(db.prepare("SELECT value FROM system_settings WHERE key='active_merchant'").get().value,'mk99');
  assert.equal(db.prepare("SELECT value FROM system_settings WHERE key='purchase_enabled'").get().value,'1');
  assertFk(db);
}
function migrate(db,sql) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    assertFk(db);
    db.exec('COMMIT'); // COMMIT must enforce the deferred foreign keys.
  } catch(e) {
    if(db.isTransaction)db.exec('ROLLBACK');
    throw e;
  }
  assert.equal(db.isTransaction,false);
  assertFk(db);
}
function verifyFailClosedRollback(restored,sql,original) {
  const target='DROP TABLE subscription_payment_transactions;';
  assert.equal(sql.split(target).length,2,'cannot inject failure into a changed migration shape');
  const bad=sql.replace(target,target+'\nSELECT * FROM __synthetic_0025_abort__;\n');
  let rejected=false;
  restored.exec('BEGIN IMMEDIATE');
  try { restored.exec(bad); }
  catch { rejected=true; }
  finally { if(restored.isTransaction)restored.exec('ROLLBACK'); }
  assert.equal(rejected,true,'injected failure must be rejected');
  assertUnchanged(restored,original);
  assert.equal(count(restored,"SELECT COUNT(*) n FROM sqlite_master WHERE name='subscription_payment_transactions_0025'"),0);
  assert.equal(count(restored,"SELECT COUNT(*) n FROM sqlite_master WHERE name='_subscription_events_backup_0025'"),0);
  assertFk(restored);
  return true;
}
function verifyDeferredFkRollback(restored,original){
  restored.exec('BEGIN IMMEDIATE');
  try{
    restored.exec('PRAGMA defer_foreign_keys=ON');
    restored.prepare("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,received_at) VALUES(?,?,?,?,?,?,?)").run(
      'synthetic-orphan','missing-transaction','mk99','orphan-event','TEST',6990,5);
    assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,1);
    assert.throws(()=>restored.exec('COMMIT'),/FOREIGN KEY constraint failed/i);
  } finally {
    if(restored.isTransaction)restored.exec('ROLLBACK');
  }
  assertUnchanged(restored,original);
  assertFk(restored);
  return true;
}
export async function rehearseXiaodouProductionRecoveryLocally(){
  const files=readdirSync(migrationsDir).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort();
  assert.equal(files.length,24,'0025 must remain outside deployable migrations');
  assert.equal(files.at(-1),'0024_subscription_upgrade_quotes.sql');
  const sql=readFileSync(proposalFile,'utf8');
  assert.match(sql,/PRAGMA defer_foreign_keys = on/);
  assert.doesNotMatch(sql,/PRAGMA\s+defer_foreign_keys\s*=\s*off\s*;/i);
  const directory=mkdtempSync(join(tmpdir(),'reply-copilot-synthetic-0025-'));
  const localBackup=join(directory,'synthetic-only.sqlite');
  const db=new DatabaseSync(':memory:');
  let restored;
  try{
    db.exec('PRAGMA foreign_keys=ON');
    for(const f of files)db.exec(readFileSync(join(migrationsDir,f),'utf8'));
    syntheticSeed(db);
    const before=snapshot(db);
    const counted=groupCounts(db);
    // A *real local SQLite backup API* and a reopened isolated DB, never a
    // Cloudflare export or an irreversible Production Time Travel restore.
    await backup(db,localBackup);
    restored=new DatabaseSync(localBackup);
    restored.exec('PRAGMA foreign_keys=ON');
    assertUnchanged(restored,before);
    assert.deepEqual(groupCounts(restored),counted);
    assertFk(restored);
    const failureRollbackVerified=verifyFailClosedRollback(restored,sql,before);
    const orphanRollbackVerified=verifyDeferredFkRollback(restored,before);
    assertUnchanged(restored,before);
    migrate(db,sql);
    assertUnchanged(db,before);
    assert.deepEqual(groupCounts(db),syntheticProductionShape);
    assert.equal(count(db,"SELECT COUNT(*) n FROM sqlite_master WHERE name='_subscription_events_backup_0025'"),0);
    assert.equal(count(db,"SELECT COUNT(*) n FROM sqlite_master WHERE name='subscription_payment_transactions_0025'"),0);
    // New merchant can enter only through the new schema. The DDL alone must
    // never create a credit grant or subscription entitlement.
    db.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,quoted_at,quote_expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
      'synthetic-xiaodou','synthetic-user-1','basic-v1','purchase',6990,1,1000,1,1);
    db.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      'synthetic-xiaodou-tx','synthetic-xiaodou','xiaodou','synthetic-xiaodou-account','TEST-XIAODOU-1','ALIPAY_H5',6990,'test-key-id',1,1);
    assert.equal(count(db,"SELECT COUNT(*) n FROM subscription_payment_transactions WHERE merchant_provider='xiaodou'"),1);
    assert.equal(count(db,"SELECT COUNT(*) n FROM subscription_periods WHERE status='active'"),3);
    assert.equal(count(db,"SELECT COUNT(*) n FROM credit_ledger"),3);
    assert.equal(count(db,"SELECT COALESCE(SUM(paid_balance),0) n FROM credit_accounts"),0);
    assert.equal(db.prepare("SELECT value FROM system_settings WHERE key='active_merchant'").get().value,'mk99');
    assertFk(db);
    return{
      execution:'local-synthetic-backup-and-restore-only',
      productionReady:false,
      productionD1Touched:false,
      proposalSha256:sha(sql),
      auditedShapeMatched:true,
      historicalTablesPreserved:tables.length,
      historicalRowsAndMerchantRoutingUnchanged:true,
      localBackupRestoredAndVerified:true,
      injectedMigrationFailureRolledBack:failureRollbackVerified,
      deferredOrphanForeignKeyRolledBack:orphanRollbackVerified,
      committedMigrationForeignKeysValid:true,
      localXiaodouSchemaAccepted:true,
      noUnexpectedEntitlementsGranted:true,
      productionMigrationCount:files.length,
      requiresIndependentProductionBackupMigrationAndMerchantApprovals:true
    };
  }finally{
    if(restored?.isOpen)restored.close();
    if(db.isOpen)db.close();
    rmSync(directory,{recursive:true,force:true});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  rehearseXiaodouProductionRecoveryLocally().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{
    console.error('LOCAL SYNTHETIC RECOVERY REHEARSAL FAILED:',e instanceof Error?e.message:String(e));
    process.exitCode=1;
  });
}
