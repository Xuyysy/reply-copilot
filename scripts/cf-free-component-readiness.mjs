#!/usr/bin/env node
// Offline, aggregate-only CF Free component readiness gate.
// Never fetches data, executes SQL, deploys, mutates settings or returns GO.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const FREE_LIMITS=Object.freeze({
  httpCpuMs:10,
  workerRequestsPerUtcDay:100000,
  d1RowsReadPerUtcDay:5000000,
  d1RowsWrittenPerUtcDay:100000,
  doRpcRequestsPerUtcDay:100000,
  doDurationGbSecondsPerUtcDay:13000,
  doDefaultCpuMsDocumented:30000,
  doSqliteStorageBytesPerAccount:5000000000
});

const numberOrNull=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
const isVersion=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
const utcDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  new Date(x+'T00:00:00.000Z').toISOString().slice(0,10)===x;
const missing=(list,code)=>{if(!list.includes(code))list.push(code);};
const blocked=(list,code)=>{if(!list.includes(code))list.push(code);};

function auditAccount(report,now,expectedVersion,blockers,uncertainties){
  if(!report||!Array.isArray(report.results)||report.results.length===0||report.results.length>7){
    missing(uncertainties,'ACCOUNT_ANALYTICS_UNAVAILABLE');return {status:'MISSING'};
  }
  const today=new Date(now).toISOString().slice(0,10);
  const seen=new Set(),summaries=[];
  for(const day of report.results){
    if(!utcDay(day?.day)||day.day>=today||seen.has(day.day)||
       !['NO_GO','INSUFFICIENT','REVIEW_REQUIRED'].includes(day?.verdict)||
       day?.certifiedForFree!==false || !day?.sampledMetricsOnly){
      missing(uncertainties,'ACCOUNT_ANALYTICS_INVALID');return {status:'INVALID'};
    }
    seen.add(day.day);
    const a=day.metrics?.account,p=day.metrics?.production;
    const vals=[a?.requests,a?.errors,a?.d1RowsRead,a?.d1RowsWritten,a?.maxCpuMs,
      p?.requests,p?.errors,p?.maxCpuMs];
    if(vals.some(x=>numberOrNull(x)===null) || !Array.isArray(p?.versions) ||
       p.versions.some(x=>!isVersion(x)) || !Array.isArray(day.causes) || !Array.isArray(day.uncertainties)){
      missing(uncertainties,'ACCOUNT_ANALYTICS_INVALID');return {status:'INVALID'};
    }
    summaries.push({day:day.day,requests:a.requests,errors:a.errors,d1RowsRead:a.d1RowsRead,
      d1RowsWritten:a.d1RowsWritten,observedAccountMaxCpuMs:a.maxCpuMs,
      observedProductionMaxCpuMs:p.maxCpuMs,versions:p.versions});
    if(a.requests>=FREE_LIMITS.workerRequestsPerUtcDay)blocked(blockers,'WORKER_DAILY_REQUEST_QUOTA');
    if(a.d1RowsRead>=FREE_LIMITS.d1RowsReadPerUtcDay)blocked(blockers,'D1_DAILY_READ_QUOTA');
    if(a.d1RowsWritten>=FREE_LIMITS.d1RowsWrittenPerUtcDay)blocked(blockers,'D1_DAILY_WRITE_QUOTA');
    if(a.errors>0||p.errors>0)blocked(blockers,'WORKER_ERRORS_OBSERVED');
    if(a.maxCpuMs>=FREE_LIMITS.httpCpuMs)blocked(blockers,'HTTP_CPU_OVER_10MS_OBSERVED');
    if(day.verdict==='NO_GO')blocked(blockers,'EXISTING_ACCOUNT_READINESS_NO_GO');
    if(day.verdict==='INSUFFICIENT'||day.uncertainties.length>0)missing(uncertainties,'ACCOUNT_ADAPTIVE_SAMPLING_INCOMPLETE');
    if(a.maxCpuMs===0||p.maxCpuMs===0)missing(uncertainties,'CPU_MAXIMUM_MISSING');
    if(expectedVersion&&!p.versions.includes(expectedVersion))missing(uncertainties,'EXPECTED_VERSION_NOT_OBSERVED');
  }
  if(!expectedVersion)missing(uncertainties,'EXPECTED_VERSION_REQUIRED');
  missing(uncertainties,'ACCOUNT_DATA_IS_ADAPTIVELY_SAMPLED');
  return {status:'READ_ONLY_AGGREGATES',days:summaries};
}

