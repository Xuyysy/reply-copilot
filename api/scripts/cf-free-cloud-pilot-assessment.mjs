// Assess a version-pinned, sanitized pilot report. This is NOT a plan switch gate.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const factors=[10000,60000,100000,210000];
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const validSha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
export function assessPilot(report,expectedCommit){
  const blockers=[],uncertainties=[],controls=[],coverage=[];
  const fail=code=>{if(!blockers.includes(code))blockers.push(code);};
  const gap=code=>{if(!uncertainties.includes(code))uncertainties.push(code);};
  if(!validSha(expectedCommit)||report?.sourceCommit!==expectedCommit||report?.kind!=='ISOLATED_FREE_HTTP_DO_PILOT')fail('SOURCE_OR_REPORT_MISMATCH');
  if(report?.productionUntouched!==true||report?.uploaded!==true||report?.cleanup?.workerAbsent!==true||report?.cleanup?.doNamespaceAbsent!==true)fail('ISOLATION_OR_CLEANUP_UNCONFIRMED');
  if(!Array.isArray(report?.errors)||report.errors.length||!Array.isArray(report?.tailErrors)||report.tailErrors.length)fail('RUNNER_OR_TAIL_ERRORS');
  const smoke=report?.smoke;
  const cases=Array.isArray(smoke?.cases)?smoke.cases:[];
  const repeats=cases.length/16;
  if(![1,2].includes(repeats)||smoke?.syntheticRequests!==cases.length||smoke?.execution!=='REMOTE_CLOUD'||smoke?.target!=='SYNTHETIC_ONLY_TARGET_CONFIRMED')fail('MATRIX_IDENTITY_OR_SIZE_INVALID');
  const keys=new Set();
  for(const c of cases){
    const key=[c?.mode,c?.rounds,c?.wrong,c?.repeat].join(':');
    if(keys.has(key)||!['http','do'].includes(c?.mode)||!factors.includes(c?.rounds)||typeof c?.wrong!=='boolean'||!Number.isInteger(c?.repeat)||c.repeat<1||c.repeat>repeats)fail('MATRIX_CASE_INVALID');
    keys.add(key);
  }
  for(const mode of ['http','do'])for(const rounds of factors){
    const group=cases.filter(c=>c.mode===mode&&c.rounds===rounds);
    const pass=group.filter(c=>c.behavior==='SYNTHETIC_BEHAVIOR_OK'&&c.httpStatus===200).length;
    const expectedControl=mode==='http'&&rounds===210000;
    if(group.length!==2*repeats)fail('MATRIX_COVERAGE_INCOMPLETE');
    if(expectedControl){
      const kdfLimit=group.filter(c=>c.httpStatus===503&&c.diagnostic?.stage==='HTTP_VERIFY'&&c.diagnostic?.failure==='KDF_RUNTIME_LIMIT').length;
      if(kdfLimit!==group.length||!group.length)fail('NATIVE_210K_CONTROL_UNEXPECTED');
      controls.push({mode,rounds,expectedKdfLimit:kdfLimit,total:group.length});
    }else if(pass!==group.length||!group.length)fail('CANDIDATE_BEHAVIOR_FAILURE');
    else controls.push({mode,rounds,passed:pass,total:group.length});
  }
  const rows=Array.isArray(report?.liveTail?.groups)?report.liveTail.groups:[];
  const seen=new Set();
  for(const r of rows){
    const key=r?.mode+':'+r?.rounds;
    if(seen.has(key)||!['http','do','do_rpc'].includes(r?.mode)||!factors.includes(r?.rounds)||!Number.isInteger(r?.events)||!Number.isInteger(r?.cpuSamples)||r.events<1||r.cpuSamples<0||r.cpuSamples>r.events||(r.cpuSamples>0&&(!finite(r.maxCpuMs)||!finite(r.p95CpuMs)||r.p95CpuMs>r.maxCpuMs)))fail('TAIL_GROUP_INVALID');
    seen.add(key);
  }
  for(const mode of ['do','do_rpc'])for(const rounds of factors){
    const r=rows.find(x=>x.mode===mode&&x.rounds===rounds);
    const samples=r?.cpuSamples??0,expected=2*repeats;
    if(samples<expected)gap('PASSWORD_CPU_SAMPLE_COVERAGE_INCOMPLETE');
    if(samples>expected)fail('UNEXPECTED_CPU_SAMPLE_COUNT');
    if(mode==='do'&&finite(r?.maxCpuMs)&&(r.maxCpuMs>8||r.p95CpuMs>5))fail('HTTP_OFFLOAD_ENGINEERING_BUDGET_EXCEEDED');
    coverage.push({mode,rounds,samples,expected,maxCpuMs:samples&&finite(r?.maxCpuMs)?r.maxCpuMs:null,p95CpuMs:samples&&finite(r?.p95CpuMs)?r.p95CpuMs:null});
  }
  const directOver10=rows.filter(r=>r.mode==='http'&&finite(r.maxCpuMs)&&r.maxCpuMs>10).map(r=>({rounds:r.rounds,maxCpuMs:r.maxCpuMs}));
  if(report?.liveTail?.status!=='CPU_FIELDS_OBSERVED_NOT_CERTIFIED')gap('LIVE_TAIL_CPU_FIELDS_UNAVAILABLE');
  gap('ACCOUNT_PLAN_REQUIRES_INDEPENDENT_VERIFICATION');
  gap('COMPLETE_BUSINESS_ROUTE_CLOUD_CPU_UNMEASURED');
  gap('PRODUCTION_DAILY_D1_AND_DO_QUOTAS_UNVERIFIED');
  gap('PRODUCTION_ROLLOUT_AND_ROLLBACK_NOT_AUTHORIZED');
  return {kind:'OFFLINE_PILOT_ASSESSMENT',sourceCommit:validSha(expectedCommit)?expectedCommit:null,decision:'NO_GO',freeCertified:false,
    candidateBehavior:blockers.some(x=>/MATRIX|BEHAVIOR|CONTROL|SOURCE|ISOLATION|RUNNER/.test(x))?'FAIL_OR_INCOMPLETE':'SYNTHETIC_DO_BEHAVIOR_PASS',
    controls,coverage,directOver10,blockers,uncertainties,
    caveat:'Local report assessment only; aggregate Tail markers are not unique per-case joins or proof of plan eligibility. Missing samples are never zero CPU. Native 210k is an expected negative control, not a candidate DO failure.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [path,commit]=process.argv.slice(2);
    if(!path||!validSha(commit))throw Error('INVALID_ARGUMENTS');
    const raw=readFileSync(path,'utf8');
    if(raw.length>1048576)throw Error('REPORT_TOO_LARGE');
    console.log(JSON.stringify(assessPilot(JSON.parse(raw),commit),null,2));
  }catch{console.error('Pilot assessment unavailable; NO_GO');}
  process.exitCode=2;
}
