#!/usr/bin/env node
// Offline, synthetic workerd route runner. No real Cloudflare resources or users.
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
import WebSocket from 'ws';
import {createHash, pbkdf2Sync, randomUUID} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {ROUTES, parseOptions, migrationStatements, summarizeWallMs, summarizeV8Profile} from './lib/workerd-cpu-evidence.mjs';

const API = 'https://isolated-api.example.test';
const WEB = 'https://isolated-web.example.test';
const EXT = 'chrome-extension://' + 'a'.repeat(32);
const PEPPER = 'isolated-benchmark-pepper-only-not-a-secret';
const AUTH = 'isolated-benchmark-auth-key-not-a-secret-123';
const PASSWORD = 'local-synthetic-password-123456!';
const WEB_TOKEN = 'a'.repeat(64), EXT_TOKEN = 'e'.repeat(64);
const MAIN_USER = 'benchmark-main-user';

export async function setupSyntheticWorkerd({profile = false} = {}) {
  let external = 0;
  const bundle = buildSync({entryPoints:[new URL('../src/index.ts', import.meta.url).pathname], bundle:true, write:false,
    platform:'browser', format:'esm', target:'es2022', sourcemap:false}).outputFiles[0].text;
  const vars = {
    ENVIRONMENT:'staging', WEB_ORIGIN:WEB, API_ORIGIN:API, EXTENSION_ORIGIN:EXT,
    AUTH_HASH_SECRET:AUTH, PASSWORD_PEPPER:PEPPER, AI_MODE:'mock', AI_MOCK_COST_MICRO_USD:'0',
    AI_MOCK_DELAY_MS:'0', SUBSCRIPTIONS_ENABLED:'0', PAYMENTS_ENABLED:'0',
    ADMIN_PORTAL_ENABLED:'0'
  };
  const env = Object.fromEntries(Object.entries(vars).map(([key,value]) => [key,{type:'text',value}]));
  env.DB = {type:'d1',id:'cf-free-offline-synthetic-d1'};
  const config = {name:'cf-free-offline-synthetic',compatibilityDate:'2026-10-14',env,
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:bundle}}}};
  const mf = new Miniflare({...(profile ? {inspectorPort:0} : {}),workers:[{config,
    dev:{...(profile ? {unsafeInspectorProxy:true} : {}),outboundService:{type:'fetcher',handler:() => {external++;throw Error('External network denied');}}}}]});
  try {
    const db = await mf.getD1Database('DB');
    const migrations = new URL('../migrations/',import.meta.url);
    for (const name of readdirSync(migrations).filter(name => /^\d{4}_[\w-]+\.sql$/.test(name)).sort()) {
      for (const statement of migrationStatements(readFileSync(new URL(name,migrations),'utf8')))
        await db.prepare(statement).run();
    }
    for (const [id,rounds] of [[MAIN_USER,null],['benchmark-login-10k',10000],['benchmark-login-100k',100000]]) {
      const salt = '00'.repeat(16);
      const digest = rounds ? pbkdf2Sync(PASSWORD + '\0' + PEPPER, Buffer.alloc(16), rounds, 32,'sha256').toString('hex') : null;
      const stored = digest ? 'pbkdf2-sha256:' + rounds + ':' + salt + ':' + digest : null;
      await db.prepare('INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES(?,?,?,?,?,?)')
        .bind(id, id+'@example.test', 1, 1, id.replaceAll('-','_'), stored).run();
    }
    for (const [id,token,kind] of [['web',WEB_TOKEN,'web'],['extension',EXT_TOKEN,'extension']]) {
      await db.prepare('INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,?,?,?)')
        .bind('synthetic-'+id,createHash('sha256').update(token).digest('hex'),MAIN_USER,kind,1,Date.now()+86400000).run();
    }
    await db.prepare('INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,?,?,?,?)')
      .bind(MAIN_USER,200,0,1,1).run();
    await db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind('synthetic-free-batch',MAIN_USER,'free','signup',200,200,1,'tracked','active').run();
    await db.prepare("UPDATE system_settings SET value='1' WHERE key='ai_enabled'").run();
    return {mf,db,getExternalCalls:() => external};
  } catch (error) {await mf.dispose();throw error;}
}