function inspectPasswordProof(proof,uncertainties){
  const direct=proof?.comparisons?.find(x=>x?.mode==='http_local');
  const offload=proof?.comparisons?.find(x=>x?.mode==='do_rpc');
  if(proof?.status!=='SYNTHETIC_LOCAL_ONLY'||proof?.freeCertified!==false||
     proof?.productionCertified!==false||!direct||!offload){
    missing(uncertainties,'ISOLATED_PASSWORD_DO_PROOF_MISSING');
    return {status:'MISSING'};
  }
  const cases=[];
  for(const factor of [10000,100000,210000]){
    const d=direct.cases?.find(x=>x?.factor===factor);
    const o=offload.cases?.find(x=>x?.factor===factor);
    if(!d||!o||d.httpCpu?.status!=='SAMPLED'||
       o.verifierCpu?.status!=='SAMPLED'||!Array.isArray(d.httpCpu.topFunctions)||
       !Array.isArray(o.verifierCpu.topFunctions)){
      missing(uncertainties,'ISOLATED_PASSWORD_DO_PROOF_INCOMPLETE');
      return {status:'INCOMPLETE'};
    }
    const legacyDerive=d.httpCpu.topFunctions.some(x=>x?.name==='deriveBits'&&x.samples>0);
    const doDerive=o.verifierCpu.topFunctions.some(x=>x?.name==='deriveBits'&&x.samples>0);
    // Refuse to infer 0ms CPU from an empty HTTP profile or an absent DO sample.
    const httpSamples=o.httpCpu?.sampleCount;
    if(!legacyDerive||!doDerive||!Number.isInteger(httpSamples)||httpSamples<1){
      missing(uncertainties,'ISOLATED_PASSWORD_DO_PROOF_INCOMPLETE');
      return {status:'INCOMPLETE'};
    }
    cases.push({factor,baselineDeriveObserved:true,doDeriveObserved:true,
      httpSampleCount:httpSamples,doSampleCount:o.verifierCpu.sampleCount});
  }
  if(direct.wrongPasswordDenied!==true||offload.wrongPasswordDenied!==true||
     direct.storedFactorUnchanged!==true||offload.storedFactorUnchanged!==true||
     direct.externalCalls!==0||offload.externalCalls!==0){
    missing(uncertainties,'PASSWORD_DO_SECURITY_ASSERTIONS_MISSING');
    return {status:'INCOMPLETE'};
  }
  missing(uncertainties,'LOCAL_V8_PROFILES_ARE_NOT_CLOUD_CPU_METRICS');
  return {status:'LAB_ONLY_OFFLOAD_OBSERVED',cases};
}

function auditDoQuotas(report,uncertainties,blockers){
  if(!report){missing(uncertainties,'DO_FREE_DAILY_USAGE_NOT_MEASURED');return {status:'MISSING'};}
  const props=['rpcRequests','durationGbSeconds','sqliteStoredBytes'];
  if(!props.every(k=>numberOrNull(report[k])!==null) ||
     !utcDay(report.day) || report.cloudflareReadOnlyAggregate!==true){
    missing(uncertainties,'DO_DAILY_USAGE_INVALID');return {status:'INVALID'};
  }
  if(report.rpcRequests>=FREE_LIMITS.doRpcRequestsPerUtcDay)blocked(blockers,'DO_RPC_DAILY_QUOTA');
  if(report.durationGbSeconds>=FREE_LIMITS.doDurationGbSecondsPerUtcDay)blocked(blockers,'DO_DURATION_DAILY_QUOTA');
  if(report.sqliteStoredBytes>=FREE_LIMITS.doSqliteStorageBytesPerAccount)blocked(blockers,'DO_STORAGE_QUOTA');
  // Operator-supplied aggregates are not authenticated just because the JSON
  // claims to be Cloudflare data; this tool cannot certify their provenance.
  missing(uncertainties,'DO_USAGE_PROVENANCE_REQUIRES_INDEPENDENT_VERIFICATION');
  return {status:'UNVERIFIED_EXTERNAL_AGGREGATES',day:report.day,
    rpcRequests:report.rpcRequests,durationGbSeconds:report.durationGbSeconds,
    sqliteStoredBytes:report.sqliteStoredBytes};
}

