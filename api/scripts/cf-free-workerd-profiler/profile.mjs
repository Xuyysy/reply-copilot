// V8 inspector protocol; see cloudflare/mcp#342 and workers-sdk Miniflare.getInspectorURL.
// Only local loopback, exact application target. No raw invocation payloads or
// raw debugger frames are exported. Samples represent JS profiling, not billed CPU.
import WebSocket from 'ws';
import assert from 'node:assert/strict';
export async function createProfiler(mf,name){
 const root=await mf.getInspectorURL();
 assert.equal(root.hostname,'127.0.0.1');assert.equal(root.protocol,'ws:');
 const url=new URL(root);url.protocol='http:';url.pathname='/json';
 const r=await fetch(url,{signal:AbortSignal.timeout(5000),redirect:'error'});assert.ok(r.ok);
 const targets=await r.json();
 const matching=targets.filter(t=>typeof t.webSocketDebuggerUrl==='string'&&[t.id,t.title,new URL(t.webSocketDebuggerUrl).pathname.split('/').at(-1)].some(x=>typeof x==='string'&&decodeURIComponent(x)==='core:user:'+name));
 assert.equal(matching.length,1,'EXACT_INSPECTOR_TARGET_REQUIRED');
 const target=new URL(matching[0].webSocketDebuggerUrl);assert.equal(target.protocol,'ws:');assert.ok(['127.0.0.1','localhost'].includes(target.hostname));assert.equal(target.port,root.port);
 const ws=new WebSocket(target,{origin:'https://devtools.devprod.cloudflare.dev'}),pending=new Map();let seq=0;
 const failAll=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('INSPECTOR_CONNECTION_CLOSED'));}pending.clear();};
 ws.on('error',failAll);ws.on('close',failAll);
 ws.on('message',m=>{try{const d=JSON.parse(m.toString()),p=pending.get(d.id);if(!p)return;pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error('INSPECTOR_COMMAND_REJECTED')):p.resolve(d.result);}catch{}});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('INSPECTOR_OPEN_TIMEOUT')),5000);ws.once('open',()=>{clearTimeout(timer);resolve();});ws.once('error',()=>{clearTimeout(timer);reject(Error('INSPECTOR_OPEN_FAILED'));});});
 }catch(e){ws.terminate();throw e;}
 const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('INSPECTOR_COMMAND_TIMEOUT'));},10000);
  pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
 });
 try{await send('Profiler.enable');}catch(e){ws.terminate();throw e;}
 return {start:()=>send('Profiler.start'),stop:async()=>{const r=await send('Profiler.stop');assert.ok(r?.profile?.nodes);return r.profile;},close:()=>ws.terminate()};
}
export function mergeProfiles(profiles){
 const totals=new Map();let sampleCount=0,activeSamples=0,idleSamples=0,unknownSamples=0;
 for(const p of profiles){
  const nodes=new Map((p.nodes||[]).map(n=>[n.id,n.callFrame]));
  for(const id of p.samples||[]){
   sampleCount++;const f=nodes.get(id);if(!f){unknownSamples++;continue;}
   const name=f.functionName||'(anonymous)';
   if(['(idle)','(program)','(root)'].includes(name)){idleSamples++;continue;}
   activeSamples++;
   const safe=/^[A-Za-z0-9_$ .<>()#\[\]\/:-]{1,160}$/.test(name)?name:'(other)';
   const line=Number.isSafeInteger(f.lineNumber)&&f.lineNumber>=0?f.lineNumber+1:null;
   // Do not expose URL paths or arbitrary frame metadata.
   const key=safe+'@'+line,old=totals.get(key)||{functionName:safe,bundleLine:line,samples:0};
   old.samples++;totals.set(key,old);
  }
 }
 return {profiles:profiles.length,sampleCount,activeSamples,idleSamples,unknownSamples,hotspots:[...totals.values()].sort((a,b)=>b.samples-a.samples).slice(0,20)};
}
