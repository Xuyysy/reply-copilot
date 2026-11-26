// One-shot test runner. Cloud credentials are used only after the offline rehearsal.
import {build,buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
import {createHash,createHmac,pbkdf2Sync,randomBytes,randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {correlateInvocationLogs} from './telemetry.mjs';
import {migrationStatements} from '../lib/workerd-cpu-evidence.mjs';
import {encryptProviderApiKey} from '../../src/ai-model-crypto.js';
const ACCOUNT='307563e1fa86940ac46ca4dd78f1f12a',ACCOUNT_NAME='X Reply Helper - Isolated Workers Free CPU Pilot';
const SOURCE='c1e5b32f3663d19e2bb9af6e590285800770b8c9',NAME='xrh-cf-free-business-v6-20261126',OWNER=NAME+'-verifier',SUB='x-reply-helper-isolated-workers-free-cpu-pilot';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const WEB='https://isolated-web.example.test',EXT='chrome-extension://'+'a'.repeat(32);
const PASS='SyntheticBusinessPassword123!',NEW='SyntheticNewPassword456!';
const AUTH='synthetic-only-auth-'+randomBytes(24).toString('hex'),PEPPER='synthetic-only-pepper-'+randomBytes(24).toString('hex'),TOKEN=randomBytes(32).toString('hex');
const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),MODEL_KEY=randomBytes(32).toString('base64');
const sha=x=>createHash('sha256').update(x).digest('hex');
const hmac=x=>createHmac('sha256',AUTH).update(x).digest('hex');
const stored=(rounds,password=PASS)=>'pbkdf2-sha256:'+rounds+':'+('ab'.repeat(16))+':'+pbkdf2Sync(password+'\0'+PEPPER,Buffer.alloc(16,0xab),rounds,32,'sha256').toString('hex');
const api=await build({entryPoints:[ROOT+'scripts/cf-free-business-cloud/worker.mjs'],inject:[ROOT+'scripts/cf-free-business-cloud/mock-fetch.mjs'],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',metafile:true,plugins:[{name:'synthetic-egress-explicit-global-fetch',setup(b){b.onLoad({filter:/\.[cm]?[jt]s$/},args=>{if(!args.path.startsWith(ROOT+'src/'))return;const source=readFileSync(args.path,'utf8');return {contents:source.replace(/globalThis\.fetch\b/g,'fetch'),loader:args.path.endsWith('.ts')?'ts':'js'};});}}]});
const verifier=buildSync({entryPoints:[ROOT+'prototypes/cf-free-private-verifier/src/index.ts'],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',external:['cloudflare:workers','./legacy-210k.wasm']}).outputFiles[0].text;
const wasm=readFileSync(ROOT+'prototypes/cf-free-private-verifier/src/legacy-210k.wasm');
assert.equal(sha(wasm),'2d34ed3d829ebff018cf3afaba063c9cfd90d14b00db938d082fa862e74ce838');
const code=api.outputFiles[0].text;
assert.ok(code.includes('SYNTHETIC_OUTBOUND_DENIED'));
assert.doesNotMatch(code,/globalThis\s*\.\s*fetch\b|globalThis\s*\[\s*['"]fetch['"]\s*\]/,'unmocked global network access');
const vars=origin=>({ENVIRONMENT:'production',API_ORIGIN:origin,WEB_ORIGIN:WEB,EXTENSION_ORIGIN:EXT,
 AUTH_HASH_SECRET:AUTH,PASSWORD_PEPPER:PEPPER,ACCEPTANCE_TOKEN:TOKEN,PASSWORD_VERIFY_DO_ENABLED:'1',
 PASSWORD_FREE_CPU_ENABLED:'0',PASSWORD_FREE_TINY_CPU_ENABLED:'0',PASSWORD_LEGACY_MIGRATION_ENABLED:'0',
 CF_FREE_ZERO_WRITE_ASSERTIONS:'1',AI_MODE:'production',DEEPSEEK_API_KEY:'synthetic-model-key',AI_CONFIG_ENCRYPTION_KEY:MODEL_KEY,
 DEEPSEEK_INPUT_USD_PER_MILLION:'0.3',DEEPSEEK_OUTPUT_USD_PER_MILLION:'1.32',SUBSCRIPTIONS_ENABLED:'1',
 ADMIN_PORTAL_ENABLED:'1',TURNSTILE_SECRET_KEY:'synthetic-turnstile-only',MAIL_API_KEY:'synthetic-mail-key',
 MAIL_FROM:'Synthetic <synthetic@example.test>',PAYMENTS_ENABLED:'1',PAYMENT_PROVIDER:'mk99',
 MK99_PID:'20881234567890',MK99_KEY:'synthetic-mk99-only',MK99_REQUEST_SIGN_TYPE:'MD5',
 MK99_PLATFORM_PUBLIC_KEY:rsa.publicKey.export({type:'spki',format:'pem'}).toString(),MK99_PROTOCOL_CONFIRMED:'1',
 MK99_AMOUNT_CONTRACT:'CNY_EXACT_BUYER_TOTAL',MK99_CASHIER_ORIGINS:'https://cashier.example.test'});
const schema=readdirSync(ROOT+'migrations').filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort().flatMap(n=>migrationStatements(readFileSync(ROOT+'migrations/'+n,'utf8')));
const expected=JSON.parse(JSON.stringify({sourceCommit:SOURCE,apiBundleSha256:sha(code),verifierBundleSha256:sha(verifier),wasmSha256:sha(wasm)}));
const report={...expected,decision:'NO_GO',freeCertified:false,scope:'NOT_EXECUTED',cases:[],blockers:[],cleanup:{},tail:[],cron:[],outboundPolicy:'BUILD_TIME_INJECTED_DENY_BY_DEFAULT'};
let stage='init';
async function fixture(sql,tag,rounds=100000,source='free',admin=false){
 const id='synthetic-'+tag,token=randomBytes(32).toString('hex'),ext=randomBytes(32).toString('hex'),now=Date.now();
 if(admin){await sql('DELETE FROM site_administrator WHERE id=1');await sql("UPDATE users SET role='user' WHERE role='admin'");}
 await sql('INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role,status) VALUES(?,?,?,?,?,?,?,?)',[id,id+'@example.test',1,1,id.replaceAll('-','_'),stored(rounds),admin?'admin':'user','active']);
 for(const [kind,t] of [['web',token],['extension',ext]])await sql('INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,?,?,?)',[id+'-'+kind,sha(t),id,kind,1,now+86400000]);
 await sql('INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,?,?,?,?)',[id,source==='paid'?0:200,source==='paid'?200:0,1,1]);
 await sql('INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES(?,?,?,?,?,?,?,?,?)',[id+'-batch',id,source==='paid'?'paid':'free',source==='paid'?'legacy_paid':'signup',200,200,1,'tracked','active']);
 if(admin)await sql('INSERT INTO site_administrator VALUES(1,?,1)',[id]);
 if(source==='subscription'){
  const start=now-2*86400000-10000;
  await sql("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES(?,?,'basic-v1','purchase',6990,'paid',1,9999999999999,1,1,?,?)",[id+'-order',id,now,now]);
  await sql("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,provider_trade_id,payment_channel,amount_fen,status,risk_state,created_at,updated_at,paid_at,merchant_account,notification_sign_type) VALUES(?,?,'mk99',?,'ALIPAY_H5',6990,'paid','clear',1,1,?,'synthetic-merchant','RSA2')",[id+'-txn',id+'-order',id+'-trade',now]);
  await sql("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,received_at,body_sha256) VALUES(?,?,'mk99',?,'PAYMENT_SUCCEEDED',6990,?,?)",[id+'-event',id+'-txn',id+'-event-key',now,'a'.repeat(64)]);
  await sql("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES(?,?,?,'basic-v1',500,'active',?,?,1,1)",[id+'-period',id,id+'-order',start,start+30*86400000]);
 }
 return {id,email:id+'@example.test',token,ext};
}
async function exercise({sql,send,origin,repeats}){
 for(const statement of schema)await sql(statement);
 await sql("UPDATE system_settings SET value='1' WHERE key IN ('ai_enabled','registration_enabled','purchase_enabled','payment_mk99_enabled','payment_mk99_wechat_enabled','payment_mk99_wechat_released')");
 await sql("UPDATE system_settings SET value='mk99' WHERE key='active_merchant'");
 await sql("UPDATE system_settings SET value='100000000' WHERE key='daily_cost_limit_micro_usd'");
 let n=0;
 async function request(scenario,path,{body,actor,ext=false,expect=200,raw=false,headers={}}={}){
  if(n>=850)throw Error('SYNTHETIC_REQUEST_CAP_EXCEEDED');
  const id='case-'+(++n),ip='192.0.2.'+(1+Math.floor(n/2)%250);
  const h={Origin:ext?EXT:WEB,'X-XRH-Test-Token':TOKEN,'X-XRH-Case':id,'X-XRH-Test-IP':ip,'Content-Type':'application/json',...headers};
  if(actor)Object.assign(h,ext?{Authorization:'Bearer '+actor.ext}:{Cookie:'rc_session='+actor.token,'X-Reply-Copilot-Action':'1','X-CSRF-Token':hmac('csrf:'+actor.token)});
  const r=await send(origin+path,{method:body===undefined?'GET':'POST',headers:h,...(body===undefined?{}:{body:raw?body:JSON.stringify(body)})});
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=null}
  report.cases.push({id,scenario,status:r.status,expected:expect,ok:r.status===expect,code:/^[A-Z_]{1,64}$/.test(data?.code||'')?data.code:null});
  if(r.status!==expect){if(process.argv[2]==='--offline'&&scenario==='payment-create-synthetic')console.log('SYNTHETIC_CHECKOUT_DIAGNOSTIC',data?.order?.checkout?.issue??'unknown');throw Error('CASE_FAILED_'+scenario.toUpperCase().replaceAll('-','_')+'_'+r.status);}
  return {data,text,code:r.headers.get('x-xrh-synthetic-code')};
 }
 for(let i=0;i<repeats;i++)for(const rounds of [10000,60000,100000,210000]){
  const a=await fixture(sql,'login-'+rounds+'-'+i,rounds);
  await request('login-'+rounds+'-wrong','/v1/auth/login',{body:{identity:a.email,password:'wrong-synthetic-password'},expect:401});
  await request('login-'+rounds+'-correct','/v1/auth/login',{body:{identity:a.email,password:PASS}});
  assert.equal((await sql('SELECT password_hash FROM users WHERE id=?',[a.id]))[0].password_hash,stored(rounds));
 }
 for(let i=0;i<repeats;i++){
  const a=await fixture(sql,'reset-'+i,210000),email='synthetic-register-'+i+'@example.test';
  const reg=await request('register','/v1/auth/register',{body:{email,username:'synthetic_register_'+i,password:PASS,turnstileToken:'synthetic-turnstile-token'}});
  assert.match(reg.code||'',/^\d{6}$/);
  await request('verify-registration','/v1/auth/verify-registration',{body:{email,code:reg.code}});
  const created=(await sql('SELECT u.id,c.free_balance FROM users u JOIN credit_accounts c ON c.user_id=u.id WHERE u.email=?',[email]))[0];assert.equal(created.free_balance,0);
  assert.equal((await sql('SELECT status FROM signup_benefit_claims WHERE user_id=?',[created.id]))[0].status,'pending');
  const reset=await request('reset-request','/v1/auth/request-password-reset',{body:{email:a.email}});assert.match(reset.code||'',/^\d{6}$/);
  await request('reset-password','/v1/auth/reset-password',{body:{email:a.email,code:reset.code,password:NEW}});
  assert.equal((await sql('SELECT COUNT(*) n FROM sessions WHERE user_id=? AND revoked_at IS NULL',[a.id]))[0].n,0);
 }
 for(const provider of ['legacy','managed']){
  if(provider==='managed'){
   const configId='synthetic-model',encrypted=await encryptProviderApiKey(MODEL_KEY,configId,1,'synthetic-model-key');
   const creator=(await sql('SELECT id FROM users ORDER BY id LIMIT 1'))[0].id;
   await sql("INSERT INTO ai_provider_configs(id,display_name,latest_version,created_at,updated_at,updated_by) VALUES(?,'Synthetic managed model',1,1,1,?)",[configId,creator]);
   await sql("INSERT INTO ai_provider_config_versions(config_id,version,provider,protocol,base_url,model_id,api_key_ciphertext,input_rate_micro_usd_per_million,output_rate_micro_usd_per_million,max_output_tokens,timeout_ms,options_json,endpoint_addresses_json,created_at,created_by) VALUES(?,1,'deepseek','openai_chat','https://api.deepseek.com/v1','synthetic-managed',?,300000,1320000,512,10000,'{}','[]',1,?)",[configId,encrypted,creator]);
   await sql("UPDATE ai_provider_runtime SET active_config_id=?,active_version=1 WHERE id=1",[configId]);
  }
  for(const source of ['free','paid','subscription'])for(let i=0;i<(source==='free'?Math.ceil(repeats*1.5):repeats);i++){
  const a=await fixture(sql,provider+'-'+source+'-'+i,100000,source),tag=source+'-'+provider;
  const requestId=randomUUID(),body={requestId,post:{text:'今天发布了一个新项目，具体来说是中文测试。',url:'https://x.com/example/status/123'},outputSchemaVersion:2};
  const gen=await request('generate-'+tag,'/v1/ai/generate',{body,actor:a,ext:true});
  assert.equal(typeof gen.data?.raw,'string');
  const output=JSON.parse(gen.data.raw);
  assert.equal(output.defaultStyle,'thoughtful');assert.equal(Object.hasOwn(output,'score'),false);
  assert.equal(gen.data.quota===undefined,source==='subscription');
  const replay=await request('replay-'+tag,'/v1/ai/generate',{body,actor:a,ext:true});
  assert.equal(replay.data.raw,gen.data.raw);
  await request('ack-'+tag,'/v1/ai/requests/'+requestId+'/delivered',{body:{requestId},actor:a,ext:true});
  const dup=await request('ack-replay-'+tag,'/v1/ai/requests/'+requestId+'/delivered',{body:{requestId},actor:a,ext:true});assert.equal(dup.data.alreadyConfirmed,true);
  await request('invalid-model-output-'+tag,'/v1/ai/generate',{body:{...body,requestId:randomUUID(),post:{text:'SYNTHETIC_INVALID_OUTPUT'}},actor:a,ext:true,expect:503});
  const usage=(await sql('SELECT COUNT(*) n,COALESCE(SUM(estimated_cost_micro_usd),0) cost FROM ai_usage_costs WHERE user_id=?',[a.id]))[0];
  assert.equal(usage.n,2);assert.ok(usage.cost>0);
  const bal=(await sql('SELECT free_balance,paid_balance,free_generation_reserved,paid_generation_reserved FROM credit_accounts WHERE user_id=?',[a.id]))[0];
  assert.deepEqual(bal,{free_balance:source==='free'?199:source==='paid'?0:200,paid_balance:source==='paid'?199:0,free_generation_reserved:0,paid_generation_reserved:0});
  if(source==='subscription')assert.equal((await sql('SELECT COALESCE(SUM(used),0) n FROM subscription_daily_usage WHERE period_id=?',[a.id+'-period']))[0].n,1);
 }
 }
 for(let i=0;i<repeats;i++){
 const a=await fixture(sql,'admin-'+i,210000,'free',true);
 for(const [scenario,path,ext] of [['me','/v1/me',false],['usage','/v1/usage',false],['entitlements','/v1/entitlements',false],['bootstrap','/v1/extension/bootstrap',true],['admin-read','/v1/admin/dashboard',false]])await request(scenario,path,{actor:a,ext});
 await request('admin-reauth','/v1/admin/reauth',{body:{password:PASS},actor:a});
 await request('admin-password-change','/v1/admin/security/password',{body:{operationId:randomUUID(),reason:'Synthetic administrator password change',oldPassword:PASS,newPassword:NEW,confirmPassword:NEW},actor:a});
 assert.equal((await sql('SELECT COUNT(*) n FROM admin_audit_logs WHERE action=?',['security_password']))[0].n,i+1);
 }
 for(let i=0;i<repeats;i++){
 const p=await fixture(sql,'payment-'+i);
 await request('payment-create-synthetic','/v1/orders',{body:{packageId:'starter',provider:'mk99',channel:'WECHAT_H5'},actor:p,expect:201});
 const t=(await sql("SELECT t.provider_trade_id,t.amount_fen FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE o.user_id=?",[p.id]))[0];
 const fields={pid:'20881234567890',trade_no:'SYN_'+t.provider_trade_id,out_trade_no:t.provider_trade_id,total_amount:(t.amount_fen/100).toFixed(2),subject:'400次',paytype_code:'wxpay',channel_id:'1',trade_status:'TRADE_SUCCESS',timestamp:String(Math.floor(Date.now()/1000)),sign_type:'RSA'};
 const canonical=Object.entries(fields).filter(([k,v])=>!['sign','sign_type'].includes(k)&&v!=='').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('&');
 fields.sign=sign('RSA-SHA256',Buffer.from(canonical),rsa.privateKey).toString('base64');
 for(const scenario of ['payment-webhook-synthetic','payment-replay-synthetic']){
  const r=await request(scenario,'/v1/payments/mk99/notify',{body:new URLSearchParams(fields),raw:true,headers:{'Content-Type':'application/x-www-form-urlencoded'}});assert.equal(r.text,'success');
 }
 assert.equal((await sql("SELECT COUNT(*) n FROM credit_ledger WHERE user_id=? AND kind='purchase_grant'",[p.id]))[0].n,1);
 assert.equal((await sql('SELECT paid_balance FROM credit_accounts WHERE user_id=?',[p.id]))[0].paid_balance,400);
 }
 assert.equal((await sql('SELECT COALESCE(SUM(reserved_micro_usd),0) n FROM ai_budget_days'))[0].n,0);
 await request('cleanup-http-not-cron','/__synthetic_cleanup',{body:{}});
}
async function offline(){
 report.scope='LOCAL_WORKERD_ONLY';
 const origin='https://isolated-api.example.test',env=Object.fromEntries(Object.entries(vars(origin)).map(([k,v])=>[k,{type:'text',value:v}]));
 env.DB={type:'d1',id:'synthetic-business-cloud-rehearsal'};env.PASSWORD_VERIFY_DO={type:'durable-object',worker:OWNER,exportName:'PasswordVerifierDO'};
 let escaped=0;const deny=()=>{escaped++;throw Error('NETWORK_ESCAPE');};
 const mf=new Miniflare({workers:[
 {config:{name:NAME,compatibilityDate:'2026-10-14',env,manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:code}}}},dev:{outboundService:{type:'fetcher',handler:deny}}},
 {config:{name:OWNER,compatibilityDate:'2026-10-14',env:{PASSWORD_PEPPER:{type:'text',value:PEPPER}},exports:{PasswordVerifierDO:{type:'durable-object',storage:'sqlite'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:verifier},'legacy-210k.wasm':{type:'wasm',contents:new Uint8Array(wasm)}}}},dev:{outboundService:{type:'fetcher',handler:deny}}}
 ]});
 try{const db=await mf.getD1Database('DB',NAME);await exercise({origin,repeats:10,send:(...args)=>mf.dispatchFetch(...args),sql:async(s,p=[])=> (await db.prepare(s).bind(...p).all()).results});assert.equal(escaped,0);assert.equal(report.cases.length,571);}finally{await mf.dispose();}
}
async function cloud(){
 if(process.env.XRH_CLOUD_AUTHORIZATION!=='20261126-isolated-synthetic-business-only'||(process.env.CF_FREE_PILOT_API_TOKEN||'').length<20)throw Error('MISSING_EXPLICIT_AUTHORIZATION');
 const token=process.env.CF_FREE_PILOT_API_TOKEN,base='/accounts/'+ACCOUNT,apiRoot='https://api.cloudflare.com/client/v4';
 let dbId=null,preflight=false,ownerStarted=false,apiStarted=false,tailId=null,ws=null,cronStarted=false;
 report.tailConnections=[];
 let sent=0;
 async function cf(method,path,body){
  if(path!=='/accounts?page=1&per_page=50'&&!path.startsWith(base+'/'))throw Error('WRONG_ACCOUNT');
  const h={Authorization:'Bearer '+token};if(body!==undefined&&!(body instanceof FormData))h['Content-Type']='application/json';
  const r=await fetch(apiRoot+path,{method,headers:h,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(45000)});
  if(r.status===204)return null;
  const d=await r.json();if(!r.ok||!d.success)throw Error('CF_'+method+'_'+r.status);
  if(Array.isArray(d.result)&&(d.result_info?.total_pages>1||d.result_info?.total_count>d.result.length))throw Error('INCOMPLETE_INVENTORY');
  return d.result;
 }
 const workers=base+'/workers/scripts',dbs=base+'/d1/database',namespaces=base+'/workers/durable_objects/namespaces';
 const origin='https://'+NAME+'.'+SUB+'.workers.dev';
 async function upload(name,bundle,bindings,extra={},binary=null){
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:'index.js',compatibility_date:'2026-10-14',bindings,observability:{enabled:false},...extra})],{type:'application/json'}));
  form.set('index.js',new Blob([bundle],{type:'application/javascript+module'}),'index.js');if(binary)form.set('legacy-210k.wasm',new Blob([binary],{type:'application/wasm'}),'legacy-210k.wasm');
  await cf('PUT',workers+'/'+name,form);
 }
 const secret=(name,text)=>({name,type:'secret_text',text});
  async function closeTail(){
   if(ws){ws.terminate();ws=null;}
   if(tailId){await cf('DELETE',workers+'/'+NAME+'/tails/'+tailId);tailId=null;}
  }
 try{
  stage='cloud-preflight';const accounts=await cf('GET','/accounts?page=1&per_page=50');
  assert.equal(accounts.length,1);assert.equal(accounts[0].id,ACCOUNT);assert.equal(accounts[0].name,ACCOUNT_NAME);
  assert.equal((await cf('GET',workers)).length,0);assert.equal((await cf('GET',namespaces)).length,0);assert.equal((await cf('GET',dbs)).length,0);
  assert.equal((await cf('GET',base+'/workers/subdomain')).subdomain,SUB);
  preflight=true;report.scope='ISOLATED_CLOUD_SYNTHETIC';report.planAttested=false;report.startedAt=new Date().toISOString();
  stage='create-d1';const db=await cf('POST',dbs,{name:NAME});dbId=db.uuid;report.databaseId=dbId;assert.match(dbId,/^[a-f0-9-]{36}$/i);
  assert.ok((await cf('GET',dbs)).some(x=>x.uuid===dbId&&x.name===NAME));
  const sql=async(s,p=[])=>{const r=await cf('POST',dbs+'/'+dbId+'/query',{sql:s,params:p});assert.equal(r.length,1);assert.equal(r[0].success,true);return r[0].results||[];};
  stage='deploy-private';ownerStarted=true;await upload(OWNER,verifier,[secret('PASSWORD_PEPPER',PEPPER)],{migrations:{new_tag:'private-v1',new_sqlite_classes:['PasswordVerifierDO']}},wasm);
  await cf('POST',workers+'/'+OWNER+'/subdomain',{enabled:false,previews_enabled:false});
  const ns=await cf('GET',namespaces);assert.equal(ns.length,1);assert.equal(ns[0].script,OWNER);assert.equal(ns[0].class,'PasswordVerifierDO');assert.equal(ns[0].use_sqlite,true);report.namespaceId=ns[0].id;assert.match(report.namespaceId,/^[0-9a-f]{32}$/i);
  stage='deploy-api';apiStarted=true;await upload(NAME,code,[...Object.entries(vars(origin)).map(([k,v])=>secret(k,v)),{name:'DB',type:'d1',id:dbId},{name:'PASSWORD_VERIFY_DO',type:'durable_object_namespace',class_name:'PasswordVerifierDO',script_name:OWNER}],{observability:{enabled:true,head_sampling_rate:1,logs:{enabled:true,invocation_logs:true,head_sampling_rate:1}}});
  await cf('POST',workers+'/'+NAME+'/subdomain',{enabled:true,previews_enabled:false});
  const binding=await cf('GET',workers+'/'+NAME+'/settings');assert.ok(binding.bindings.some(x=>x.name==='DB'&&x.id===dbId));assert.ok(binding.bindings.some(x=>x.name==='PASSWORD_VERIFY_DO'&&x.type==='durable_object_namespace'));
  const deployments=await cf('GET',workers+'/'+NAME+'/deployments');report.cloudVersion=deployments.deployments?.[0]?.versions?.[0]?.version_id??null;
  assert.match(report.cloudVersion,/^[a-f0-9-]{36}$/i);
  report.observabilityConfigured=binding.observability?.enabled===true&&binding.observability?.logs?.invocation_logs===true;
  if(!report.observabilityConfigured)report.blockers.push('OBSERVABILITY_SETTINGS_UNVERIFIED');
  // Official control-plane analytics, scoped by immutable deployment version.
  // Aggregates are separate evidence, never synthetic per-case measurements.
  async function cronAnalytics(){
   const query='query{viewer{accounts(filter:{accountTag:"'+ACCOUNT+'"}){w:workersInvocationsAdaptive(limit:20,filter:{date_geq:"'+report.startedAt.slice(0,10)+'",date_leq:"'+new Date().toISOString().slice(0,10)+'",scriptVersion:"'+report.cloudVersion+'",eventType:"cron"}){dimensions{scriptVersion eventType status} sum{requests errors} quantiles{cpuTimeP95} max{cpuTime}}}}}';
   const r=await fetch(apiRoot+'/graphql',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw Error('CRON_GRAPHQL_UNAVAILABLE');
   const d=await r.json(),rows=d.data?.viewer?.accounts?.[0]?.w;
   if(d.errors?.length||!Array.isArray(rows))throw Error('CRON_GRAPHQL_INVALID');
   if(rows.some(x=>x.dimensions.scriptVersion!==report.cloudVersion||x.dimensions.eventType!=='cron'||!Number.isSafeInteger(x.sum.requests)||x.sum.requests<0||!Number.isSafeInteger(x.sum.errors)||x.sum.errors<0||!Number.isFinite(x.max.cpuTime)||x.max.cpuTime<0))throw Error('CRON_GRAPHQL_INVALID');
   const count=rows.reduce((n,x)=>n+x.sum.requests,0);
   return {source:'CLOUDFLARE_GRAPHQL_VERSION_AGGREGATE',version:report.cloudVersion,requests:count,errors:rows.reduce((n,x)=>n+x.sum.errors,0),allSuccess:rows.length>0&&rows.every(x=>x.dimensions.status==='success'),maxCpuMs:rows.length?Math.max(...rows.map(x=>x.max.cpuTime))/1000:null,p95CpuMs:rows.length===1?rows[0].quantiles.cpuTimeP95/1000:null};
  }
  async function storedTelemetry(){
   const path=base+'/workers/observability/telemetry/query',all=[],ids=new Set();
   let offset,complete=false;
   for(let page=0;page<4;page++){
    const result=await cf('POST',path,{queryId:'xrh-isolated-'+NAME,dry:true,view:'events',limit:2000,timeframe:{from:Date.parse(report.startedAt),to:Date.now()},parameters:{filters:[{key:'$metadata.service',operation:'eq',type:'string',value:NAME}]},...(offset?{offset,offsetDirection:'next'}:{})});
    const list=result?.events?.events;
    if(!Array.isArray(list))throw Error('TELEMETRY_SHAPE_INVALID');
    for(const e of list){const id=e?.$metadata?.id;if(typeof id!=='string'||ids.has(id))throw Error('TELEMETRY_DUPLICATE_EVENT');ids.add(id);all.push(e);}
    if(list.length<2000){complete=true;break;}
    offset=list.at(-1)?.$metadata?.id;if(!offset)break;
   }
   // Only safe invocation/case associations are retained; raw event data,
   // headers, URLs, messages and request IDs never enter the artifact.
   const safe=correlateInvocationLogs(all,{script:NAME,version:report.cloudVersion,cases:report.cases});
   return {...safe,complete,pagesEventCount:all.length,source:'CLOUDFLARE_STORED_INVOCATION_LOGS'};
  }
  async function openTail(){
   if(ws||tailId)await closeTail();
   try{
   const t=await cf('POST',workers+'/'+NAME+'/tails',{filters:[]});tailId=t.id;assert.match(tailId,/^[a-f0-9]{32}$/i);
   const url=new URL(t.url);assert.equal(url.protocol,'wss:');assert.equal(url.username,'');assert.equal(url.password,'');
   const connection={afterSent:sent,frames:0,matched:0,closed:false};report.tailConnections.push(connection);
   ws=new WebSocket(url.toString(),'trace-v1');ws.on('close',()=>{connection.closed=true;});ws.on('message',buf=>{connection.frames++;try{for(const e of [JSON.parse(buf.toString())].flat()){
    const marker=e.logs?.map(l=>l.message?.[0]).find(m=>m&&typeof m==='object'&&/^case-\d{1,4}$/.test(m.xrhAcceptanceCase||''));
    const cron=e.logs?.map(l=>l.message?.[0]).find(m=>m&&typeof m==='object'&&Number.isSafeInteger(m.xrhAcceptanceCron));
    const eventCpu=e.cpuTime??e.cpuTimeMs;
    if(e.scriptName===NAME&&cron&&Number.isSafeInteger(cron.xrhAcceptanceCron)&&report.cron.length<40){
     report.cron.push({scheduledTime:cron.xrhAcceptanceCron,cpuMs:typeof eventCpu==='number'&&Number.isFinite(eventCpu)&&eventCpu>=0?eventCpu:null,outcome:['ok','exception','exceededCpu','exceededMemory'].includes(e.outcome)?e.outcome:'other'});
    }
    if(e.scriptName===NAME&&/^case-\d{1,4}$/.test(marker?.xrhAcceptanceCase||'')&&report.tail.length<1000){
     connection.matched++;const cpu=e.cpuTime??e.cpuTimeMs;report.tail.push({id:marker.xrhAcceptanceCase,cpuMs:typeof cpu==='number'&&Number.isFinite(cpu)&&cpu>=0?cpu:null,outcome:['ok','exception','exceededCpu','exceededMemory'].includes(e.outcome)?e.outcome:'other'});
    }
   }}catch{}});
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('TAIL_TIMEOUT')),10000);ws.once('open',()=>{clearTimeout(timer);ws.send(JSON.stringify({debug:false}),{mask:false,compress:false});resolve()});ws.once('error',()=>{clearTimeout(timer);reject(Error('TAIL_ERROR'))})});
   }catch{report.blockers.push('TAIL_UNAVAILABLE');try{await closeTail();}catch{report.blockers.push('TAIL_CLEANUP_FAILED');}}
  }
  stage='tail';await openTail();
  stage='exercise';await exercise({sql,origin,repeats:10,send:async(url,init)=>{
   if(new URL(url).origin!==origin)throw Error('WRONG_TARGET');
   // Keep telemetry bounded and rotate live sessions periodically. No request
   // is replayed merely to fill a missing sample; missing evidence remains a blocker.
   if(sent>0&&(sent%100===0||ws?.readyState!==WebSocket.OPEN)){
    await new Promise(resolve=>setTimeout(resolve,1500));await openTail();
   }
   sent++;
   const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});
   await new Promise(resolve=>setTimeout(resolve,350));
   return response;
  }});
  assert.equal(report.cases.length,571);
  stage='real-cron';
  const expiredId='synthetic-cron-expired',cronUser=(await sql('SELECT id FROM users ORDER BY id LIMIT 1'))[0].id;
  await sql("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'web',1,?)",[expiredId,sha(randomBytes(32)),cronUser,Date.now()-2*86400000]);
  try{
   cronStarted=true;
   await cf('PUT',workers+'/'+NAME+'/schedules',[{cron:'* * * * *'}]);
   const schedules=await cf('GET',workers+'/'+NAME+'/schedules');
   assert.ok((Array.isArray(schedules)?schedules:schedules.schedules||[]).some(x=>x.cron==='* * * * *'));
   const deadline=Date.now()+25*60000;
   let deleted=false,lastAnalytics=0;
   while(Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,15000));
    if(ws?.readyState!==WebSocket.OPEN)await openTail();
    deleted=(await sql('SELECT COUNT(*) n FROM sessions WHERE id=?',[expiredId]))[0].n===0;
    if(Date.now()-lastAnalytics>=60000){lastAnalytics=Date.now();try{report.cronAnalytics=await cronAnalytics();}catch{}}
    if(deleted&&(new Set(report.cron.filter(x=>x.outcome==='ok'&&x.cpuMs!==null).map(x=>x.scheduledTime)).size>=10||report.cronAnalytics?.requests>=10))break;
   }
   report.cronCleanupVerified=deleted;
   if(!deleted||new Set(report.cron.filter(x=>x.outcome==='ok'&&x.cpuMs!==null).map(x=>x.scheduledTime)).size<10)report.blockers.push('REAL_CRON_EVIDENCE_INCOMPLETE');
  }catch{report.blockers.push('REAL_CRON_FAILED_OR_UNAVAILABLE');}
  stage='stored-observability';
  try{
   report.storedTelemetry=await storedTelemetry();
   if(!report.storedTelemetry.complete||report.storedTelemetry.samples.length!==report.cases.length)report.blockers.push('STORED_TELEMETRY_COVERAGE_INCOMPLETE');
  }catch(e){report.blockers.push('STORED_TELEMETRY_UNAVAILABLE');report.storedTelemetry={error:/^CF_POST_[0-9]{3}$/.test(e.message)?e.message:'TELEMETRY_QUERY_FAILED'};}
  try{report.cronAnalytics=await cronAnalytics();}catch{report.blockers.push('CRON_VERSION_ANALYTICS_UNAVAILABLE');}
  if(report.cronAnalytics?.requests>=10&&report.cronAnalytics.allSuccess&&report.cronAnalytics.errors===0&&report.cronCleanupVerified===true){
   if(report.cronAnalytics.maxCpuMs>8||(report.cronAnalytics.p95CpuMs!==null&&report.cronAnalytics.p95CpuMs>5))report.blockers.push('CRON_VERSION_CPU_MARGIN_EXCEEDED');
  }else report.blockers.push('CRON_VERSION_ANALYTICS_INCOMPLETE');
  // Read analytics while the exact namespace is still present. Never replace
  // missing billing rows with zeros or infer duration from HTTP wall time.
  stage='do-analytics';
  try{
   const nsId=report.namespaceId,start=report.startedAt.slice(0,10),end=new Date().toISOString().slice(0,10);
   const filter='date_geq:"'+start+'",date_leq:"'+end+'",namespaceId:"'+nsId+'"';
   const query='query {viewer{accounts(filter:{accountTag:"'+ACCOUNT+'"}){i:durableObjectsInvocationsAdaptiveGroups(limit:10,filter:{'+filter+'}){sum{requests errors} quantiles{cpuTimeP95 cpuTimeP99}} p:durableObjectsPeriodicGroups(limit:10,filter:{'+filter+'}){sum{duration rowsRead rowsWritten cpuTime exceededCpuErrors exceededMemoryErrors fatalInternalErrors}} s:durableObjectsSqlStorageGroups(limit:10,filter:{'+filter+'}){max{storedBytes}}}}}';
   const response=await fetch(apiRoot+'/graphql',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error('DO_GRAPHQL_HTTP_'+response.status);
   const data=await response.json(),a=data.data?.viewer?.accounts?.[0];
   if(data.errors?.length||!a)throw Error('DO_GRAPHQL_UNAVAILABLE');
   report.doAnalytics={namespaceId:nsId,source:'CLOUDFLARE_DO_ANALYTICS_LIVE_NAMESPACE',dateStart:start,dateEnd:end,capturedAt:new Date().toISOString(),invocations:a.i,periodic:a.p,storage:a.s};
   if(a.i?.length!==1||a.p?.length!==1||a.s?.length!==1||!(a.i[0]?.sum?.requests>0))report.blockers.push('DO_BILLING_GROUPS_INCOMPLETE');
  }catch{report.blockers.push('DO_BILLING_EVIDENCE_UNAVAILABLE');}
  report.blockers.push('PLAN_NOT_INDEPENDENTLY_ATTESTED','THREE_COMPLETE_UTC_DAYS_REQUIRED','PAID_ROLLBACK_NOT_REHEARSED','DO_BILLING_EVIDENCE_INDEPENDENTLY_REQUIRED');
 }finally{
  if(cronStarted)try{await cf('PUT',workers+'/'+NAME+'/schedules',[]);}catch{report.blockers.push('CRON_DISABLE_FAILED')}
  if(ws||tailId)try{await closeTail();}catch{report.blockers.push('TAIL_CLEANUP_FAILED')}
  if(preflight){
   // Delete only exact names created in this one-shot run. Never force-delete an unrelated script.
   for(const [name,started] of [[NAME,apiStarted],[OWNER,ownerStarted]])if(started)try{if((await cf('GET',workers)).some(x=>x.id===name))await cf('DELETE',workers+'/'+name+'?force=false')}catch{report.blockers.push('WORKER_CLEANUP_FAILED')}
   try{const list=await cf('GET',dbs);const match=list.find(x=>x.name===NAME);if(match&&(!dbId||match.uuid===dbId))await cf('DELETE',dbs+'/'+match.uuid);}catch{report.blockers.push('D1_CLEANUP_FAILED')}
   for(let attempt=0;attempt<6;attempt++){
    try{report.cleanup={workers:(await cf('GET',workers)).length,do:(await cf('GET',namespaces)).length,d1:(await cf('GET',dbs)).length};
      if(Object.values(report.cleanup).every(x=>x===0))break;
    }catch{}
    if(attempt<5)await new Promise(resolve=>setTimeout(resolve,3000));
   }
   if(!Object.keys(report.cleanup).length)report.blockers.push('CLEANUP_INVENTORY_UNAVAILABLE');
   else if(Object.values(report.cleanup).some(x=>x!==0))report.blockers.push('CLEANUP_NOT_CONFIRMED');
  }
 }
}
const mode=process.argv[2],out=process.argv[3];
try{if(mode==='--offline'){stage='offline-exercise';await offline();}else if(mode==='--authorized-cloud')await cloud();else throw Error('MODE_REQUIRED');report.behaviorPassed=true;}catch(e){report.behaviorPassed=false;report.failedStage=stage;report.blockers.push(/^[A-Z0-9_]{3,100}$/.test(e.message)?e.message:'ASSERTION_OR_RUNTIME_FAILURE');if(mode==='--offline')console.error(e);process.exitCode=2;}
finally{
 report.finishedAt=new Date().toISOString();
 if(report.scope==='ISOLATED_CLOUD_SYNTHETIC'){
  report.routeCpu=Object.entries(Object.groupBy(report.cases,c=>c.scenario)).map(([scenario,cases])=>{
   const ids=new Set(cases.map(c=>c.id)),byId=new Map(report.tail.filter(t=>ids.has(t.id)&&t.cpuMs!==null&&t.outcome==='ok').map(t=>[t.id,t.cpuMs]));
   const values=[...byId.values()].sort((a,b)=>a-b),p95=values[Math.ceil(values.length*.95)-1]??null,max=values.at(-1)??null;
   if(values.length<10||values.length!==cases.length)report.blockers.push('CPU_COVERAGE_INCOMPLETE:'+scenario);
   if(max!==null&&(max>8||p95>5))report.blockers.push('CPU_MARGIN_EXCEEDED:'+scenario);
   return {scenario,cases:cases.length,cpuSamples:values.length,p95CpuMs:p95,maxCpuMs:max};
  });
  const cronValues=report.cron.filter(c=>c.outcome==='ok'&&c.cpuMs!==null).map(c=>c.cpuMs).sort((a,b)=>a-b);
  report.cronCpu={samples:cronValues.length,maxCpuMs:cronValues.at(-1)??null,p95CpuMs:cronValues[Math.ceil(cronValues.length*.95)-1]??null};
  if(cronValues.length<10)report.blockers.push('CRON_CPU_COVERAGE_INCOMPLETE');
  if(cronValues.at(-1)>8||report.cronCpu.p95CpuMs>5)report.blockers.push('CRON_CPU_MARGIN_EXCEEDED');
 }
 if(out)writeFileSync(out,JSON.stringify(report,null,2));console.log('XRH_BUSINESS_ACCEPTANCE '+JSON.stringify({scope:report.scope,sourceCommit:report.sourceCommit,behaviorPassed:report.behaviorPassed,failedStage:report.failedStage,cases:report.cases.length,failures:report.cases.filter(x=>!x.ok),blockers:report.blockers,cleanup:report.cleanup,tailSamples:report.tail.length,tailConnections:report.tailConnections,cronCpu:report.cronCpu,cronAnalytics:report.cronAnalytics,storedTelemetrySamples:report.storedTelemetry?.samples?.length,storedTelemetryError:report.storedTelemetry?.error,routeCpu:report.routeCpu}));}