export class InspectorClient {
  constructor(ws) {
    this.ws=ws;this.next=0;this.pending=new Map();
    ws.addEventListener('message',event=>{
      let data;try {data=JSON.parse(event.data);}catch{return;}
      const req=this.pending.get(data.id);if(!req)return;
      this.pending.delete(data.id);clearTimeout(req.timer);
      if(data.error)req.reject(Error('Inspector command rejected'));
      else req.resolve(data.result);
    });
    ws.addEventListener('close',()=>{for(const req of this.pending.values()){clearTimeout(req.timer);req.reject(Error('Inspector closed'));}this.pending.clear();});
  }
  static async connect(mf, workerName='cf-free-offline-synthetic') {
    if(!['cf-free-offline-synthetic','cf-free-offline-verifier'].includes(workerName))throw Error('Inspector target not allowed');
    const base = new URL(await mf.getInspectorURL());
    if(base.protocol!=='ws:' || !['localhost','127.0.0.1','[::1]'].includes(base.hostname))
      throw Error('Non-local inspector refused');
    // Miniflare 5 returns the inspector server root. Its proxy only accepts
    // the exact worker-name WebSocket path advertised by /json/list.
    const discovery=new URL(base);
    discovery.protocol='http:';
    discovery.pathname='/json/list';
    const found=await fetch(discovery);
    if(!found.ok)throw Error('Local inspector target discovery failed');
    const targets=await found.json();
    const named=Array.isArray(targets)?targets.filter(x=>{
      if(typeof x?.webSocketDebuggerUrl!=='string')return false;
      try {return new URL(x.webSocketDebuggerUrl).pathname==='/'+workerName;}
      catch{return false;}
    }):[];
    if(named.length!==1)throw Error('Expected one local synthetic worker inspector target');
    const inspectorUrl=new URL(named[0].webSocketDebuggerUrl);
    if(inspectorUrl.protocol!=='ws:' || inspectorUrl.hostname!==base.hostname ||
       inspectorUrl.port!==base.port || inspectorUrl.pathname!=='/'+workerName ||
       inspectorUrl.username || inspectorUrl.password || inspectorUrl.search || inspectorUrl.hash)
      throw Error('Inspector discovery target mismatch');
    // Miniflare's inspector proxy rejects User-Agent-bearing WebSocket clients
    // without an Origin. The ws client supplies an explicit approved local Origin.
    const ws=new WebSocket(String(inspectorUrl),{origin:'http://localhost'});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Local inspector connect timeout')),10000);
      ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Local inspector unavailable'));},{once:true});
    });
    const instance=new InspectorClient(ws);
    await instance.call('Profiler.enable');
    return instance;
  }
  call(method) {
    return new Promise((resolve,reject)=>{
      const id=++this.next;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Local inspector response timeout'));},10000);
      this.pending.set(id,{resolve,reject,timer});
      this.ws.send(JSON.stringify({id,method}));
    });
  }
  close(){this.ws.close();}
}

async function invoke(mf,label,index,pendingIds) {
  const common={Origin:WEB, Cookie:'rc_session='+WEB_TOKEN, 'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.'+(index+10)};
  const extension={Origin:EXT,Authorization:'Bearer '+EXT_TOKEN, 'Content-Type':'application/json'};
  let path,method='GET',headers=common,body;
  if(label==='health')path='/health';
  else if(label==='me')path='/v1/me';
  else if(label==='usage')path='/v1/usage';
  else if(label==='entitlements')path='/v1/entitlements';
  else if(label==='bootstrap'){path='/v1/extension/bootstrap';headers=extension;}
  else if(label==='login_10k'||label==='login_100k'){
    path='/v1/auth/login';method='POST';
    body={identity:'benchmark-login-'+(label==='login_10k'?'10k':'100k')+'@example.test',password:PASSWORD};
  }else if(label==='ai_generate_mock'){
    path='/v1/ai/generate';method='POST';headers=extension;
    const requestId=randomUUID();pendingIds.push(requestId);
    body={requestId,post:{text:'A local synthetic X post for reproducible CPU testing.'}};
  }else if(label==='ai_delivery_ack'){
    const requestId=pendingIds.shift();
    if(!requestId)throw Error('Missing synthetic generation');
    path='/v1/ai/requests/'+requestId+'/delivered';method='POST';headers=extension;
    body={requestId};
  }else throw Error('Unknown synthetic scenario');
  const started=performance.now();
  const response=await mf.dispatchFetch(API+path,{method,headers,...(body ? {body:JSON.stringify(body)} : {})});
  const data=await response.json();
  const elapsed=performance.now()-started;
  if(response.status!==200) {
    const safeCode=/^[A-Z_]{1,64}$/.test(data?.code||'')?data.code:'UNKNOWN';
    throw Error('Synthetic '+label+' HTTP '+response.status+' ('+safeCode+')');
  }
  if(label==='ai_generate_mock' && typeof data.raw!=='string')throw Error('Synthetic AI result missing');
  if(label==='ai_delivery_ack' && data.ok!==true)throw Error('Synthetic ACK failed');
  return elapsed;
}

