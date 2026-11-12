import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syntheticProductionShape, rehearseXiaodouProductionRecoveryLocally } from '../scripts/xiaodou-production-isolated-recovery.mjs';

test('synthetic 0025 end-to-end recovery exercise preserves every audited MK99 count and entitlement boundary', async () => {
  assert.deepEqual(syntheticProductionShape,{
    mk99SubscriptionPaid:3,mk99SubscriptionClosed:2,mk99SubscriptionEvents:3,
    activePeriods:3,mk99CreditPaid:11,mk99CreditClosed:3,rechargePaid:11,rechargeExpired:3
  });
  const result=await rehearseXiaodouProductionRecoveryLocally();
  for(const key of [
    'auditedShapeMatched','historicalRowsAndMerchantRoutingUnchanged',
    'localBackupRestoredAndVerified','injectedMigrationFailureRolledBack',
    'deferredOrphanForeignKeyRolledBack','committedMigrationForeignKeysValid',
    'localXiaodouSchemaAccepted','noUnexpectedEntitlementsGranted'
  ])assert.equal(result[key],true,key);
  assert.equal(result.productionMigrationCount,24);
  assert.equal(result.historicalTablesPreserved,9);
  assert.equal(result.productionReady,false);
  assert.equal(result.productionD1Touched,false);
  assert.equal(result.requiresIndependentProductionBackupMigrationAndMerchantApprovals,true);
  assert.match(result.proposalSha256,/^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-user|@example|private.key|provider.event|cashier_url/i);
});

test('the new 0025 recovery module cannot connect to D1, import cloud access, or initiate a production change', () => {
  const source=readFileSync(new URL('../scripts/xiaodou-production-isolated-recovery.mjs',import.meta.url),'utf8');
  assert.match(source,/new DatabaseSync\(':memory:'\)/);
  assert.match(source,/await backup\(db,localBackup\)/);
  assert.match(source,/new DatabaseSync\(localBackup\)/);
  assert.match(source,/assertUnchanged\(restored,original\)/);
  assert.match(source,/assertUnchanged\(db,before\)/);
  assert.match(source,/db.exec\('COMMIT'\)/);
  assert.match(source,/db.exec\('ROLLBACK'\)/);
  assert.match(source,/rmSync\(directory,\{recursive:true,force:true\}\)/);
  assert.doesNotMatch(source,/from ['"]cloudflare|cloudflare\.request|api\.cloudflare\.com|wrangler|child_process|https?:\/\/api\.|(?:^|\W)fetch\s*\(/i);
  const sql=readFileSync(new URL('../api/sql-proposals/0025_subscription_xiaodou_rsa2.sql',import.meta.url),'utf8');
  assert.match(sql,/PRAGMA defer_foreign_keys = on;/);
  assert.doesNotMatch(sql,/PRAGMA\s+defer_foreign_keys\s*=\s*off\s*;/i);
});

test('the standalone local recovery output is non-authorizing and does not fabricate a D1 backup', async()=>{
  const outcome=await rehearseXiaodouProductionRecoveryLocally();
  assert.equal(outcome.execution,'local-synthetic-backup-and-restore-only');
  assert.equal(outcome.productionReady,false);
  assert.equal(outcome.productionD1Touched,false);
  assert.equal(Object.hasOwn(outcome,'productionBackupVerified'),false);
  assert.equal(Object.hasOwn(outcome,'migration0025AppliedToProduction'),false);
  assert.equal(Object.hasOwn(outcome,'merchantSwitchApproved'),false);
});
