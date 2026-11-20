#!/usr/bin/env node
// Only isolated Miniflare/workerd and synthetic fixtures. Never accesses Cloudflare.
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
import {createHash,pbkdf2Sync} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {InspectorClient} from './cf-free-workerd-cpu.mjs';
import {migrationStatements,summarizeWallMs,summarizeV8Profile} from './lib/workerd-cpu-evidence.mjs';

const WORKER='cf-free-offline-synthetic', VERIFIER='cf-free-offline-verifier';
const WEB='https://isolated-web.example.test', API='https://isolated-api.example.test';
const PASSWORD='synthetic-2026-do-password-not-real!';
const PEPPER='synthetic-rpc-proof-pepper-never-production';
const AUTH='synthetic-auth-signing-key-never-production-000000';
const ROUNDS=[10000,100000,210000];
const CPU_LIMIT_MS=10;

function esm(entry,extra={}){
  return buildSync({entryPoints:[new URL(entry,import.meta.url).pathname],bundle:true,write:false,
    platform:'browser',format:'esm',target:'es2022',...extra}).outputFiles[0].text;
}
function manifest(source){return {mainModule:'index.js',modules:{'index.js':{type:'esm',contents:source}}};}
function blocked(){throw Error('Network access forbidden in CPU proof');}

async function setup(offload){
  let outbound=0;
  const deny=()=>{outbound++;return blocked();};
  const userVars={ENVIRONMENT:'staging',WEB_ORIGIN:WEB,API_ORIGIN:API,
    EXTENSION_ORIGIN:'chrome-extension://'+'a'.repeat(32),
    AUTH_HASH_SECRET:AUTH,PASSWORD_PEPPER:PEPPER,
    AI_MODE:'mock',SUBSCRIPTIONS_ENABLED:'0',PAYMENTS_ENABLED:'0',ADMIN_PORTAL_ENABLED:'0',
    ...(offload?{PASSWORD_VERIFY_DO_ENABLED:'1'}:{})};
  const env=Object.fromEntries(Object.entries(userVars).map(([key,value])=>[key,{type:'text',value}]));
  env.DB={type:'d1',id:'synthetic-offload-comparison'};
  if(offload)env.PASSWORD_VERIFY_DO={type:'durable-object',worker:VERIFIER,exportName:'PasswordVerifierDO'};
  const options=[{config:{name:WORKER,compatibilityDate:'2026-10-14',
      env,manifest:manifest(esm('../src/index.ts'))},
    dev:{unsafeInspectorProxy:true,outboundService:{type:'fetcher',handler:deny}}}];
  if(offload)options.push({config:{name:VERIFIER,compatibilityDate:'2026-11-19',
    env:{PASSWORD_PEPPER:{type:'text',value:PEPPER}},
    manifest:manifest(esm('../prototypes/cf-free-password-do/src/index.ts',
      {external:['cloudflare:workers']})),
    exports:{PasswordVerifierDO:{type:'durable-object',storage:'sqlite'}}},
    dev:{unsafeInspectorProxy:true,outboundService:{type:'fetcher',handler:deny}}});
  const mf=new Miniflare({inspectorPort:0,workers:options});
  try {
    const db=await mf.getD1Database('DB');
    const root=new URL('../migrations/',import.meta.url);
    for(const name of readdirSync(root).filter(name=>/^\d{4}_[\w-]+\.sql$/.test(name)).sort()){
      for(const sql of migrationStatements(readFileSync(new URL(name,root),'utf8')))
        await db.prepare(sql).run();
    }
    for(const rounds of ROUNDS){
      const id='test-'+rounds,salt='00'.repeat(16);
      const actual=pbkdf2Sync(PASSWORD+'\0'+PEPPER,Buffer.alloc(16),rounds,32,'sha256').toString('hex');
      const hash='pbkdf2-sha256:'+rounds+':'+salt+':'+actual;
      await db.prepare('INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,status) VALUES(?,?,?,?,?,?,?)')
        .bind(id,id+'@example.test',1,1,'testuser'+rounds,hash,'active').run();
    }
    return {mf,db,outbound:()=>outbound};
  }catch(error){await mf.dispose();throw error;}
}

