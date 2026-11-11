import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateXiaodouProductionReadiness } from '../scripts/xiaodou-production-readiness.mjs';

const candidate = 'a'.repeat(40);
const workerId = '11111111-2222-3333-4444-555555555555';
const rsa2SecretNames = [
 'XIAODOU_BASE_URL','XIAODOU_APP_ID','XIAODOU_KEY_ID',
 'XIAODOU_PRIVATE_KEY','XIAODOU_PLATFORM_PUBLIC_KEYS'
];
const binding = (name,type='secret_text') => ({ name,type });
function completeClaims(sqlSha) {
 return {
  schemaVersion:1,
  source:{ candidateSha:candidate },
  database:{
    readOnlyAuditApproved:true, schema0024Matches:true, backupApproved:true,
    backupRestoreTested:true, migration0025Approved:true,
    migration0025AppliedVerified:true, appliedSqlSha256:sqlSha,
    legacyMk99Preserved:true, foreignKeysVerified:true
  },
  runtime:{
    workerBindings:[
     ...rsa2SecretNames.map(x=>binding(x)),
     binding('XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED','plain_text'),
     binding('XIAODOU_WEBHOOKS_ENABLED','plain_text')
    ],
    networkMode:'allowlist_disabled', networkModeConfirmed:true
  },
  provider:{
    signedQueryVerified:true,signedWebhookVerified:true,
    alipayMerchantReleased:true,subscriptionSettlementVerified:true,
    creditSettlementVerified:true,legacyMk99SettlementVerified:true
  },
  release:{
    fullPushCiSha:candidate,fullPushCiPassed:true,
    productionBuildSha:candidate,productionBuildPassed:true,
    productionArtifactChecksumVerified:true,
    protectedEnvironmentApproved:true,compatibleWorkerDeployApproved:true,
    rollbackWorkerDeploymentId:workerId,
    liveWorkerSourceSha:candidate,mk99StillActiveVerified:true,
    merchantSwitchApproved:true,signedProductionAcceptanceApproved:true
  }
 };
}
function finding(out,id) {return out.blockers.find(x=>x.id===id);}
function phase(out,name){return out.phases.find(x=>x.name===name);}

test('single-command readiness starts NO-GO without SQL, remote calls, or evidence',()=>{
 const out=evaluateXiaodouProductionReadiness();
 assert.equal(phase(out,'code').claimsComplete,true,'existing local SQLite migration rehearsal and production config remain valid');
 assert.equal(out.status,'NO_GO');
 assert.ok(finding(out,'read_only_audit_approved_and_completed'));
 assert.ok(finding(out,'five_rsa2_secret_bindings_present'));
 assert.equal(out.productionReady,false);
 assert.equal(out.permitsRemoteD1,false);
 assert.equal(out.permitsDeployment,false);
 assert.equal(out.permitsMerchantSwitch,false);
 assert.match(out.proposalSha256,/^[0-9a-f]{64}$/);
});

test('explicit allowlist-disabled mode is valid evidence only with matching confirmation flag',()=>{
 const hash=evaluateXiaodouProductionReadiness().proposalSha256;
 const data=completeClaims(hash);
 const res=evaluateXiaodouProductionReadiness(data);
 assert.equal(res.blockers.length,0,JSON.stringify(res.blockers));
 assert.equal(res.status,'EVIDENCE_CLAIMS_COMPLETE_REQUIRES_INDEPENDENT_APPROVAL');
 assert.equal(res.productionReady,false,'manual statements can never enable Production payments');
 assert.equal(res.permitsDeployment,false);
 assert.equal(res.permitsMerchantSwitch,false);
 data.runtime.networkModeConfirmed=false;
 assert.ok(finding(evaluateXiaodouProductionReadiness(data),'network_mode_explicitly_confirmed'));
 data.runtime.networkModeConfirmed=true;
 data.runtime.workerBindings=data.runtime.workerBindings.filter(x=>x.name!=='XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED');
 assert.ok(finding(evaluateXiaodouProductionReadiness(data),'network_mode_explicitly_confirmed'));
});

test('legacy static-egress confirmation mode remains recognized',()=>{
 const hash=evaluateXiaodouProductionReadiness().proposalSha256;
 const data=completeClaims(hash);
 data.runtime.networkMode='verified_egress';
 data.runtime.workerBindings=data.runtime.workerBindings.filter(x=>x.name!=='XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED');
 data.runtime.workerBindings.push(binding('XIAODOU_SOURCE_IP_CONFIRMED','plain_text'));
 assert.equal(finding(evaluateXiaodouProductionReadiness(data),'network_mode_explicitly_confirmed'),undefined);
});

