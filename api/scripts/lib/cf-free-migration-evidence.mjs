// Offline evidence validator. No Cloudflare or other network calls. Never authorizes downgrade.
import {isDeepStrictEqual} from 'node:util';
export const DAILY_LIMITS=Object.freeze({workerRequests:100000,d1RowsRead:5000000,d1RowsWritten:100000,
  doRequests:100000,doDurationGBSeconds:13000,doRowsRead:5000000,doRowsWritten:100000});
export const REQUIRED_SCENARIOS=Object.freeze([
  ...[10000,60000,100000,210000].flatMap(n=>['login-'+n+'-correct','login-'+n+'-wrong']),
  'register','verify-registration','reset-request','reset-password','admin-reauth','admin-password-change',
  'me','bootstrap','usage','entitlements','admin-read','admin-write','cron',
  ...['free','paid','subscription'].flatMap(x=>['generate-'+x,'replay-'+x,'ack-'+x]),
  'invalid-model-output','payment-create-synthetic','payment-webhook-synthetic','payment-replay-synthetic'
]);
const validSha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const num=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const integer=x=>num(x)&&Number.isSafeInteger(x);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(Date.parse(x+'T00:00:00Z')).toISOString().slice(0,10)===x;
const dayMs=86400000;
const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
export function assessFreeMigrationEvidence(evidence,{expectedCandidateSha,expectedVersion,now=Date.now()}={}){
  const blockers=[],cautions=[];
  const fail=x=>{if(!blockers.includes(x))blockers.push(x)};
  const caution=x=>{if(!cautions.includes(x))cautions.push(x)};
  if(!validSha(expectedCandidateSha)||evidence?.candidateSha!==expectedCandidateSha||typeof expectedVersion!=='string'||!expectedVersion||evidence?.candidateVersion!==expectedVersion)fail('CANDIDATE_IDENTITY_MISMATCH');
  if(evidence?.source!=='ISOLATED_CLOUD_SYNTHETIC_PLUS_ACCOUNT_ANALYTICS')fail('CLOUD_EVIDENCE_SOURCE_REQUIRED');
  if(evidence?.isolatedSyntheticOnly!==true||evidence?.unexpectedOutbound!==0||evidence?.productionDataUntouched!==true)fail('ISOLATION_NOT_ATTESTED');
  const routes=Array.isArray(evidence?.scenarios)?evidence.scenarios:[];
  const seen=new Set();
  for(const s of routes){
    const id=s?.scenario;
    if(!REQUIRED_SCENARIOS.includes(id)||seen.has(id)){fail('UNKNOWN_OR_DUPLICATE_SCENARIO');continue;}seen.add(id);
    // The engineering margin is intentional. Per-invocation CF CPU, not wall duration.
    if(s?.source!=='CLOUDFLARE_INVOCATION_CPU_MS'||s?.allExpectedOutcomes!==true||s?.completeCoverage!==true||
       !Array.isArray(s?.samples)||s.samples.length<10||s.samples.length>10000||s.samples.some(x=>!num(x)))fail('ROUTE_EVIDENCE_INCOMPLETE:'+id);
    else if(Math.max(...s.samples)>8||p95(s.samples)>5)fail('ROUTE_CPU_MARGIN_EXCEEDED:'+id);
    if(!integer(s?.maxSubrequests)||s.maxSubrequests>50)fail('ROUTE_SUBREQUEST_BUDGET_UNVERIFIED_OR_EXCEEDED:'+id);
    if(!integer(s?.maxD1Statements)||s.maxD1Statements>50)fail('ROUTE_D1_QUERY_BUDGET_UNVERIFIED_OR_EXCEEDED:'+id);
  }
  for(const id of REQUIRED_SCENARIOS)if(!seen.has(id))fail('ROUTE_MISSING:'+id);
  const inv=evidence?.inventory;
  if(inv?.complete!==true||inv?.allDoSQLite!==true||!integer(inv?.workerCount)||inv.workerCount>100||
     !integer(inv?.cronCount)||inv.cronCount>5||!integer(inv?.doClassCount)||inv.doClassCount>100||
     !Array.isArray(inv?.d1DatabaseBytes)||inv.d1DatabaseBytes.length===0||inv.d1DatabaseBytes.length>10||
     inv.d1DatabaseBytes.some(x=>!integer(x)||x>500000000)||inv.d1DatabaseBytes.reduce((a,b)=>a+b,0)>5000000000||
     !integer(inv?.doStoredBytes)||inv.doStoredBytes>5000000000)fail('ACCOUNT_INVENTORY_INCOMPLETE_OR_OVER_LIMIT');
  const days=Array.isArray(evidence?.days)?evidence.days:[];
  const latest=Math.floor(now/dayMs)*dayMs;
  const dateSet=new Set();
  const deployed=Date.parse(evidence?.accountCandidateReleaseAt);
  if(!Number.isFinite(deployed)||deployed>=latest)fail('ACCOUNT_POST_RELEASE_WINDOW_UNVERIFIED');
  if(days.length!==3)fail('THREE_COMPLETE_UTC_DAYS_REQUIRED');
  for(const d of days){
    if(!date(d?.day)||dateSet.has(d.day)){fail('INVALID_OR_DUPLICATE_UTC_DAY');continue;}
    dateSet.add(d.day);
    const start=Date.parse(d.day+'T00:00:00Z');
    if(start>=latest||start<deployed||d.completeAccount!==true||d.candidateVersion!==expectedVersion||
       d.mixedVersions!==false||d.source!=='CLOUDFLARE_ACCOUNT_USAGE'||d.truncated!==false)fail('DAILY_SCOPE_OR_VERSION_UNVERIFIED');
    for(const [key,limit] of Object.entries(DAILY_LIMITS)){
      const val=d.metrics?.[key];if(!num(val)||(key!=='doDurationGBSeconds'&&!integer(val)))fail('DAILY_METRIC_MISSING:'+key);
      else if(val>=limit)fail('DAILY_LIMIT_REACHED:'+key);
      else if(val>limit*.8)caution('DAILY_HEADROOM_BELOW_20_PERCENT:'+key);
    }
    for(const key of ['maxHttpCpuMs','maxCronCpuMs']){
      if(!num(d.metrics?.[key]))fail('DAILY_CPU_SAMPLE_MISSING:'+key);
      else if(d.metrics[key]>=10)fail('DAILY_CPU_LIMIT_REACHED:'+key);
    }
    if(!integer(d.metrics?.executionErrors)||d.metrics.executionErrors!==0)fail('DAILY_EXECUTION_ERRORS_OR_UNKNOWN');
  }
  if(!isDeepStrictEqual([...dateSet].sort(),[3,2,1].map(n=>new Date(latest-n*dayMs).toISOString().slice(0,10))))fail('LATEST_THREE_COMPLETE_UTC_DAYS_REQUIRED');
  if(evidence?.securityReviewComplete!==true||evidence?.paidRollbackRehearsed!==true||evidence?.bindingPlanReviewed!==true||evidence?.planEntitlementsVerified!==true)fail('INDEPENDENT_REVIEW_OR_PAID_ROLLBACK_REQUIRED');
  return {decision:'NO_GO',freeCertified:false,deploymentAuthorized:false,
    evidenceStructurallyComplete:blockers.length===0,cautions,blockers,
    note:'Attested evidence only, never an authorization; independent verification and operator approval required. DO duration is billed wall time, not CPU.'};
}