async function login(mf,rounds,password=PASSWORD){
  const request=new Request(API+'/v1/auth/login',{method:'POST',
    headers:{Origin:WEB,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.'+(10+ROUNDS.indexOf(rounds))},
    body:JSON.stringify({identity:'test-'+rounds+'@example.test',password})});
  const t=performance.now();
  const response=await mf.dispatchFetch(request);
  const ms=performance.now()-t;
  const json=await response.json();
  return {status:response.status,code:typeof json?.code==='string'?json.code:null,ms};
}
async function inspector(mf,target){
  return InspectorClient.connect(mf,target);
}

export async function comparePasswordRpcCpu({samples=3}={}){
  if(!Number.isInteger(samples)||samples<2||samples>4)throw Error('Invalid sample cap');
  const comparisons=[];
  for(const offload of [false,true]){
    const {mf,db,outbound}=await setup(offload);
    let caller,verifier;
    try{
      // Warm each script and the DO instance before local Inspector discovery.
      const warm=await login(mf,10000);
      if(warm.status!==200)throw Error('Local login warmup failed');
      caller=await inspector(mf,WORKER);
      if(offload)verifier=await inspector(mf,VERIFIER);
      const cases=[];
      for(const rounds of ROUNDS){
        const elapsed=[];
        let cpu,doCpu;
        await caller.call('Profiler.start');
        if(verifier)await verifier.call('Profiler.start');
        try{
          for(let i=0;i<samples;i++){
            const r=await login(mf,rounds);
            if(r.status!==200)throw Error('Synthetic login failed for '+rounds);
            elapsed.push(r.ms);
          }
        }finally{
          cpu=(await caller.call('Profiler.stop')).profile;
          if(verifier)doCpu=(await verifier.call('Profiler.stop')).profile;
        }
        cases.push({factor:rounds,wall:summarizeWallMs(elapsed),
          httpCpu:summarizeV8Profile(cpu),
          ...(offload?{verifierCpu:summarizeV8Profile(doCpu)}:{})});
      }
      const wrong=await login(mf,100000,'definitely-wrong-password');
      if(wrong.status!==401 || wrong.code!=='INVALID_CREDENTIALS')
        throw Error('Wrong password was not denied');
      const sessions=await db.prepare('SELECT COUNT(*) AS n FROM sessions').first();
      if(sessions?.n!==1+3*samples)throw Error('Session issuance count drifted');
      const stored=await db.prepare('SELECT password_hash FROM users WHERE id=?').bind('test-100000').first();
      if(!String(stored?.password_hash).startsWith('pbkdf2-sha256:100000:'))
        throw Error('Stored work factor was modified');
      if(outbound()!==0)throw Error('Unexpected external outbound fetch');
      comparisons.push({mode:offload?'do_rpc':'http_local',offloadEnabled:offload,
        cases,wrongPasswordDenied:true,storedFactorUnchanged:true,externalCalls:0});
    }finally{
      if(caller)caller.close();if(verifier)verifier.close();await mf.dispose();
    }
  }
  return {status:'SYNTHETIC_LOCAL_ONLY',freeCertified:false,productionCertified:false,
    rule:{workerFreeCpuMs:CPU_LIMIT_MS},
    caution:'All timings are LOCAL dispatch WALL ms, not Cloudflare invocation CPU; sampled V8 leaf frames are a qualitative hotspot, not precise CPU ms. Durable Object has its own CPU limit. Do not infer Free eligibility from offload.',
    comparisons};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  comparePasswordRpcCpu().then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n'))
    .catch(()=>{console.error('Isolated DO CPU proof failed; CF Free remains NO-GO.');process.exitCode=1;});
}