test('wrong secret binding types and unchecked signed Webhooks remain blocking',()=>{
 const hash=evaluateXiaodouProductionReadiness().proposalSha256;
 const data=completeClaims(hash);
 data.runtime.workerBindings=data.runtime.workerBindings.map(x=>x.name==='XIAODOU_PRIVATE_KEY'?binding(x.name,'plain_text'):x);
 data.provider.signedWebhookVerified=false;
 const out=evaluateXiaodouProductionReadiness(data);
 assert.ok(finding(out,'five_rsa2_secret_bindings_present'));
 assert.ok(finding(out,'signed_query_webhook_and_alipay_acceptance'));
 assert.equal(out.productionReady,false);
});

test('proposal SQL hash drift, missing Production migration or backup proof blocks',()=>{
 const hash=evaluateXiaodouProductionReadiness().proposalSha256;
 const data=completeClaims(hash);
 data.database.appliedSqlSha256='0'.repeat(64);
 let out=evaluateXiaodouProductionReadiness(data);
 assert.ok(finding(out,'0025_explicit_approval_and_verified_application'));
 data.database.appliedSqlSha256=hash;
 data.database.backupRestoreTested=false;
 out=evaluateXiaodouProductionReadiness(data);
 assert.ok(finding(out,'verified_backup_and_restore'));
});

test('mismatched CI source, unapproved deploy and unswitched MK99 remain blocking',()=>{
 const hash=evaluateXiaodouProductionReadiness().proposalSha256;
 const data=completeClaims(hash);
 data.release.fullPushCiSha='b'.repeat(40);
 data.release.compatibleWorkerDeployApproved=false;
 data.release.mk99StillActiveVerified=false;
 const out=evaluateXiaodouProductionReadiness(data);
 assert.ok(finding(out,'exact_source_and_build_ci'));
 assert.ok(finding(out,'protected_worker_rollout_authorized'));
 assert.ok(finding(out,'compatible_worker_live_and_mk99_selected'));
});

test('unapproved merchant switch remains independently blocked even with all other claims',()=>{
 const hash=evaluateXiaodouProductionReadiness().proposalSha256;
 const data=completeClaims(hash);
 data.release.merchantSwitchApproved=false;
 const out=evaluateXiaodouProductionReadiness(data);
 assert.ok(finding(out,'explicit_separate_merchant_switch_approval'));
 assert.equal(phase(out,'database').claimsComplete,true);
 assert.equal(phase(out,'merchant').claimsComplete,true);
 assert.equal(out.status,'NO_GO');
});

test('readiness implementation has no network clients, remote D1, secret access or deployment',()=>{
 const src=readFileSync(new URL('../scripts/xiaodou-production-readiness.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bfetch\s*\(|\bchild_process\b|api\.cloudflare\.com|wrangler d1/);
 assert.match(src,/permitsRemoteD1: false/);
 assert.match(src,/permitsMerchantSwitch: false/);
 const claims=completeClaims('f'.repeat(64));
 claims.runtime.workerBindings.push({name:'UNTRUSTED_SECRET',type:'secret_text',value:'must never be echoed'});
 const out=JSON.stringify(evaluateXiaodouProductionReadiness(claims));
 assert.doesNotMatch(out,/must never be echoed|UNTRUSTED_SECRET/);
});


test('sanitized evidence example stays NO-GO and contains no credential values',()=>{
 const data=JSON.parse(readFileSync(new URL('../docs/payments/xiaodou-production-readiness.example.json',import.meta.url),'utf8'));
 assert.equal(data.schemaVersion,1);
 assert.equal(data.runtime.networkMode,'allowlist_disabled');
 assert.equal(data.runtime.networkModeConfirmed,false);
 assert.equal(data.runtime.workerBindings.some(x=>x.name==='XIAODOU_PRIVATE_KEY'),false);
 assert.equal(evaluateXiaodouProductionReadiness(data).status,'NO_GO');
});

test('network mode and actual flag must correspond; one mode cannot inherit another mode flag',()=>{
 const hash=evaluateXiaodouProductionReadiness().proposalSha256;
 const data=completeClaims(hash);
 data.runtime.networkMode='verified_egress';
 assert.ok(finding(evaluateXiaodouProductionReadiness(data),'network_mode_explicitly_confirmed'));
 data.runtime.networkMode='allowlist_disabled';
 data.runtime.workerBindings=data.runtime.workerBindings.filter(x=>x.name!=='XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED');
 data.runtime.workerBindings.push(binding('XIAODOU_SOURCE_IP_CONFIRMED','plain_text'));
 assert.ok(finding(evaluateXiaodouProductionReadiness(data),'network_mode_explicitly_confirmed'));
});
