#!/usr/bin/env node
// Isolated read-only Cloudflare GraphQL evidence; intentionally NEVER GO.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const API='https://api.cloudflare.com/client/v4/graphql';
const ACCOUNT_HASH='e23dffc780a86b492af765c3e615f5d2f037c2e1e3223e027b396d102e77fcd6';
const WORKER='xrh-cf-free-cpu-pilot-20261120';
const ID=/^[a-f0-9]{32}$/i;
export const validAccount=id=>typeof id==='string'&&ID.test(id)&&
  createHash('sha256').update(id.toLowerCase()).digest('hex')===ACCOUNT_HASH;
export function validWindow(from,to){
  if(typeof from!=='string'||typeof to!=='string'||!from.endsWith('Z')||!to.endsWith('Z'))return false;
  const a=Date.parse(from),b=Date.parse(to);
  return Number.isFinite(a)&&Number.isFinite(b)&&
    new Date(a).toISOString()===from&&new Date(b).toISOString()===to&&
    a<b&&b-a<=15*60*1000&&from.slice(0,10)===to.slice(0,10);
}
export function queries({accountId,namespaceId,from,to}){
  if(!validAccount(accountId)||!ID.test(namespaceId||'')||!validWindow(from,to))
    throw Error('INVALID_ISOLATED_CPU_TARGET_OR_WINDOW');
  const tag=accountId.toLowerCase(),day=from.slice(0,10);
  return {
    worker:'query {viewer{accounts(filter:{accountTag:"'+tag+'"}){'+
      'workersInvocationsAdaptive(limit:1000,filter:{scriptName:"'+WORKER+
      '",datetime_geq:"'+from+'",datetime_leq:"'+to+'"}){'+
      'dimensions{scriptName status} sum{requests errors} quantiles{cpuTimeP50 cpuTimeP99}}}}}',
    durable:'query {viewer{accounts(filter:{accountTag:"'+tag+'"}){'+
      'durableObjectsInvocationsAdaptiveGroups(limit:1000,filter:{date_geq:"'+day+
      '",date_leq:"'+day+'"}){dimensions{namespaceId} sum{requests}}'+
      'durableObjectsPeriodicGroups(limit:1000,filter:{date_geq:"'+day+
      '",date_leq:"'+day+'"}){dimensions{namespaceId} sum{cpuTime}}}}}'
  };
}
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
function rows(result,field){
  const accounts=result?.data?.viewer?.accounts;
  if(result?.errors?.length||!Array.isArray(accounts)||accounts.length!==1)throw Error('ANALYTICS_ACCOUNT_SCOPE_INVALID');
  const rs=accounts[0]?.[field];
  if(!Array.isArray(rs)||rs.length>=1000)throw Error('ANALYTICS_MISSING_OR_TRUNCATED');
  return rs;
}
export function summarize({worker,durable,namespaceId}){
  if(!ID.test(namespaceId||''))throw Error('EXPECTED_DO_NAMESPACE_REQUIRED');
  const out={kind:'XRH_CLOUDFLARE_CPU_EVIDENCE',status:'INSUFFICIENT',
    http:{observedRequests:0,observedErrors:0,highestGroupP50Raw:null,highestGroupP99Raw:null},
    durable:{observedRequests:0,aggregateCpuTimeRaw:null},
    cpuUnits:'RAW_GRAPHQL_VALUES_NOT_NORMALIZED',
    perInvocationDoCpu:false,freeCertified:false,safeToDowngradeProduction:false,
    caveat:'HTTP grouped sampled CPU quantiles and DO periodic CPU sums are not matched per-request CPU measurements. DO data includes same-day samples, not just the test window.'};
  for(const r of rows(worker,'workersInvocationsAdaptive')){
    if(r?.dimensions?.scriptName!==WORKER||!positive(r.sum?.requests)||!positive(r.sum?.errors)||
      !positive(r.quantiles?.cpuTimeP50)||!positive(r.quantiles?.cpuTimeP99))
      throw Error('INVALID_HTTP_ANALYTICS');
    out.http.observedRequests+=r.sum.requests;
    out.http.observedErrors+=r.sum.errors;
    out.http.highestGroupP50Raw=Math.max(out.http.highestGroupP50Raw??0,r.quantiles.cpuTimeP50);
    out.http.highestGroupP99Raw=Math.max(out.http.highestGroupP99Raw??0,r.quantiles.cpuTimeP99);
  }
  for(const r of rows(durable,'durableObjectsInvocationsAdaptiveGroups')){
    if(!ID.test(r?.dimensions?.namespaceId||'')||!positive(r.sum?.requests))
      throw Error('INVALID_DO_INVOCATION_ANALYTICS');
    if(r.dimensions.namespaceId.toLowerCase()===namespaceId.toLowerCase())
      out.durable.observedRequests+=r.sum.requests;
  }
  let observedCpu=false,aggregate=0;
  for(const r of rows(durable,'durableObjectsPeriodicGroups')){
    if(!ID.test(r?.dimensions?.namespaceId||'')||!positive(r.sum?.cpuTime))
      throw Error('INVALID_DO_CPU_ANALYTICS');
    if(r.dimensions.namespaceId.toLowerCase()===namespaceId.toLowerCase()){
      aggregate+=r.sum.cpuTime;observedCpu=true;
    }
  }
  if(observedCpu)out.durable.aggregateCpuTimeRaw=aggregate;
  if(out.http.observedRequests>0&&out.durable.observedRequests>0&&observedCpu)
    out.status='BOTH_COMPONENTS_OBSERVED_NOT_CERTIFIED';
  return out;
}
export async function collectCpuEvidence({accountId,namespaceId,from,to,token,fetchImpl=fetch}){
  const q=queries({accountId,namespaceId,from,to});
  if(typeof token!=='string'||token.length<20||token.length>1024)throw Error('ANALYTICS_TOKEN_UNAVAILABLE');
  const post=async(query)=>{
    let r;
    try{r=await fetchImpl(API,{method:'POST',redirect:'error',
      headers:{Authorization:'Bearer '+token,Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});
    }catch{throw Error('ANALYTICS_NETWORK_UNAVAILABLE');}
    if(!r.ok)throw Error('ANALYTICS_HTTP_UNAVAILABLE');
    let parsed;
    try{parsed=await r.json();}catch{throw Error('ANALYTICS_RESPONSE_INVALID');}
    if(!parsed?.data||parsed.errors?.length)throw Error('ANALYTICS_DATA_UNAVAILABLE');
    return parsed;
  };
  return summarize({worker:await post(q.worker),durable:await post(q.durable),namespaceId});
}
export function parseCpuArgs(args,env={}){
  const o={readOnly:false,accountId:null,namespaceId:null,from:null,to:null,token:env.CF_FREE_PILOT_API_TOKEN};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--read-only'){o.readOnly=true;continue;}
    if(args[i]==='--expected-account-id'){o.accountId=args[++i];continue;}
    if(args[i]==='--expected-namespace-id'){o.namespaceId=args[++i];continue;}
    if(args[i]==='--from'){o.from=args[++i];continue;}
    if(args[i]==='--to'){o.to=args[++i];continue;}
    throw Error('INVALID_ANALYTICS_OPTION');
  }
  if(!o.readOnly||!validAccount(o.accountId)||!ID.test(o.namespaceId||'')||
    !validWindow(o.from,o.to)||typeof o.token!=='string'||o.token.length<20)
    throw Error('EXPLICIT_READ_ONLY_EVIDENCE_REQUIRED');
  return o;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let x;try{x=parseCpuArgs(process.argv.slice(2),process.env);}
  catch{console.error('No calls: pinned Free account, namespace ID and read-only UTC window required.');process.exitCode=2;}
  if(x)collectCpuEvidence(x).then(r=>{
    process.stdout.write(JSON.stringify(r,null,2)+'\n');
    if(r.status!=='BOTH_COMPONENTS_OBSERVED_NOT_CERTIFIED')process.exitCode=2;
  }).catch(()=>{console.error('Read-only Free CPU analytics unavailable; never certified.');process.exitCode=2;});
}
