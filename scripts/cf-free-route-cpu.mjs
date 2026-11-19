#!/usr/bin/env node
// Read-only Cloudflare telemetry; never executes SQL, deploys, or prints raw URLs.
import {pathToFileURL} from 'node:url';
const API='https://api.cloudflare.com/client/v4/accounts/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS=['$workers.scriptName','$workers.cpuTimeMs','$workers.event.request.path','$workers.eventType'];

export function routeCategory(path){
  if(typeof path!=='string'||!path.startsWith('/')||path.length>4096)return 'other';
  const p=path.split('?')[0];
  if(p==='/health')return 'health';
  if(p==='/v1/site')return 'public_site';
  if(/^\/v1\/auth\/(?:login|register|verify-registration|request-password-reset|reset-password|csrf|logout)$/.test(p))return 'auth';
  if(p==='/v1/ai/generate')return 'ai_generate';
  if(p.startsWith('/v1/ai/requests/'))return 'ai_request_status';
  if(['/v1/me','/v1/usage','/v1/activity'].includes(p))return 'account_reads';
  for(const [prefix,label] of [
    ['/v1/admin/','admin'],['/v1/orders/','credit_orders'],
    ['/v1/subscriptions/','subscriptions'],['/v1/boltutil/','boltutil'],
    ['/v1/extension/','extension'],['/v1/creator/','creator']
  ])if(p.startsWith(prefix))return label;
  return 'other';
}
export function parseArgs(args){
  const out={minutes:60,script:'reply-copilot-api-production',version:null};
  for(let i=0;i<args.length;i++){
    const name=args[i],value=args[++i];
    if(value===undefined)throw Error('Missing argument');
    if(name==='--minutes')out.minutes=Number(value);
    else if(name==='--script')out.script=value;
    else if(name==='--expected-version')out.version=value;
    else throw Error('Unsupported argument');
  }
  if(!Number.isInteger(out.minutes)||out.minutes<5||out.minutes>1440)throw Error('Invalid minute window');
  if(!/^[A-Za-z0-9_-]{1,96}$/.test(out.script))throw Error('Invalid Worker script');
  if(out.version!==null&&!UUID.test(out.version))throw Error('Invalid Worker version');
  return out;
}
export function cpuQuery({from,to,script,version=null}){
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<=from||to-from>86400000)throw Error('Invalid timeframe');
  if(!/^[A-Za-z0-9_-]{1,96}$/.test(script)||(version&&!UUID.test(version)))throw Error('Invalid target');
  const filters=[
    {key:'$workers.scriptName',operation:'eq',type:'string',value:script},
    {key:'$workers.eventType',operation:'eq',type:'string',value:'fetch'},
    {key:'$workers.cpuTimeMs',operation:'gt',type:'number',value:10}
  ];
  if(version)filters.push({key:'$workers.scriptVersion.id',operation:'eq',type:'string',value:version});
  return {queryId:'xrh-route-cpu-readonly',dry:true,view:'calculations',chartType:'aggregate',ignoreSeries:true,
    timeframe:{from,to},parameters:{
      datasets:[],filterCombination:'and',filters,
      calculations:[
        {operator:'count',alias:'overLimit'},
        {operator:'max',alias:'maxMs',key:'$workers.cpuTimeMs',keyType:'number'},
        {operator:'p95',alias:'p95OverLimitMs',key:'$workers.cpuTimeMs',keyType:'number'}],
      groupBys:[{type:'string',value:'$workers.event.request.path'}],
      orderBy:{value:'maxMs',order:'desc'},limit:1500
    }};
}
function valuesByPath(calculations,alias){
  const item=calculations.find(x=>x.alias===alias);
  if(!item||!Array.isArray(item.aggregates))throw Error('Incomplete Worker telemetry');
  const result=new Map();
  for(const row of item.aggregates){
    const path=row.groups?.find(x=>x.key==='$workers.event.request.path')?.value;
    if(typeof path!=='string'||!Number.isFinite(row.value)||row.value<0)continue;
    result.set(path,{value:row.value,interval:row.sampleInterval});
  }
  return result;
}
export function summarize(cpu){
  if(cpu?.run?.status!=='COMPLETED'||!Array.isArray(cpu.calculations))throw Error('Incomplete Worker telemetry');
  const counts=valuesByPath(cpu.calculations,'overLimit'),
        peaks=valuesByPath(cpu.calculations,'maxMs'),
        p95s=valuesByPath(cpu.calculations,'p95OverLimitMs'),
        byCategory=new Map();
  for(const [raw,record] of counts){
    if(!peaks.has(raw)||!p95s.has(raw))throw Error('Mismatched Worker telemetry');
    const label=routeCategory(raw);
    const row=byCategory.get(label)||{category:label,estimatedAbove10:0,maxMs:0,worstPathP95Above10:0,sampled:false};
    row.estimatedAbove10+=record.value;
    row.maxMs=Math.max(row.maxMs,peaks.get(raw).value);
    row.worstPathP95Above10=Math.max(row.worstPathP95Above10,p95s.get(raw).value);
    row.sampled ||= record.interval>1||peaks.get(raw).interval>1;
    byCategory.set(label,row);
  }
  return {status:counts.size?'HOTSPOTS_OBSERVED':'INSUFFICIENT',
    truncated:counts.size>=1500,groups:[...byCategory.values()].sort((a,b)=>b.maxMs-a.maxMs)};
}
function report(result,{from,to,script}){
  const lines=['# CF Free — observed requests over 10 ms CPU','',
    'Worker: '+script,'UTC: '+new Date(from).toISOString()+' to '+new Date(to).toISOString(),
    'Result: '+result.status,'',
    'Data is sampled and never proves Free eligibility. Only fixed route categories are emitted.',
    'The last column is the highest individual raw-path P95 *among over-limit samples*, NOT category-wide P95.',
    result.truncated?'WARNING: group limit reached; some routes missing.':''];
  if(result.groups.length){
    lines.push('','| Category | Estimated >10 ms requests | Max CPU ms | Worst path P95 of >10ms samples | Sampled |',
      '|---|---:|---:|---:|---|');
    for(const x of result.groups)lines.push('| '+x.category+' | '+Math.round(x.estimatedAbove10)+' | '+x.maxMs.toFixed(3)+' | '+x.worstPathP95Above10.toFixed(3)+' | '+(x.sampled?'yes':'no')+' |');
  }else lines.push('','No invocation CPU/path samples. This does NOT mean zero over-limit requests.');
  return lines.join('\n')+'\n';
}
async function post(url,body,token,fetchImpl){
  const r=await fetchImpl(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Cloudflare telemetry HTTP '+r.status);
  const data=await r.json();
  if(!data?.success||!data.result)throw Error('Cloudflare telemetry unavailable');
  return data.result;
}
export async function run({args=process.argv.slice(2),env=process.env,fetchImpl=fetch,now=Date.now()}={}){
  const x=parseArgs(args);
  if(!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||'')||!env.CLOUDFLARE_API_TOKEN)throw Error('Missing Cloudflare credentials');
  const from=now-x.minutes*60000,to=now,base=API+env.CLOUDFLARE_ACCOUNT_ID+'/workers/observability/telemetry/';
  const entries=await post(base+'keys',{datasets:[],from,to,limit:500},env.CLOUDFLARE_API_TOKEN,fetchImpl);
  const keys=new Set((Array.isArray(entries)?entries:[]).map(z=>typeof z==='string'?z:z.key));
  const required=[...KEYS,...(x.version?['$workers.scriptVersion.id']:[])];
  if(!required.every(k=>keys.has(k))){
    return report({status:'INVOCATION_LOGS_UNAVAILABLE',groups:[],truncated:false},{from,to,script:x.script})+
      '\nBlocker: Worker invocation logs are not available. No config or deployment was changed.\n';
  }
  const data=await post(base+'query',cpuQuery({from,to,script:x.script,version:x.version}),env.CLOUDFLARE_API_TOKEN,fetchImpl);
  return report(summarize(data),{from,to,script:x.script});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  run().then(s=>process.stdout.write(s)).catch(e=>{console.error('Read-only diagnostic failed: '+e.message);process.exitCode=1;});
}
