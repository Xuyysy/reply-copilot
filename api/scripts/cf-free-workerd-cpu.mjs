#!/usr/bin/env node
// Offline, synthetic workerd route runner. No real Cloudflare resources or users.
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
import WebSocket from 'ws';
import {createHash, pbkdf2Sync, randomUUID} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {encryptProviderApiKey} from '../src/ai-model-crypto.js';
import {ROUTES, parseOptions, migrationStatements, summarizeWallMs, summarizeV8Profile} from './lib/workerd-cpu-evidence.mjs';

const API = 'https://isolated-api.example.test';
const WEB = 'https://isolated-web.example.test';
const EXT = 'chrome-extension://' + 'a'.repeat(32);
const PEPPER = 'isolated-benchmark-pepper-only-not-a-secret';
const AUTH = 'isolated-benchmark-auth-key-not-a-secret-123';
const PASSWORD = 'local-synthetic-password-123456!';
const WEB_TOKEN = 'a'.repeat(64), EXT_TOKEN = 'e'.repeat(64);
const MAIN_USER = 'benchmark-main-user';
const VERIFIER='cf-free-offline-business-verifier';
const EXTENDED_ROUTES=Object.freeze([...ROUTES.slice(0,7),'login_60k','login_210k',...ROUTES.slice(7)]);

