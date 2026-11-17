#!/usr/bin/env node
// Read-only Cloudflare Analytics. No Production D1 SQL, no deployment, no mutation.
// Outputs a decision-support report; analytics samples are NOT billing proof.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const LIMITS = Object.freeze({requests:100_000,rowsRead:5_000_000,rowsWritten:100_000,cpuMicros:10_000});
const DEFAULT_SCRIPT='reply-copilot-api-production';
const DEFAULT_DB='d9df7d23-9b9c-44ac-a33a-c24474c15691';
const DAY_MS=86_400_000;
const positiveInt=value=>Number.isInteger(Number(value))&&Number(value)>0?Number(value):null;
const safeNumber=value=>Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;

export function completeUtcDay(daysAgo=1,now=Date.now()){
 if(!Number.isInteger(daysAgo)||daysAgo<1||daysAgo>14)throw Error('daysAgo must be 1 through 14; partial UTC days are forbidden');
 return new Date(Math.floor(now/DAY_MS)*DAY_MS-daysAgo*DAY_MS).toISOString().slice(0,10);
}
export function analyticsQuery(accountId,day){
 if(!/^[a-f0-9]{32}$/i.test(accountId))throw Error('Invalid account ID');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z')))throw Error('Invalid UTC day');
 // Include all account Workers and ALL D1 databases, not only Production.
 // If either dataset reaches its limit, we refuse to certify completeness.
 return 'query { viewer { accounts(filter:{accountTag:'+JSON.stringify(accountId)+'}) { '+
  'workers:workersInvocationsAdaptive(limit:5000,filter:{date:'+JSON.stringify(day)+'}) {'+
    'dimensions{date scriptName scriptVersion eventType status} sum{requests errors} '+
    'quantiles{cpuTimeP50 cpuTimeP95 cpuTimeP99} max{cpuTime} } '+
  'd1:d1AnalyticsAdaptiveGroups(limit:2000,filter:{date:'+JSON.stringify(day)+'}) {'+
    'dimensions{date databaseId} sum{rowsRead rowsWritten readQueries writeQueries} } '+
  '} } }';
}
export function evaluateDay(data,{day,script=DEFAULT_SCRIPT,database=DEFAULT_DB,expectedVersion=null,releaseAt=null}={}){
 if(!Array.isArray(data?.workers)||!Array.isArray(data?.d1))throw Error('Missing account-wide Worker/D1 Analytics datasets');
 const workers=data.workers,d1=data.d1;
 const sum=(rows,path)=>rows.reduce((n,row)=>{const v=safeNumber(path(row));if(v===null)throw Error('Invalid aggregate metric from Cloudflare');return n+v;},0);
 const totalRequests=sum(workers,x=>x.sum?.requests);
 const allErrors=sum(workers,x=>x.sum?.errors);
 const read=sum(d1,x=>x.sum?.rowsRead),written=sum(d1,x=>x.sum?.rowsWritten);
 const prodWorkers=workers.filter(x=>x.dimensions?.scriptName===script);
 const prodRows=d1.filter(x=>x.dimensions?.databaseId===database);
 const prodRequests=sum(prodWorkers,x=>x.sum?.requests);
 const prodReads=sum(prodRows,x=>x.sum?.rowsRead);
 const prodErrors=sum(prodWorkers,x=>x.sum?.errors);
 const maxCpuMicros=Math.max(0,...workers.map(x=>safeNumber(x.max?.cpuTime)??0));
 const prodCpuMicros=Math.max(0,...prodWorkers.map(x=>safeNumber(x.max?.cpuTime)??0));
 const versions=[...new Set(prodWorkers.map(x=>x.dimensions?.scriptVersion).filter(Boolean))].sort();
 const causes=[];
 if(read>=LIMITS.rowsRead)causes.push('account D1 reads exceed 5,000,000/day');
 if(written>=LIMITS.rowsWritten)causes.push('account D1 writes exceed 100,000/day');
 if(totalRequests>=LIMITS.requests)causes.push('account Worker requests exceed 100,000/day');
 if(maxCpuMicros>=LIMITS.cpuMicros)causes.push('sampled invocation exceeded 10ms CPU');
 if(prodErrors>0||allErrors>0)causes.push('Worker execution errors observed');
 const uncertainties=[];
 if(workers.length===0||d1.length===0||prodRequests===0)uncertainties.push('missing or insufficient Worker/D1 samples');
 if(workers.length>=5000||d1.length>=2000)uncertainties.push('analytics query hit dataset row limit');
 if(expectedVersion&&!versions.includes(expectedVersion))uncertainties.push('expected Worker version not observed');
 if(releaseAt){
  const t=Date.parse(releaseAt);
  if(!Number.isFinite(t))throw Error('Invalid release timestamp');
  if(Date.parse(day+'T00:00:00Z')<t)uncertainties.push('not a complete UTC day after target release');
 }
 if(read>3_000_000)uncertainties.push('D1 read headroom target of 3M/day not met');
 if(maxCpuMicros===0)uncertainties.push('CPU maximum unavailable');
 // Never output automatic GO; aggregated adaptive data cannot prove strict CPU
 // behavior for unsampled routes, storage capacity, or account entitlements.
 const verdict=causes.length?'NO_GO':uncertainties.length?'INSUFFICIENT':'REVIEW_REQUIRED';
 return {day,verdict,limits:LIMITS,metrics:{
  account:{requests:totalRequests,errors:allErrors,d1RowsRead:read,d1RowsWritten:written,maxCpuMs:maxCpuMicros/1000},
  production:{requests:prodRequests,errors:prodErrors,d1RowsRead:prodReads,maxCpuMs:prodCpuMicros/1000,versions}
 },causes,uncertainties,certifiedForFree:false,sampledMetricsOnly:true};
}
export async function loadDay({accountId,token,day,fetchImpl=fetch}){
 const res=await fetchImpl('https://api.cloudflare.com/client/v4/graphql',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({query:analyticsQuery(accountId,day)}),
  signal:AbortSignal.timeout(15_000)
 });
 if(!res.ok)throw Error('Cloudflare GraphQL request failed: HTTP '+res.status);
 const payload=await res.json();
 if(payload.errors?.length||!payload.data?.viewer?.accounts?.length)throw Error('Cloudflare GraphQL dataset access failed');
 const account=payload.data.viewer.accounts[0];
 if(!account||!Array.isArray(account.workers)||!Array.isArray(account.d1))throw Error('Cloudflare GraphQL returned incomplete analytics');
 return account;
}
export function markdownReport(results){
 const fmt=n=>Number(n||0).toLocaleString('en-US');
 const lines=['# CF Free read-only readiness — complete UTC days','',
  '> This is an advisory blocker gate, never an authorization to downgrade. Cloudflare adaptive analytics may be sampled; confirm storage, database count, entitlements, and essential per-route CPU separately.',
  '',
  '| UTC day | Decision | Account D1 reads | D1 writes | Worker requests | Max CPU (sampled) |',
  '|---|---|---:|---:|---:|---:|'];
 for(const r of results)lines.push('| '+r.day+' | '+r.verdict+' | '+fmt(r.metrics.account.d1RowsRead)+' | '+fmt(r.metrics.account.d1RowsWritten)+' | '+fmt(r.metrics.account.requests)+' | '+r.metrics.account.maxCpuMs.toFixed(3)+'ms |');
 for(const r of results){
  lines.push('','## '+r.day+' — '+r.verdict,'','Production Worker versions: '+(r.metrics.production.versions.join(', ')||'none observed'));
  for(const cause of r.causes)lines.push('- **BLOCKER:** '+cause);
  for(const concern of r.uncertainties)lines.push('- Unverified: '+concern);
 }
 lines.push('','**Decision: DO NOT switch to Free automatically.**','',
  'All totals are account-wide where appropriate; the Production D1 figure alone may omit Staging/other database usage.',
  'Sources: Cloudflare GraphQL Analytics (read-only) and published Workers/D1 pricing limits.');
 return lines.join('\n')+'\n';
}
export function parseArgs(args){
 const parsed={days:3,script:DEFAULT_SCRIPT,database:DEFAULT_DB,expectedVersion:null,releaseAt:null,output:'cf-free-readiness.md',json:'cf-free-readiness.json'};
 for(let i=0;i<args.length;i++){
  const arg=args[i],value=args[++i];
  if(!arg?.startsWith('--')||value===undefined)throw Error('Missing option value: '+arg);
  if(arg==='--days')parsed.days=positiveInt(value);
  else if(arg==='--script')parsed.script=value;
  else if(arg==='--database')parsed.database=value;
  else if(arg==='--expected-version')parsed.expectedVersion=value;
  else if(arg==='--release-at')parsed.releaseAt=value;
  else if(arg==='--output')parsed.output=value;
  else if(arg==='--json')parsed.json=value;
  else throw Error('Unsupported option: '+arg);
 }
 if(!parsed.days||parsed.days>7)throw Error('Choose 1-7 complete UTC days');
 if(!/^[A-Za-z0-9_-]{1,96}$/.test(parsed.script))throw Error('Invalid script');
 if(!/^[0-9a-f-]{36}$/i.test(parsed.database))throw Error('Invalid database ID');
 if(parsed.expectedVersion&&!/^[0-9a-f-]{36}$/i.test(parsed.expectedVersion))throw Error('Invalid expected Worker version');
 if(parsed.releaseAt&&!Number.isFinite(Date.parse(parsed.releaseAt)))throw Error('Invalid release timestamp');
 return parsed;
}
export async function main({env=process.env,args=process.argv.slice(2),fetchImpl=fetch,now=Date.now()}={}){
 const config=parseArgs(args),accountId=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
 if(!accountId||!token)throw Error('Missing Cloudflare account/token; report cannot be generated');
 const results=[];
 for(let i=1;i<=config.days;i++){
  const day=completeUtcDay(i,now);
  const raw=await loadDay({accountId,token,day,fetchImpl});
  results.push(evaluateDay(raw,{day,script:config.script,database:config.database,expectedVersion:config.expectedVersion,releaseAt:config.releaseAt}));
 }
 const markdown=markdownReport(results);
 writeFileSync(resolve(config.output),markdown);
 writeFileSync(resolve(config.json),JSON.stringify({generatedAt:new Date(now).toISOString(),results},null,2)+'\n');
 console.log('CF Free readiness report written (no D1 SQL, no config changes)');
 console.log(results.map(x=>x.day+' '+x.verdict+' '+x.causes.join('; ')).join('\n'));
 return results;
}
if(process.argv[1]&&resolve(fileURLToPath(import.meta.url))===resolve(process.argv[1])){
 main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
