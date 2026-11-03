import {runtime} from './lib/free-profile-runtime.mjs';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const report=[];
for(const history of [1000,20000]){
 const r=await runtime({history});try{
  await r.managed(true);const samples=[];
  const dashboardCold=await r.request('/v1/admin/dashboard',{meter:true}),dashboardWarm=await r.request('/v1/admin/dashboard',{meter:true});
  if(dashboardCold.status!==200||dashboardWarm.status!==200)throw Error('Dashboard failed');
  if(dashboardWarm.metrics.rowsRead>=dashboardCold.metrics.rowsRead)throw Error('Meter must preserve real cache binding identity');
  for(let i=0;i<5;i++){
   const id=randomUUID(),generate=await r.request('/v1/ai/generate',{method:'POST',extension:true,meter:true,body:{requestId:id,post:{text:'A synthetic capacity post.',url:'https://x.com/example/status/123'}}});
   const ack=await r.request('/v1/ai/requests/'+id+'/delivered',{method:'POST',extension:true,meter:true,body:{requestId:id}}),duplicate=await r.request('/v1/ai/requests/'+id+'/delivered',{method:'POST',extension:true,meter:true,body:{requestId:id}});
   if([generate,ack,duplicate].some(x=>x.status!==200))throw Error('Synthetic generation flow failed');
   if(duplicate.metrics.rowsWritten!==0)throw Error('Duplicate ACK wrote rows');
   samples.push({generate:generate.metrics,ack:ack.metrics,duplicate:duplicate.metrics});
  }
  const balance=await r.db.prepare("SELECT free_balance,free_generation_reserved FROM credit_accounts WHERE user_id='profile-user'").first();
  if(balance.free_balance!==99995||balance.free_generation_reserved!==0)throw Error('Single debit invariant failed');
  report.push({history,dashboardCold:dashboardCold.metrics,dashboardWarm:dashboardWarm.metrics,samples});
 }finally{await r.close()}
}
writeFileSync(process.env.FREE_WORKLOAD_REPORT||'/private/tmp/xrh-free-workload.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
