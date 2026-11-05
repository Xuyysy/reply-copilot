// Actual quota state machine + isolated SQLite schema. RTT is explicitly synthetic.
import {fixture,temp} from '../api/tests/helpers/payment-v2.mjs';import {createRequire} from 'node:module';import {randomUUID} from 'node:crypto';import {writeFileSync} from 'node:fs';import path from 'node:path';
const require=createRequire(new URL('../api/package.json',import.meta.url)),{buildSync}=require('esbuild'),roots={baseline:process.argv[2]||'/private/tmp/reply-copilot-pr16-round2-before',candidate:new URL('..',import.meta.url).pathname},delay=ms=>new Promise(r=>setTimeout(r,ms));
const stats=a=>{const s=[...a].sort((a,b)=>a-b);return{n:a.length,mean:a.reduce((a,b)=>a+b,0)/a.length,p50:s[Math.ceil(a.length*.5)-1],p90:s[Math.ceil(a.length*.9)-1]};};
const report={parameters:{samples:20,syntheticD1RoundTripMs:8,scope:'preflight + reservation only; no authentication/provider/ACK/network included',realProviderCalls:0},versions:{}};
for(const [name,root]of Object.entries(roots)){
 const out=path.join(temp,name+'-quota-bench.cjs');buildSync({entryPoints:[path.join(root,'api/src/quota.ts')],bundle:true,platform:'node',format:'cjs',outfile:out});const q=require(out),times=[],calls=[];
 for(let i=-2;i<20;i++){const f=fixture();let count=0;const prepare=f.env.DB.prepare.bind(f.env.DB),batch=f.env.DB.batch.bind(f.env.DB);f.env.DB.prepare=sql=>{const s=prepare(sql);for(const method of ['first','all','run']){const original=s[method].bind(s);s[method]=async(...args)=>{count++;await delay(8);return original(...args);};}return s;};f.env.DB.batch=async ss=>{count++;await delay(8);return batch(ss);};
  try{const id=randomUUID(),session={user_id:'test-user'},start=performance.now();await q.checkGenerationReplay(f.env,session,id,id);await q.reserveGeneration(f.env,session,id,id,100,null,name==='candidate'?{prechecked:true}:undefined);if(i>=0){times.push(performance.now()-start);calls.push(count);}if(f.sql.prepare('SELECT free_generation_reserved n FROM credit_accounts').get().n!==1)throw Error('Reservation invariant');}finally{f.sql.close();}
 }report.versions[name]={elapsedMs:stats(times),d1RoundTrips:stats(calls)};
}
writeFileSync('/private/tmp/pr16-round2-worker-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