export function evaluateComponentReadiness({
  analytics=null,passwordProof=null,doUsage=null,expectedVersion=null
}={},now=Date.now()){
  if(!Number.isFinite(now)||now<0)throw Error('Invalid audit time');
  const blockers=[],uncertainties=[];
  if(expectedVersion!==null&&!isVersion(expectedVersion)){
    missing(uncertainties,'EXPECTED_VERSION_INVALID');expectedVersion=null;
  }
  const account=auditAccount(analytics,now,expectedVersion,blockers,uncertainties);
  const password=inspectPasswordProof(passwordProof,uncertainties);
  const durableObjects=auditDoQuotas(doUsage,uncertainties,blockers);
  // These cannot be proven by local profiles or adaptive account analytics.
  missing(uncertainties,'HTTP_ROUTE_LEVEL_CPU_NOT_VERIFIED_ON_FREE');
  missing(uncertainties,'DO_REAL_INVOCATION_CPU_NOT_VERIFIED_ON_FREE');
  missing(uncertainties,'DO_CPU_LIMIT_PLAN_APPLICABILITY_NEEDS_CONFIRMATION');
  missing(uncertainties,'DO_NAMESPACE_BINDING_AND_PEPPER_ROLLOUT_NOT_VERIFIED');
  missing(uncertainties,'PRODUCTION_ROLLBACK_NOT_APPROVED');
  return {
    decision:'NO_GO',
    safeToDowngrade:false,
    automaticPlanChangeAuthorized:false,
    verifiedCloudFree:false,
    advisoryOnly:true,
    limits:FREE_LIMITS,
    evidence:{account,password,durableObjects},
    blockers,uncertainties,
    nextAction:'Collect representative version-pinned Cloudflare HTTP route CPU and a genuine Free-compatible isolated DO validation with a separate approved rollback. Remain Paid until independently reviewed.',
    interpretation:'The 30s default Durable Object CPU limit is separately documented, but plan applicability still requires verification. Locally sampled V8 profiles and dispatch wall time never certify either cloud CPU limit.'
  };
}

function boundedJson(path){
  const s=readFileSync(resolve(path),'utf8');
  if(s.length>1048576)throw Error('Aggregate evidence file too large');
  return JSON.parse(s);
}
export function parseArgs(args){
  const out={analytics:null,passwordProof:null,doUsage:null,expectedVersion:null};
  const fields={'--analytics':'analytics','--local-do-proof':'passwordProof',
    '--do-usage':'doUsage','--expected-version':'expectedVersion'};
  for(let i=0;i<args.length;i+=2){
    if(!Object.hasOwn(fields,args[i])||!args[i+1])throw Error('Unknown or missing option');
    const key=fields[args[i]];
    if(out[key]!==null)throw Error('Duplicate option');
    out[key]=args[i+1];
  }
  if(out.expectedVersion&&!isVersion(out.expectedVersion))throw Error('Invalid Worker version');
  return out;
}
export function main(args=process.argv.slice(2)){
  const o=parseArgs(args);
  const result=evaluateComponentReadiness({
    analytics:o.analytics?boundedJson(o.analytics):null,
    passwordProof:o.passwordProof?boundedJson(o.passwordProof):null,
    doUsage:o.doUsage?boundedJson(o.doUsage):null,
    expectedVersion:o.expectedVersion
  });
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  process.exitCode=2; // This tool intentionally never emits a GO exit.
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{main();}catch{console.error('Invalid or unavailable aggregate evidence; Free remains NO_GO.');process.exitCode=2;}
}