export async function setupSyntheticWorkerd({profile = false, source = 'free', assertionMode = 'legacy', measureBatches = false, expiryIndex = 'full', passwordMode='native', extendedLogin=false, productionProvider=null, syntheticUpstream=null} = {}) {
  if(productionProvider!==null&&(!['legacy','managed'].includes(productionProvider)||typeof syntheticUpstream!=='function'))throw Error('Synthetic Production provider requires an explicit intercepted upstream');
  if(productionProvider===null&&syntheticUpstream!==null)throw Error('Unexpected upstream handler');
  if(passwordMode!=='native'||typeof extendedLogin!=='boolean')throw Error('Unknown local password experiment');
  if(expiryIndex!=='full')throw Error('Unknown local index experiment');
  if(!['legacy','select'].includes(assertionMode))throw Error('Unknown assertion mode');
  if(!['free','paid','subscription'].includes(source))throw Error('Unknown synthetic funding source');
  let external = 0;
  // Diagnostic-only wrapper around real local D1.batch; no changes to the
  // application Worker or its public responses. Do not compare wall times
  // from this instrumented runtime with the uninstrumented profiler.
  const entry=measureBatches?{stdin:{
    resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),
    sourcefile:'local-d1-batch-diagnostic.ts',
    contents:`import worker from './index.ts';
      export default {async fetch(request,env,ctx){
        const tally={calls:0,statements:0,rowsRead:0,rowsWritten:0,missingMetadata:0,standaloneCalls:0};
        const db=env.DB;
        // Keep the real prepared statement identity for batch(). A standalone
        // first() has no D1 row metadata; count calls only, never invent rows.
        const originals=new WeakMap();
        const wrap=stmt=>{
          const proxy=new Proxy(stmt,{get(target,key){
            if(key==='bind')return (...args)=>wrap(target.bind(...args));
            if(['first','all','run','raw'].includes(key))return async (...args)=>{
              tally.standaloneCalls++;return target[key](...args);
            };
            const v=Reflect.get(target,key,target);
            return typeof v==='function'?v.bind(target):v;
          }});
          originals.set(proxy,stmt);return proxy;
        };
        const measured=new Proxy(db,{get(target,key){
          if(key==='prepare')return sql=>wrap(target.prepare(sql));
          if(key==='batch')return async statements=>{
            const results=await target.batch(statements.map(s=>originals.get(s)??s));
            tally.calls++;tally.statements+=results.length;
            for(const r of results){
              if(!Number.isSafeInteger(r.meta?.rows_read)||!Number.isSafeInteger(r.meta?.rows_written)){tally.missingMetadata++;continue;}
              tally.rowsRead+=r.meta.rows_read;tally.rowsWritten+=r.meta.rows_written;
            }
            return results;
          };
          const value=Reflect.get(target,key,target);
          return typeof value==='function'?value.bind(target):value;
        }});
        const response=await worker.fetch(request,{...env,DB:measured},ctx);
        const headers=new Headers(response.headers);
        headers.set('X-CF-Free-Local-Batch',JSON.stringify(tally));
        return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
      }};`
  }}:{entryPoints:[new URL('../src/index.ts', import.meta.url).pathname]};
  const bundle = buildSync({...entry,bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',sourcemap:false}).outputFiles[0].text;
  const vars = {
    ENVIRONMENT:'staging', WEB_ORIGIN:WEB, API_ORIGIN:API, EXTENSION_ORIGIN:EXT,
    AUTH_HASH_SECRET:AUTH, PASSWORD_PEPPER:PEPPER, AI_MODE:'mock', AI_MOCK_COST_MICRO_USD:'0',
    AI_MOCK_DELAY_MS:'0', SUBSCRIPTIONS_ENABLED:'1', PAYMENTS_ENABLED:'0',
    ADMIN_PORTAL_ENABLED:'0', CF_FREE_ZERO_WRITE_ASSERTIONS:assertionMode==='select'?'1':'0'
  };
  const localProviderKey='synthetic-local-model-key';
  const localEncryptionKey=Buffer.alloc(32,9).toString('base64');
  if(productionProvider)Object.assign(vars,{ENVIRONMENT:'production',AI_MODE:'production',DEEPSEEK_API_KEY:localProviderKey,DEEPSEEK_INPUT_USD_PER_MILLION:'0.3',DEEPSEEK_OUTPUT_USD_PER_MILLION:'1.32',AI_CONFIG_ENCRYPTION_KEY:localEncryptionKey});
  const env = Object.fromEntries(Object.entries(vars).map(([key,value]) => [key,{type:'text',value}]));
  env.DB = {type:'d1',id:'cf-free-offline-synthetic-d1'};
  const config = {name:'cf-free-offline-synthetic',compatibilityDate:'2026-10-14',env,
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:bundle}}}};
  const deny=()=>{external++;throw Error('External network denied');};
  // Every outbound request is intercepted inside the local runtime. Only
  // the exact synthetic DNS and completion endpoints may be handled. Never
  // call fetch() from this adapter or forward a request to the public network.
  const intercept=async req=>{
    const u=new URL(req.url);
    if(u.origin==='https://cloudflare-dns.com'&&u.pathname==='/dns-query'&&u.searchParams.get('name')==='api.deepseek.com'&&['A','AAAA'].includes(u.searchParams.get('type'))&&req.method==='GET'){
      if(productionProvider!=='managed')return deny();
      return Response.json({Status:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
    }
    if(u.origin!=='https://api.deepseek.com'||u.search||u.hash||req.method!=='POST'||u.pathname!==(productionProvider==='managed'?'/v1/chat/completions':'/chat/completions')||req.headers.get('authorization')!=='Bearer '+localProviderKey)return deny();
    return syntheticUpstream(await req.json());
  };
  const workers=[{config,dev:{...(profile?{unsafeInspectorProxy:true}:{}),outboundService:{type:'fetcher',handler:productionProvider?intercept:deny}}}];
  const mf=new Miniflare({...(profile?{inspectorPort:0}:{}),workers});
  try {
    const db = await mf.getD1Database('DB');
    const migrations = new URL('../migrations/',import.meta.url);
    for (const name of readdirSync(migrations).filter(name => /^\d{4}_[\w-]+\.sql$/.test(name)).sort()) {
      for (const statement of migrationStatements(readFileSync(new URL(name,migrations),'utf8')))
        await db.prepare(statement).run();
    }
    // This proposal is only applied inside a new isolated in-memory D1.

    for (const [id,rounds] of [[MAIN_USER,null],['benchmark-login-10k',10000],['benchmark-login-100k',100000],...(extendedLogin?[['benchmark-login-60k',60000],['benchmark-login-210k',210000]]:[])]) {
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
      .bind(MAIN_USER,source==='paid'?0:200,source==='paid'?200:0,1,1).run();
    await db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind('synthetic-credit-batch',MAIN_USER,source==='paid'?'paid':'free',source==='paid'?'legacy_paid':'signup',200,200,1,'tracked','active').run();
    if(source==='subscription'){
      // All rows are synthetic and local. Only the local_mock payment proof
      // is seeded; the actual subscription account and reservation code runs.
      const now=Date.now(),start=now-2*86400000-10000;
      await db.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES('synthetic-order',?,'basic-v1','purchase',6990,'paid',1,9999999999999,1,1,?,?)").bind(MAIN_USER,now,now).run();
      await db.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,provider_trade_id,payment_channel,amount_fen,status,risk_state,created_at,updated_at,paid_at) VALUES('synthetic-txn','synthetic-order','local_mock','synthetic-trade','LOCAL_MOCK',6990,'paid','clear',1,1,?)").bind(now).run();
      await db.prepare("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,received_at) VALUES('synthetic-event','synthetic-txn','local_mock','synthetic-event-key','PAYMENT_SUCCEEDED',6990,?)").bind(now).run();
      await db.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('synthetic-period',?,'synthetic-order','basic-v1',500,'active',?,?,1,1)").bind(MAIN_USER,start,start+30*86400000).run();
      if(productionProvider){
        // Synthetic fiat proof shape accepted by Production; no actual payment,
        // webhook, merchant key, or network is involved.
        await db.prepare("UPDATE subscription_payment_transactions SET merchant_provider='mk99',merchant_account='synthetic-merchant',notification_sign_type='RSA2',payment_channel='ALIPAY_H5' WHERE id='synthetic-txn'").run();
        await db.prepare("UPDATE subscription_payment_events SET merchant_provider='mk99',body_sha256=? WHERE id='synthetic-event'").bind('a'.repeat(64)).run();
      }
    }
    if(productionProvider==='managed'){
      const configId='synthetic-model';
      const encrypted=await encryptProviderApiKey(localEncryptionKey,configId,1,localProviderKey);
      await db.prepare("INSERT INTO ai_provider_configs(id,display_name,latest_version,created_at,updated_at,updated_by) VALUES(?,'Synthetic managed model',1,1,1,?)").bind(configId,MAIN_USER).run();
      await db.prepare("INSERT INTO ai_provider_config_versions(config_id,version,provider,protocol,base_url,model_id,api_key_ciphertext,input_rate_micro_usd_per_million,output_rate_micro_usd_per_million,max_output_tokens,timeout_ms,options_json,endpoint_addresses_json,created_at,created_by) VALUES(?,1,'deepseek','openai_chat','https://api.deepseek.com/v1','synthetic-managed',?,300000,1320000,512,10000,'{}','[]',1,?)").bind(configId,encrypted,MAIN_USER).run();
      await db.prepare("UPDATE ai_provider_runtime SET active_config_id=?,active_version=1 WHERE id=1").bind(configId).run();
    }
    if(productionProvider)await db.prepare("UPDATE system_settings SET value='100000000' WHERE key='daily_cost_limit_micro_usd'").run();
    await db.prepare("UPDATE system_settings SET value='1' WHERE key='ai_enabled'").run();
    return {mf,db,getExternalCalls:() => external};
  } catch (error) {await mf.dispose();throw error;}
}

class InspectorClient {
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
  static async connect(mf) {
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
      try {return new URL(x.webSocketDebuggerUrl).pathname==='/cf-free-offline-synthetic';}
      catch{return false;}
    }):[];
    if(named.length!==1)throw Error('Expected one local synthetic worker inspector target');
    const inspectorUrl=new URL(named[0].webSocketDebuggerUrl);
    if(inspectorUrl.protocol!=='ws:' || inspectorUrl.hostname!==base.hostname ||
       inspectorUrl.port!==base.port || inspectorUrl.pathname!=='/cf-free-offline-synthetic' ||
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
  close(){this.ws.terminate();}
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
  else if(['login_10k','login_60k','login_100k','login_210k'].includes(label)){
    path='/v1/auth/login';method='POST';
    body={identity:'benchmark-login-'+label.slice(6)+'@example.test',password:PASSWORD};
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
  const raw=response.headers.get('X-CF-Free-Local-Batch');
  return {elapsed,batch:raw?JSON.parse(raw):null};
}

export async function runWorkerdCpuExperiment({samples=3,warmup=1,profile=false,source='free',assertionMode='legacy',measureBatches=false,expiryIndex='full',passwordMode='native',extendedLogin=false}={}) {
  if(!Number.isInteger(samples)||samples<1||samples>4||!Number.isInteger(warmup)||warmup<0||warmup>1)throw Error('Synthetic request cap exceeded');
  const setup=await setupSyntheticWorkerd({profile,source,assertionMode,measureBatches,expiryIndex,passwordMode,extendedLogin});
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
    for(const name of (extendedLogin?EXTENDED_ROUTES:ROUTES)) {
      for(let i=0;i<warmup;i++)await invoke(setup.mf,name,i,ids);
      if(profile)await inspector.call('Profiler.start');
      const elapsed=[],batches=[];
      let prof;
      try {for(let i=0;i<samples;i++){const result=await invoke(setup.mf,name,warmup+i,ids);elapsed.push(result.elapsed);if(measureBatches){if(!result.batch||result.batch.missingMetadata!==0)throw Error('Missing local D1 batch metadata');batches.push(result.batch);}}}
      finally {if(profile)prof=await inspector.call('Profiler.stop');}
      rows.push({category:name,wall:summarizeWallMs(elapsed),cpuProfile:profile ? summarizeV8Profile(prof?.profile) : {status:'NOT_REQUESTED'},...(measureBatches?{localD1BatchTotals:Object.fromEntries(['calls','statements','rowsRead','rowsWritten'].map(key=>[key,batches.reduce((n,b)=>n+b[key],0)])),localD1StandaloneCalls:batches.reduce((n,b)=>n+b.standaloneCalls,0)}:{})});
    }
    const a=await setup.db.prepare('SELECT free_balance,paid_balance,free_generation_reserved,paid_generation_reserved FROM credit_accounts WHERE user_id=?').bind(MAIN_USER).first();
    const debit=await setup.db.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE user_id=? AND kind='generation_debit'").bind(MAIN_USER).first();
    const generated=samples+warmup;
    const expectedFree=source==='free'?200-generated:source==='paid'?0:200;
    const expectedPaid=source==='paid'?200-generated:0;
    const expectedDebits=source==='subscription'?0:generated;
    const sub=await setup.db.prepare("SELECT COALESCE(SUM(used),0) AS used,COALESCE(SUM(reserved),0) AS reserved FROM subscription_daily_usage").first();
    if(ids.length || a?.free_balance!==expectedFree || a?.paid_balance!==expectedPaid ||
       a?.free_generation_reserved!==0 || a?.paid_generation_reserved!==0 || debit?.n!==expectedDebits ||
       sub?.used!==(source==='subscription'?generated:0) || sub?.reserved!==0)
      throw Error('Synthetic generation/ACK credit accounting regression');
    if(setup.getExternalCalls()!==0)throw Error('External network was attempted');
    return {status:'SYNTHETIC_LOCAL_ONLY',runtime:'Miniflare/workerd',environment:'isolated, fresh local D1, offline mock AI',
      source,assertionMode,measureBatches,expiryIndex,passwordMode,extendedLogin,freeCertified:false,productionHotspotsConfirmed:false,sampleCountPerCase:samples,warmupCountPerCase:warmup,
      caveat:'Wall metrics include I/O and scheduling, not CPU. V8 profiles are sampled and may include idle/GC, not per-request CPU percentiles. Never compare these numbers directly to the 10ms Workers Free CPU limit. Optional D1 row totals cover successful DB.batch only; standaloneCalls counts first/all/run/raw invocations (not rows), excluding background work. Not cloud billing.',
      cases:rows,assertions:{realNetworkCalls:0,creditDebits:expectedDebits,subscriptionUsed:sub.used,endingFreeCredits:expectedFree,endingPaidCredits:expectedPaid,endingReservedCredits:0}};
  }finally{if(inspector)inspector.close();await setup.mf.dispose();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let opts;try{opts=parseOptions(process.argv.slice(2));}
  catch {console.error('Usage: node api/scripts/cf-free-workerd-cpu.mjs [--samples 1..4] [--warmup 0..1] [--profile] [--source free|paid|subscription]');process.exit(2);}
  runWorkerdCpuExperiment(opts).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n'))
    .catch(()=>{console.error('Local workerd experiment failed; no CF Free certification produced.');process.exitCode=1;});
}
