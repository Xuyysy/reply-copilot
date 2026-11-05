// Synthetic real-schema D1 comparison. No external requests, secrets or balances.
import {fixture,temp} from '../api/tests/helpers/payment-v2.mjs';import {randomUUID,createHash} from 'node:crypto';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {writeFileSync} from 'node:fs';import path from 'node:path';import {executeAiGeneration} from '../api/src/ai-generation-flow.js';
const require=createRequire(new URL('../api/package.json',import.meta.url));require('esbuild').buildSync({entryPoints:[new URL('../api/src/quota.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',outfile:temp+'/benchmark-quota.cjs'});const q=require(temp+'/benchmark-quota.cjs');
const raw=JSON.stringify({recommendation:'reply',defaultStyle:'natural',language:'en',replies:{natural:'One detail.',light_humor:'A small joke.',thoughtful:'A different perspective.'},reason:'Relevant.',quoteCandidate:null});
const roots={baseline:process.env.PR16_BENCHMARK_BASELINE||'/private/tmp/reply-copilot-pr16-before-fast',candidate:new URL('..',import.meta.url).pathname},report={parameters:{trialsPerVersion:8,firstProvider:'permanently unresolved',localStorage:'4 kept and 4 lost',backend:'isolated actual D1 schema, same current backend for both clients; same candidate backend; not a backend speed comparison',realModelCalls:0},versions:{}};
for(const [version,root]of Object.entries(roots)){
 const {DeliveryCoordinator}=await import(pathToFileURL(path.join(root,'services/delivery-coordinator.js'))),{HostedAIClient}=await import(pathToFileURL(path.join(root,'services/hosted-ai-client.js')));let passed=0;const errors=[];
 for(let i=0;i<8;i++){
  const f=fixture(),data={},token='e'.repeat(64),paths=[];let calls=0;const first=randomUUID(),headers={Cookie:'',Origin:f.env.EXTENSION_ORIGIN,Authorization:`Bearer ${token}`};
  f.sql.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES('benchmark',?,'test-user','extension',1,?)").run(createHash('sha256').update(token).digest('hex'),Date.now()+600000);
  const request=async(p,options={})=>{paths.push(p);if(p==='/v1/ai/generate'){const id=options.body.requestId;const r=await executeAiGeneration({reserve:()=>q.reserveGeneration(f.env,{user_id:'test-user'},id,id,100),provider:async()=>{calls++;return id===first?new Promise(()=>{}):{raw,usage:{model:'synthetic',inputTokens:2,outputTokens:3,costMicroUsd:5}};},validate:()=>{},finish:(raw,u)=>q.finishGeneration(f.env,'test-user',id,raw,u)});return{raw:r.raw};}const r=await f.call(p,{method:options.method||'GET',headers,body:options.body});if(r.status>=400)throw Object.assign(Error(r.body.message),{code:r.body.code});return r.body;};
  const settings={storage:{get:async()=>structuredClone(data),set:async v=>Object.assign(data,structuredClone(v))},getAccountId:async()=> 'test-user',waitTimeoutMs:20,createClient:()=>new HostedAIClient({config:{hostedApiUrl:f.env.API_ORIGIN,requestTimeoutMs:50},accountClient:{request}})},input=id=>({requestId:id,sourceText:'Same synthetic post',sourceUrl:'https://x.com/example/status/123'});
  try{
   let c=new DeliveryCoordinator(settings);await c.generateReplies(input(first)).catch(()=>{});
   if(i%2)for(const key of Object.keys(data))delete data[key];c=new DeliveryCoordinator(settings);
   await c.generateReplies(input(randomUUID())).catch(()=>{});const state=await c.recoverPending({abandon:true});if(state.state!=='released')throw Error('Not released');
   paths.length=0;for(let j=0;j<3;j++)if(await c.generateReplies(input(randomUUID()))!==raw)throw Error('Result mismatch');
   const a=f.sql.prepare('SELECT free_balance,free_generation_reserved FROM credit_accounts').get(),n=f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n;
   if(a.free_balance!==197||a.free_generation_reserved!==0||n!==3||calls!==4)throw Error('Ledger/duplicate-work invariant');
   if(version==='candidate'&&paths.some(p=>p.includes('/requests/')&&!p.endsWith('/delivered')))throw Error('Recovery queries leaked back into normal path');passed++;
  }catch(error){errors.push(error.message);}finally{f.sql.close();}
 }
 report.versions[version]={trials:8,passed,successRate:passed/8,errors};
}
writeFileSync(process.env.PR16_BENCHMARK_OUTPUT||'/private/tmp/pr16-fast-recovery-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(Object.values(report.versions).some(v=>v.successRate!==1))process.exitCode=1;
