import test from 'node:test';
import assert from 'node:assert/strict';
import {DAILY_LIMITS,REQUIRED_SCENARIOS,assessFreeMigrationEvidence} from '../scripts/lib/cf-free-migration-evidence.mjs';
const options={expectedCandidateSha:'a'.repeat(40),expectedVersion:'candidate-version',expectedCloudVersion:'isolated-cloud-version',now:Date.UTC(2026,10,26,2)};
const complete=()=>({candidateSha:options.expectedCandidateSha,candidateVersion:options.expectedVersion,cloudCandidateVersion:options.expectedCloudVersion,source:'ISOLATED_CLOUD_SYNTHETIC_PLUS_ACCOUNT_ANALYTICS',
 isolatedSyntheticOnly:true,unexpectedOutbound:0,productionDataUntouched:true,accountCandidateReleaseAt:'2026-11-22T12:00:00Z',
 scenarios:REQUIRED_SCENARIOS.map(scenario=>({scenario,candidateSha:options.expectedCandidateSha,cloudVersion:options.expectedCloudVersion,source:'CLOUDFLARE_INVOCATION_CPU_MS',allExpectedOutcomes:true,completeCoverage:true,samples:Array(10).fill(3),maxSubrequests:30,maxD1Statements:20})),
 inventory:{complete:true,allDoSQLite:true,workerCount:5,cronCount:2,doClassCount:3,d1DatabaseBytes:[1000],doStoredBytes:0},
 days:['2026-11-23','2026-11-24','2026-11-25'].map(day=>({day,completeAccount:true,candidateVersion:options.expectedVersion,mixedVersions:false,source:'CLOUDFLARE_ACCOUNT_USAGE',truncated:false,
 metrics:{...Object.fromEntries(Object.keys(DAILY_LIMITS).map(k=>[k,100])),maxHttpCpuMs:4,maxCronCpuMs:4,executionErrors:0}})),
 securityReviewComplete:true,paidRollbackRehearsed:true,bindingPlanReviewed:true,planEntitlementsVerified:true});
test('complete evidence still never certifies Free or authorizes deployment',()=>{const r=assessFreeMigrationEvidence(complete(),options);assert.deepEqual(r.blockers,[]);assert.equal(r.evidenceStructurallyComplete,true);assert.equal(r.decision,'NO_GO');assert.equal(r.freeCertified,false);assert.equal(r.deploymentAuthorized,false);});
test('final evidence rejects missing routes, wall-time substitutions, missing samples, quota and storage gaps, mixed versions and unsafe rollback',()=>{
 const cases=[
 [e=>e.scenarios.pop(),'ROUTE_MISSING:payment-replay-synthetic'],
 [e=>e.scenarios[0].cloudVersion='wrong-version','ROUTE_EVIDENCE_INCOMPLETE:login-10000-correct'],
 [e=>e.scenarios[0].source='LOCAL_WALL_TIME','ROUTE_EVIDENCE_INCOMPLETE:login-10000-correct'],
 [e=>e.scenarios[0].samples[0]=9,'ROUTE_CPU_MARGIN_EXCEEDED:login-10000-correct'],
 [e=>e.scenarios[0].maxD1Statements=51,'ROUTE_D1_QUERY_BUDGET_UNVERIFIED_OR_EXCEEDED:login-10000-correct'],
 [e=>delete e.days[0].metrics.doDurationGBSeconds,'DAILY_METRIC_MISSING:doDurationGBSeconds'],
 [e=>e.days[0].metrics.d1RowsWritten=100000,'DAILY_LIMIT_REACHED:d1RowsWritten'],
 [e=>e.days[0].metrics.maxCronCpuMs=10,'DAILY_CPU_LIMIT_REACHED:maxCronCpuMs'],
 [e=>e.days[0].mixedVersions=true,'DAILY_SCOPE_OR_VERSION_UNVERIFIED'],
 [e=>e.days[0].day='2026-11-26','LATEST_THREE_COMPLETE_UTC_DAYS_REQUIRED'],
 [e=>e.accountCandidateReleaseAt='2026-11-23T12:00:00Z','DAILY_SCOPE_OR_VERSION_UNVERIFIED'],
 [e=>e.inventory.d1DatabaseBytes=[500000001],'ACCOUNT_INVENTORY_INCOMPLETE_OR_OVER_LIMIT'],
 [e=>e.inventory.allDoSQLite=false,'ACCOUNT_INVENTORY_INCOMPLETE_OR_OVER_LIMIT'],
 [e=>e.paidRollbackRehearsed=false,'INDEPENDENT_REVIEW_OR_PAID_ROLLBACK_REQUIRED'],
 [e=>e.candidateSha='b'.repeat(40),'CANDIDATE_IDENTITY_MISMATCH']
 ];
 for(const [change,code] of cases){const e=complete();change(e);const r=assessFreeMigrationEvidence(e,options);assert.equal(r.evidenceStructurallyComplete,false,code);assert.ok(r.blockers.includes(code),JSON.stringify(r.blockers));}
 assert.equal(assessFreeMigrationEvidence(null,options).evidenceStructurallyComplete,false);
});
test('high-but-below-limit usage is explicitly flagged as headroom risk',()=>{const e=complete();e.days[0].metrics.d1RowsWritten=89659;const r=assessFreeMigrationEvidence(e,options);assert.ok(r.cautions.includes('DAILY_HEADROOM_BELOW_20_PERCENT:d1RowsWritten'));assert.equal(r.decision,'NO_GO');});