export async function runWorkerdCpuExperiment({samples=3,warmup=1,profile=false}={}) {
  if(!Number.isInteger(samples)||samples<1||samples>4||!Number.isInteger(warmup)||warmup<0||warmup>1)throw Error('Synthetic request cap exceeded');
  const setup=await setupSyntheticWorkerd({profile});
  let inspector;
  const rows=[],ids=[];
  try {
    if(profile){
      // The per-worker Inspector Proxy can attach only after a real user
      // isolate has started; the /health warmup is side-effect free.
      const ready=await setup.mf.dispatchFetch(API+'/health');
      if(ready.status!==200)throw Error('Local profiling isolate warmup failed');
      await ready.text();
      inspector=await InspectorClient.connect(setup.mf);
    }
    for(const name of ROUTES) {
      for(let i=0;i<warmup;i++)await invoke(setup.mf,name,i,ids);
      if(profile)await inspector.call('Profiler.start');
      const elapsed=[];
      let prof;
      try {for(let i=0;i<samples;i++)elapsed.push(await invoke(setup.mf,name,warmup+i,ids));}
      finally {if(profile)prof=await inspector.call('Profiler.stop');}
      rows.push({category:name,wall:summarizeWallMs(elapsed),cpuProfile:profile ? summarizeV8Profile(prof?.profile) : {status:'NOT_REQUESTED'}});
    }
    const a=await setup.db.prepare('SELECT free_balance,paid_balance,free_generation_reserved FROM credit_accounts WHERE user_id=?').bind(MAIN_USER).first();
    const debit=await setup.db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE user_id=? AND kind='generation_debit'").bind(MAIN_USER).first();
    const generated=samples+warmup;
    if(ids.length || a?.free_balance!==200-generated || a?.paid_balance!==0 || a?.free_generation_reserved!==0 || debit?.n!==generated)
      throw Error('Synthetic generation/ACK credit accounting regression');
    if(setup.getExternalCalls()!==0)throw Error('External network was attempted');
    return {status:'SYNTHETIC_LOCAL_ONLY',runtime:'Miniflare/workerd',environment:'isolated, fresh local D1, offline mock AI',
      freeCertified:false,productionHotspotsConfirmed:false,sampleCountPerCase:samples,warmupCountPerCase:warmup,
      caveat:'Wall metrics include I/O and scheduling, not CPU. V8 profiles are sampled and may include idle/GC, not per-request CPU percentiles. Never compare these numbers directly to the 10ms Workers Free CPU limit.',
      cases:rows,assertions:{realNetworkCalls:0,creditDebits:generated,endingFreeCredits:200-generated,endingReservedCredits:0}};
  }finally{if(inspector)inspector.close();await setup.mf.dispose();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let opts;try{opts=parseOptions(process.argv.slice(2));}
  catch {console.error('Usage: node api/scripts/cf-free-workerd-cpu.mjs [--samples 1..4] [--warmup 0..1] [--profile]');process.exit(2);}
  runWorkerdCpuExperiment(opts).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n'))
    .catch(()=>{console.error('Local workerd experiment failed; no CF Free certification produced.');process.exitCode=1;});
}
