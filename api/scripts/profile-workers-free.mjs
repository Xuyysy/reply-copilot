import {runtime,PASSWORD} from './lib/free-profile-runtime.mjs';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const out=process.env.FREE_PROFILE_OUT||'/private/tmp/xrh-free-profile';mkdirSync(out,{recursive:true});
const n=Number(process.env.FREE_PROFILE_SAMPLES||10),r=await runtime({history:Number(process.env.FREE_PROFILE_HISTORY||1000),referenceSql:process.env.FREE_PROFILE_REFERENCE_SQL==='1'});
const quantile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)];
const report={kind:'synthetic isolated workerd V8 sampled CPU; NOT production billed CPU',limitations:['workerd tail cpuTime/wallTime are zero locally','100us requested sampling; actual timer cadence varies','async native WebCrypto CPU and scheduling may be unrepresented','wall includes local D1 and stub network waits; no Free certification'],routes:[]};
try{
 const routes=[
  ['wait-calibration',()=>r.request('/__profile/wait')],
  ['session-me',()=>r.request('/v1/me')],
  ['balance-usage',()=>r.request('/v1/usage')],
  ['login-password',()=>r.request('/v1/auth/login',{method:'POST',body:{identity:'profile@example.test',password:PASSWORD}})],
  ['registration-password',()=>r.request('/v1/auth/register',{method:'POST',body:{email:'new-'+randomUUID()+'@example.test',username:'U'+randomUUID().replaceAll('-','').slice(0,12),password:PASSWORD,turnstileToken:'synthetic-challenge'}})],
  ['generate-provider',()=>r.request('/v1/ai/generate',{method:'POST',extension:true,body:{requestId:randomUUID(),post:{text:'A synthetic test post about making small choices.',url:'https://x.com/example/status/123'}}})],
  ['admin-dashboard',()=>r.request('/v1/admin/dashboard')],
  ['packages',()=>r.request('/v1/packages')],
  ['hmac-20',()=>r.request('/__profile/hmac')],
  ['cron-cleanup',()=>r.request('/__profile/cron')],
 ];
 routes.splice(4,0,['login-legacy-210k',()=>r.request('/v1/auth/login',{method:'POST',body:{identity:'profile@example.test',password:PASSWORD}})]);
 let ackId;routes.splice(7,0,['delivery-ack',()=>r.request('/v1/ai/requests/'+ackId+'/delivered',{method:'POST',extension:true,body:{requestId:ackId}})]);
 routes.push(['generate-managed',()=>r.request('/v1/ai/generate',{method:'POST',extension:true,body:{requestId:randomUUID(),post:{text:'A synthetic managed-model test post.',url:'https://x.com/example/status/123'}}})]);
 let payment;routes.push(['order-read',()=>r.request('/v1/orders/'+payment.id)],['payment-first-notify',()=>payment.notify()],['payment-duplicate-notify',()=>payment.notify()]);
 for(const [name,invoke]of routes){
  await r.managed(name==='generate-managed');
  await r.passwordIterations(name==='login-legacy-210k'?210000:100000);
  await r.db.prepare('DELETE FROM rate_limits').run();
  const wall=[],cpu=[],hot=new Map(),statuses={};
  for(let i=0;i<n;i++){
   // Reset synthetic rate counters outside the timed/profiled request.
   await r.db.prepare('DELETE FROM rate_limits').run();
   if(['order-read','payment-first-notify','payment-duplicate-notify'].includes(name)){payment=await r.payment();if(name==='payment-duplicate-notify'){const before=await payment.notify();if(before.status!==200)throw Error('Payment preparation failed: '+before.text)}}
   if(name==='delivery-ack'){ackId=randomUUID();const p=await r.request('/v1/ai/generate',{method:'POST',extension:true,body:{requestId:ackId,post:{text:'A synthetic ACK test post.',url:'https://x.com/example/status/123'}}});if(p.status!==200)throw Error('ACK preparation failed');}
   await r.cdp('Profiler.start');const at=performance.now(),response=await invoke();wall.push(performance.now()-at);const {profile}=await r.cdp('Profiler.stop');
   statuses[response.status]=(statuses[response.status]||0)+1;if(response.status>=400)throw Error(name+' returned '+response.status+': '+response.text.slice(0,100));
   const nodes=new Map(profile.nodes.map(n=>[n.id,n]));let ms=0;
   for(let j=0;j<(profile.samples?.length||0);j++){
    const frame=nodes.get(profile.samples[j])?.callFrame;const label=frame?.functionName||'(anonymous)';const delta=(profile.timeDeltas?.[j]||0)/1000;
    if(label==='(idle)'||label==='(root)')continue;ms+=delta;hot.set(label,(hot.get(label)||0)+delta);
   }cpu.push(ms);
   writeFileSync(path.join(out,name+'-'+i+'.cpuprofile'),JSON.stringify(profile));
  }
  const row={route:name,n,statuses,cold:{wallMs:wall[0],v8SampledActiveMs:cpu[0]},wallMs:{p50:quantile(wall,.5),p95:quantile(wall,.95)},v8SampledActiveMs:{p50:quantile(cpu,.5),p95:quantile(cpu,.95),sum:cpu.reduce((a,b)=>a+b,0)},warmV8SampledActiveMs:{p50:quantile(cpu.slice(1),.5),p95:quantile(cpu.slice(1),.95)},hot:[...hot].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,ms])=>({name,sampledMs:ms}))};report.routes.push(row);console.log(JSON.stringify(row));
 }
 report.syntheticModelCalls=r.modelCalls();writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
}finally{await r.close()}
