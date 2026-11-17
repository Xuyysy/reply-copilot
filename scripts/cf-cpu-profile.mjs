#!/usr/bin/env node
// On-demand Cloudflare Worker CPU profile. No app requests, D1 SQL, config writes or deploys.
import {gunzipSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const MAX_BYTES=8_000_000;
const INTERNAL=/^\((?:idle|root|garbage collector|unknown|runtime)\)$/i;
function varint(b,i){
 let n=0n,shift=0n;
 for(let p=i;p<b.length&&p<i+10;p++){
  const c=BigInt(b[p]);n|=(c&127n)<<shift;
  if(!(c&128n))return [n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):n,p+1];
  shift+=7n;
 }
 throw Error('Malformed pprof varint');
}
function fields(b){
 const out=[];for(let i=0;i<b.length;){
  const [k,p]=varint(b,i);i=p;const t=Number(k)>>3,w=Number(k)&7;
  if(!t)throw Error('Invalid pprof tag');
  if(w===0){const[n,j]=varint(b,i);out.push({t,n});i=j;}
  else if(w===2){const[n,j]=varint(b,i);if(n>MAX_BYTES||j+n>b.length)throw Error('Invalid pprof field length');out.push({t,data:b.subarray(j,j+n)});i=j+n;}
  else if(w===1||w===5){i+=w===1?8:4;if(i>b.length)throw Error('Truncated pprof field');}
  else throw Error('Unsupported pprof wire type');
 }return out;
}
function first(fs,t){return fs.find(x=>x.t===t)?.n??0;}
function values(fs){
 const out=[];for(const f of fs){
  if(f.n!==undefined)out.push(f.n);
  else if(f.data)for(let i=0;i<f.data.length;){const[n,j]=varint(f.data,i);out.push(n);i=j;}
 }return out;
}
function clean(s){return String(s).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,140);}
export function analyzeProfile(input,{worker='reply-copilot-api-production',version=''}={}){
 const b=input instanceof Uint8Array?input:new Uint8Array(input);
 if(!b.length||b.byteLength>MAX_BYTES)throw Error('Invalid profile size');
 const raw=b[0]===31&&b[1]===139?gunzipSync(b,{maxOutputLength:MAX_BYTES}):b;
 if(!raw.length||raw.length>MAX_BYTES)throw Error('Invalid decoded profile');
 const f=fields(raw),strings=f.filter(x=>x.t===6&&x.data).map(x=>new TextDecoder('utf-8',{fatal:true}).decode(x.data));
 const str=n=>strings[n]||'(unknown)';
 const types=f.filter(x=>x.t===1&&x.data).map(x=>{const q=fields(x.data);return [str(first(q,1)),str(first(q,2))];});
 const cpu=types.findIndex(x=>x[0]==='cpu'&&x[1]==='nanoseconds');
 if(cpu<0)throw Error('Missing CPU nanoseconds metric');
 const names=new Map(f.filter(x=>x.t===5&&x.data).map(x=>{const q=fields(x.data);return[first(q,1),clean(str(first(q,2)))];}));
 const locations=new Map(f.filter(x=>x.t===4&&x.data).map(x=>{
  const q=fields(x.data),line=q.find(v=>v.t===4&&v.data);
  return[first(q,1),names.get(line?first(fields(line.data),1):0)||'(runtime)'];
 }));
 const self=new Map(),incl=new Map();let total=0,app=0,count=0,appCount=0;
 for(const item of f.filter(x=>x.t===2&&x.data)){
  const q=fields(item.data),ls=values(q.filter(x=>x.t===1)),vs=values(q.filter(x=>x.t===2)),n=vs[cpu];
  if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid CPU sample');
  count++;total+=n;
  const leaf=locations.get(ls[0])||'(unknown)';
  self.set(leaf,(self.get(leaf)||0)+n);
  if(!INTERNAL.test(leaf)){appCount++;app+=n;}
  for(const frame of new Set(ls.map(id=>locations.get(id)||'(unknown)')))incl.set(frame,(incl.get(frame)||0)+n);
 }
 const round=n=>Number(n.toFixed(3));
 const top=map=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([name,ns])=>({name,cpuMs:round(ns/1e6),percent:total?Number((100*ns/total).toFixed(2)):0}));
 return {status:appCount>=5&&app>=5e6?'SAMPLED_APP_CPU':'INSUFFICIENT_APP_SAMPLES',worker,version,
  sampleCount:count,applicationSamples:appCount,sampledCpuMs:round(total/1e6),applicationCpuMs:round(app/1e6),
  topSelf:top(self),topInclusive:top(incl),
  notes:['Captures one recently loaded isolate; not a route-specific or full-day CPU report.',
   'Insufficient application frames must not be attributed to specific routes or functions.',
   'Sampled function names may be minified. Compare with GitHub source and synthetic tests before any optimization.'],
  certifiedForFree:false};
}
export function parseArgs(argv){
 const p={worker:'reply-copilot-api-production',version:'',seconds:20,json:'cf-cpu-profile-summary.json',markdown:'cf-cpu-profile-summary.md'};
 for(let i=0;i<argv.length;i++){
  const a=argv[i],v=argv[++i];if(!a?.startsWith('--')||v===undefined)throw Error('Missing option value');
  if(a==='--worker')p.worker=v;else if(a==='--version')p.version=v;else if(a==='--seconds')p.seconds=Number(v);
  else if(a==='--json')p.json=v;else if(a==='--markdown')p.markdown=v;else throw Error('Unknown option');
 }
 if(!/^[A-Za-z0-9_-]{1,96}$/.test(p.worker))throw Error('Invalid Worker name');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.version))throw Error('Exact Worker version UUID required');
 if(![10,20,40,50].includes(p.seconds))throw Error('Profile duration must be 10/20/40/50 seconds');
 return p;
}
export async function capture({accountId,token,worker,version,seconds,fetchImpl=fetch}){
 if(!/^[0-9a-f]{32}$/i.test(accountId||'')||!token)throw Error('Missing/invalid Cloudflare credentials');
 const url='https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/workers/'+worker+'/versions/'+version+'/profile';
 const r=await fetchImpl(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({duration_ms:seconds*1000,profile_type:'cpu'}),signal:AbortSignal.timeout((seconds+15)*1000)});
 if(!r.ok)throw Error('Profile API HTTP '+r.status+'; no business traffic was generated');
 const b=new Uint8Array(await r.arrayBuffer());
 if(!b.length||b.byteLength>MAX_BYTES)throw Error('Invalid profile binary size');
 return b;
}
export function markdownReport(p){
 return ['# Cloudflare Worker CPU capture (diagnostic, never Free approval)','',
  'Worker: '+p.worker+'; exact version: '+p.version,
  'Status: **'+p.status+'**. Samples: '+p.sampleCount+'; app samples: '+p.applicationSamples+
  '; sampled CPU: '+p.sampledCpuMs+'ms; app self CPU: '+p.applicationCpuMs+'ms.','',
  '| Function (self) | Sampled CPU ms | Share |','|---|---:|---:|',
  ...p.topSelf.map(x=>'| '+x.name.replace(/\|/g,'\\|')+' | '+x.cpuMs+' | '+x.percent+'% |'),'',
  ...p.notes.map(x=>'- '+x),'','**certifiedForFree: false.**',''].join('\n');
}
export async function main({argv=process.argv.slice(2),env=process.env,fetchImpl=fetch}={}){
 const p=parseArgs(argv);
 const bytes=await capture({accountId:env.CLOUDFLARE_ACCOUNT_ID,token:env.CLOUDFLARE_API_TOKEN,
  worker:p.worker,version:p.version,seconds:p.seconds,fetchImpl});
 const result=analyzeProfile(bytes,p);
 // Raw binary profile may carry labels/source paths; save sanitized summaries only.
 writeFileSync(resolve(p.json),JSON.stringify(result,null,2)+'\n');
 writeFileSync(resolve(p.markdown),markdownReport(result));
 console.log('CPU profile: '+result.status+'; '+result.applicationSamples+' app samples');
 return result;
}
if(process.argv[1]&&resolve(fileURLToPath(import.meta.url))===resolve(process.argv[1]))
 main().catch(e=>{console.error(e.message);process.exitCode=1;});
