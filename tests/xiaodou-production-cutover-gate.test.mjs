import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildXiaodouCutoverGateReport,evaluateXiaodouCutoverGate } from '../scripts/xiaodou-production-cutover-gate.mjs';

test('single command runs synthetic recovery and reports five ordered NO-GO phases',async()=>{
  const out=await evaluateXiaodouCutoverGate();
  assert.equal(out.status,'NO_GO_UNTIL_SEPARATELY_APPROVED_AND_INDEPENDENTLY_VERIFIED');
  assert.equal(out.localRecoveryExecuted,true);
  assert.equal(out.localRecoverySyntheticOnly,true);
  assert.equal(out.stageCount,5);
  assert.deepEqual(out.stages.map(p=>p.id),[
    'code_and_recovery','production_database_protection',
    'xiaodou_merchant_configuration','compatible_production_release',
    'explicit_merchant_switch'
  ]);
  assert.equal(out.stages[0].claimsComplete,true,'local safe source+backup checks pass');
  assert.equal(out.firstMissingStage,'production_database_protection');
  assert.ok(out.blockers.some(x=>x.id==='verified_backup_and_restore'));
  assert.ok(out.blockers.some(x=>x.id==='five_rsa2_secret_bindings_present'));
  assert.equal(out.allowsRemoteSql,false);
  assert.equal(out.allowsProductionBackup,false);
  assert.equal(out.allowsMigration0025,false);
  assert.equal(out.allowsSecretChanges,false);
  assert.equal(out.allowsWorkerDeployment,false);
  assert.equal(out.allowsMerchantSwitch,false);
  assert.match(out.proposalSha256,/^[a-f0-9]{64}$/);
});

test('even an entirely green operator-claimed packet cannot unlock financial operations',()=>{
 const phases=['code','database','merchant','release','switch'].map(name=>({name,claimsComplete:true}));
 const fake={
  phases,blockers:[],proposalSha256:'a'.repeat(64),status:'EVIDENCE_CLAIMS_COMPLETE_REQUIRES_INDEPENDENT_APPROVAL'
 };
 const synthetic={localBackupRestoredAndVerified:true,injectedMigrationFailureRolledBack:true,
   deferredOrphanForeignKeyRolledBack:true,historicalRowsAndMerchantRoutingUnchanged:true,
   productionD1Touched:false,productionReady:false};
 const out=buildXiaodouCutoverGateReport(fake,synthetic);
 assert.equal(out.firstMissingStage,null);
 assert.ok(out.stages.every(x=>x.claimsComplete));
 assert.ok(out.stages.every(x=>x.grantsProductionPermission===false));
 assert.notEqual(out.status,'GO');
 for(const flag of ['allowsRemoteSql','allowsProductionBackup','allowsMigration0025','allowsSecretChanges',
   'allowsWorkerDeployment','allowsMerchantSwitch'])assert.equal(out[flag],false,flag);
});

test('a failed local backup or FK check stops all downstream stages',()=>{
 const incomplete={phases:[],blockers:[],proposalSha256:'b'.repeat(64)};
 const bad={localBackupRestoredAndVerified:false,injectedMigrationFailureRolledBack:true,
   deferredOrphanForeignKeyRolledBack:true,historicalRowsAndMerchantRoutingUnchanged:true,
   productionD1Touched:false,productionReady:false};
 const out=buildXiaodouCutoverGateReport(incomplete,bad);
 assert.equal(out.firstMissingStage,'code_and_recovery');
 assert.equal(out.stages[0].status,'BLOCKED');
 assert.ok(out.stages[0].missingEvidenceIds.includes('synthetic_backup_migration_and_rollback_rehearsal'));
 assert.ok(out.stages.slice(1).every(z=>z.status==='WAITING_ON_PREVIOUS_STAGE'));
});

test('untrusted operator data never appears in output, including credential-looking values',async()=>{
 const secret='FAKE_PRIVATE_KEY_MUST_NOT_LEAK_12345';
 const out=await evaluateXiaodouCutoverGate({
   schemaVersion:1,
   runtime:{
     workerBindings:[{name:'UNTRUSTED_BINDING',type:'secret_text',value:secret}],
     networkMode:'allowlist_disabled',
     networkModeConfirmed:false,
     unrelatedValue:secret
   },
   source:{candidateSha:secret},
   note:secret
 });
 const data=JSON.stringify(out);
 assert.doesNotMatch(data,/FAKE_PRIVATE_KEY_MUST_NOT_LEAK_12345|UNTRUSTED_BINDING|unrelatedValue/);
 assert.equal(out.allowsSecretChanges,false);
});

test('offline gate is incapable of remote access and uses validated local sources only',()=>{
 const src=readFileSync(new URL('../scripts/xiaodou-production-cutover-gate.mjs',import.meta.url),'utf8');
 assert.match(src,/rehearseXiaodouProductionRecoveryLocally/);
 assert.match(src,/evaluateXiaodouProductionReadiness/);
 assert.doesNotMatch(src,/from ['"](?:cloudflare|@cloudflare)|cloudflare\.request|https?:\/\/api\.cloudflare\.com|execFileSync|spawnSync|\bfetch\s*\(/);
 assert.match(src,/process\.exitCode=2/);
});
