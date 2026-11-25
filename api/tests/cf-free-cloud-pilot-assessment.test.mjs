import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPilot} from '../scripts/cf-free-cloud-pilot-assessment.mjs';
const sha='a'.repeat(40);
function report(){
 const cases=[];
 for(const mode of ['http','do'])for(const rounds of [10000,60000,100000,210000])for(const wrong of [false,true]){
  const control=mode==='http'&&rounds===210000;
  cases.push({mode,rounds,wrong,repeat:1,httpStatus:control?503:200,behavior:control?'FAILED_OR_RESOURCE_LIMIT':'SYNTHETIC_BEHAVIOR_OK',diagnostic:control?{stage:'HTTP_VERIFY',failure:'KDF_RUNTIME_LIMIT'}:null});
 }
 return {kind:'ISOLATED_FREE_HTTP_DO_PILOT',sourceCommit:sha,productionUntouched:true,uploaded:true,cleanup:{workerAbsent:true,doNamespaceAbsent:true},errors:[],tailErrors:[],
 smoke:{execution:'REMOTE_CLOUD',target:'SYNTHETIC_ONLY_TARGET_CONFIRMED',syntheticRequests:16,cases},
 liveTail:{status:'CPU_FIELDS_OBSERVED_NOT_CERTIFIED',groups:[{mode:'http',rounds:100000,events:2,cpuSamples:2,maxCpuMs:15,p95CpuMs:15},{mode:'do',rounds:210000,events:1,cpuSamples:1,maxCpuMs:0,p95CpuMs:0},{mode:'do_rpc',rounds:210000,events:2,cpuSamples:2,maxCpuMs:217,p95CpuMs:217}]}};
}
test('native 210k negative control is distinct from candidate DO behavior; missing samples remain missing',()=>{
 const a=assessPilot(report(),sha);
 assert.equal(a.candidateBehavior,'SYNTHETIC_DO_BEHAVIOR_PASS');
 assert.equal(a.decision,'NO_GO');assert.equal(a.freeCertified,false);
 assert.deepEqual(a.directOver10,[{rounds:100000,maxCpuMs:15}]);
 assert.equal(a.coverage.find(r=>r.mode==='do_rpc'&&r.rounds===10000).maxCpuMs,null);
 assert.ok(a.uncertainties.includes('PASSWORD_CPU_SAMPLE_COVERAGE_INCOMPLETE'));
});
test('rejects duplicate cases, mismatched source, missing cleanup and high offload CPU',()=>{
 const r=report();r.smoke.cases[0]=r.smoke.cases[1];r.cleanup.workerAbsent=false;
 r.liveTail.groups[1].maxCpuMs=9;r.liveTail.groups[1].p95CpuMs=9;
 const a=assessPilot(r,'b'.repeat(40));
 for(const code of ['SOURCE_OR_REPORT_MISMATCH','ISOLATION_OR_CLEANUP_UNCONFIRMED','MATRIX_CASE_INVALID','HTTP_OFFLOAD_ENGINEERING_BUDGET_EXCEEDED'])assert.ok(a.blockers.includes(code));
 assert.equal(a.decision,'NO_GO');
});
