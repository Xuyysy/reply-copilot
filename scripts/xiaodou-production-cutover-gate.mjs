import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateXiaodouProductionReadiness } from './xiaodou-production-readiness.mjs';
import { rehearseXiaodouProductionRecoveryLocally } from './xiaodou-production-isolated-recovery.mjs';

// Read-only, one-command orchestration of existing LOCAL verification.
// Operator evidence remains unauthenticated and can NEVER grant a permission.
const stages = Object.freeze([
  {id:'code_and_recovery',title:'Code, full regression and isolated recovery',phase:'code',
   requirements:['local_migration_rehearsal','production_identity_and_isolation','proposal_excluded_from_auto_migrations'],requires:['Successful isolated synthetic backup/rollback and explicit FK-commit check']},
  {id:'production_database_protection',title:'Production schema, backup and migration',phase:'database',
   requirements:['read_only_audit_approved_and_completed','verified_backup_and_restore','0025_explicit_approval_and_verified_application','legacy_financial_rows_and_foreign_keys_preserved'],requires:['Individually approved Production D1 backup and isolated recovery','Separate exact SQL-SHA 0025 migration authorization','Verified historic MK99 ledger and FK reconciliation']},
  {id:'xiaodou_merchant_configuration',title:'Xiaodou RSA2 secret and merchant acceptance',phase:'merchant',
   requirements:['five_rsa2_secret_bindings_present','network_mode_explicitly_confirmed','signed_query_webhook_and_alipay_acceptance','historical_mk99_continuity'],requires:['Five authentic Production Secret bindings','Operator-verified network allowlist mode','Signed provider query, webhook, credit and subscription test evidence']},
  {id:'compatible_production_release',title:'Production release with MK99 kept active',phase:'release',
   requirements:['exact_source_and_build_ci','protected_worker_rollout_authorized','compatible_worker_live_and_mk99_selected'],requires:['Final release/production Push CI and immutable Production build on SAME SHA','Separate approved Production Worker deployment and immutable rollback pin','Live verification that MK99 is still selected']},
  {id:'explicit_merchant_switch',title:'Independently authorized merchant switch',phase:'switch',
   requirements:['explicit_separate_merchant_switch_approval'],requires:['Separate, fresh authorized real-payment acceptance and merchant-switch permission']}
]);
function safeEvidence(value){
  if(value===undefined || (value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===0)) return {};
  if(!value || typeof value!=='object' || Array.isArray(value) || value.schemaVersion!==1)
    throw new Error('SANITIZED_EVIDENCE_SCHEMA_REQUIRED');
  // Reject top-level free-form content. Do not read, print or persist secret-like values.
  const allowed=new Set(['schemaVersion','note','source','database','runtime','provider','release']);
  for(const k of Object.keys(value)) if(!allowed.has(k))throw new Error('UNEXPECTED_EVIDENCE_SECTION');
  return value;
}
export function buildXiaodouCutoverGateReport(readiness,recovery){
  if(!readiness||!Array.isArray(readiness.phases)||!Array.isArray(readiness.blockers))
    throw new Error('INVALID_READINESS_REPORT');
  const missing=new Set(readiness.blockers.map(x=>x.id));
  const recoveryOk=recovery?.productionD1Touched===false &&
   recovery?.localBackupRestoredAndVerified===true &&
   recovery?.injectedMigrationFailureRolledBack===true &&
   recovery?.deferredOrphanForeignKeyRolledBack===true &&
   recovery?.historicalRowsAndMerchantRoutingUnchanged===true &&
   recovery?.productionReady===false;
  let priorPass=true;
  const phaseStatuses=stages.map(stage=>{
    const isMissing=stage.requirements.filter(id=>missing.has(id));
    if(stage.id==='code_and_recovery'&&!recoveryOk)isMissing.push('synthetic_backup_migration_and_rollback_rehearsal');
    const claimsComplete=isMissing.length===0;
    const status=!priorPass?'WAITING_ON_PREVIOUS_STAGE':
      claimsComplete?'EVIDENCE_REQUIRES_INDEPENDENT_VERIFICATION':'BLOCKED';
    if(!claimsComplete)priorPass=false;
    return {
      id:stage.id,title:stage.title,status,claimsComplete,
      completedChecks:stage.requirements.length-isMissing.filter(id=>stage.requirements.includes(id)).length,
      totalChecks:stage.requirements.length+(stage.id==='code_and_recovery'?1:0),
      missingEvidenceIds:isMissing,requiredIndependentActions:[...stage.requires],
      grantsProductionPermission:false
    };
  });
  const nextStage=phaseStatuses.find(x=>x.missingEvidenceIds.length>0);
  return {
    kind:'Xiaodou Production cutover staging-gate report',
    status:'NO_GO_UNTIL_SEPARATELY_APPROVED_AND_INDEPENDENTLY_VERIFIED',
    evidenceIsOperatorSuppliedNotIndependentlyAuthenticated:true,
    localRecoveryExecuted:recoveryOk,
    localRecoverySyntheticOnly:true,
    productionDatabaseVerifiedByThisRun:false,
    productionDataBackedUpByThisRun:false,
    candidateProductionBuildVerifiedByThisRun:false,
    allowsRemoteSql:false,
    allowsProductionBackup:false,
    allowsMigration0025:false,
    allowsSecretChanges:false,
    allowsWorkerDeployment:false,
    allowsMerchantSwitch:false,
    proposalSha256:readiness.proposalSha256,
    stageCount:phaseStatuses.length,
    stages:phaseStatuses,
    firstMissingStage:nextStage?.id??null,
    blockers:readiness.blockers.map(z=>({phase:z.phase,id:z.id,next:z.next})),
    instructions:[
      'Read-only seven-group Production D1 audit was separately completed; this command does not repeat it.',
      'Phase 2: authorize a guarded Production backup / isolated recovery and later the exact-hash 0025 migration separately.',
      'Phase 3: provision authentic Xiaodou RSA2 secrets only through independently approved Production changes.',
      'Phase 4: release source must have successful exact-SHA Production branch Push CI and independent Production build.',
      'Phase 5: independently authorize and verify real signed Alipay acceptance and merchant switch.',
      'Never alter historical MK99 merchant identities or lose pending/unknown settlements.'
    ]
  };
}
export async function evaluateXiaodouCutoverGate(evidence={}){
  // Even if the operator supplies all true claims, report can NEVER say GO.
  const sanitized=safeEvidence(evidence);
  const readiness=evaluateXiaodouProductionReadiness(sanitized);
  let recovery=null;
  try { recovery=await rehearseXiaodouProductionRecoveryLocally(); }
  catch { recovery={productionD1Touched:false,productionReady:false}; }
  return buildXiaodouCutoverGateReport(readiness,recovery);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    let evidence={};
    if(process.argv.length===4&&process.argv[2]==='--evidence'){
      const text=readFileSync(resolve(process.argv[3]),'utf8');
      if(text.length>65536)throw new Error('EVIDENCE_SIZE');
      evidence=JSON.parse(text);
    }else if(process.argv.length!==2)throw new Error('USAGE');
    const result=await evaluateXiaodouCutoverGate(evidence);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    process.exitCode=2; // NO_GO even if all user-supplied claims are true
  })().catch(()=>{
    process.stderr.write('Production cutover preflight failed closed; no remote action executed.\n');
    process.exitCode=2;
  });
}
