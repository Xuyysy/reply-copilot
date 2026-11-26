// Offline-only diagnostic. No cloud code, credentials or remote resource creation.
import {build,buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
import {createHash,createHmac,pbkdf2Sync,randomBytes,randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {migrationStatements} from '../lib/workerd-cpu-evidence.mjs';
import {encryptProviderApiKey} from '../../src/ai-model-crypto.js';
const SOURCE='f30589a87b6f60a4eb93e1074b6a240ec2cdb8ae',NAME='xrh-local-budget',OWNER=NAME+'-verifier';
const mode=process.argv[2],out=process.argv[3];
assert.ok(['select','legacy'].includes(mode)&&out);
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const WEB='https://isolated-web.example.test',EXT='chrome-extension://'+'a'.repeat(32);
const PASS='SyntheticBusinessPassword123!',NEW='SyntheticNewPassword456!';
const AUTH='synthetic-only-auth-'+randomBytes(24).toString('hex'),PEPPER='synthetic-only-pepper-'+randomBytes(24).toString('hex'),TOKEN=randomBytes(32).toString('hex');
const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),MODEL_KEY=randomBytes(32).toString('base64');
const sha=x=>createHash('sha256').update(x).digest('hex');
const hmac=x=>createHmac('sha256',AUTH).update(x).digest('hex');
const stored=(rounds,password=PASS)=>'pbkdf2-sha256:'+rounds+':'+('ab'.repeat(16))+':'+pbkdf2Sync(password+'\0'+PEPPER,Buffer.alloc(16,0xab),rounds,32,'sha256').toString('hex');
const api=await build({entryPoints:[ROOT+'scripts/cf-free-invocation-budget/worker.mjs'],inject:[ROOT+'scripts/cf-free-invocation-budget/mock-fetch.mjs'],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',metafile:true,plugins:[{name:'synthetic-egress-explicit-global-fetch',setup(b){b.onLoad({filter:/\.[cm]?[jt]s$/},args=>{if(!args.path.startsWith(ROOT+'src/'))return;const source=readFileSync(args.path,'utf8');return {contents:source.replace(/globalThis\.fetch\b/g,'fetch'),loader:args.path.endsWith('.ts')?'ts':'js'};});}}]});
const verifier=buildSync({entryPoints:[ROOT+'prototypes/cf-free-private-verifier/src/index.ts'],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',external:['cloudflare:workers','./legacy-210k.wasm']}).outputFiles[0].text;
const wasm=readFileSync(ROOT+'prototypes/cf-free-private-verifier/src/legacy-210k.wasm');
assert.equal(sha(wasm),'2d34ed3d829ebff018cf3afaba063c9cfd90d14b00db938d082fa862e74ce838');
const code=api.outputFiles[0].text;
assert.ok(code.includes('SYNTHETIC_OUTBOUND_DENIED'));
assert.doesNotMatch(code,/globalThis\s*\.\s*fetch\b|globalThis\s*\[\s*['"]fetch['"]\s*\]/,'unmocked global network access');
const vars=origin=>({ENVIRONMENT:'production',API_ORIGIN:origin,WEB_ORIGIN:WEB,EXTENSION_ORIGIN:EXT,
 AUTH_HASH_SECRET:AUTH,PASSWORD_PEPPER:PEPPER,ACCEPTANCE_TOKEN:TOKEN,PASSWORD_VERIFY_DO_ENABLED:'1',
 PASSWORD_FREE_CPU_ENABLED:'0',PASSWORD_FREE_TINY_CPU_ENABLED:'0',PASSWORD_LEGACY_MIGRATION_ENABLED:'0',
 CF_FREE_ZERO_WRITE_ASSERTIONS:mode==='select'?'1':'0',AI_MODE:'production',DEEPSEEK_API_KEY:'synthetic-model-key',AI_CONFIG_ENCRYPTION_KEY:MODEL_KEY,
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
 await sql('INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role,status) VALUES(?,?,?,?,?,?,?,?)',[id,id+'@example.test',1,1,id.replaceAll('-','_'),stored(rounds),admin?'admin':'user','active']);
 for(const [kind,t] of [['web',token],['extension',ext]])await sql('INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,?,?,?)',[id+'-'+kind,sha(t),id,kind,1,now+86400000]);
 await sql('INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,?,?,?,?)',[id,source==='paid'?0:200,source==='paid'?200:0,1,1]);
 await sql('INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES(?,?,?,?,?,?,?,?,?)',[id+'-batch',id,source==='paid'?'paid':'free',source==='paid'?'legacy_paid':'signup',200,200,1,'tracked','active']);
 if(admin){await sql('DELETE FROM site_administrator WHERE id=1');await sql('INSERT INTO site_administrator VALUES(1,?,1)',[id]);}
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
  const tally=JSON.parse(r.headers.get('x-xrh-local-budget')||'null');
  assert.ok(tally&&['d1Calls','d1Statements','externalCalls','doCalls','batchRowsRead','batchRowsWritten','standaloneRowsWritten','standaloneRowsRead','standaloneMetadataMissing'].every(k=>Number.isSafeInteger(tally[k])&&tally[k]>=0));
  assert.equal(tally.d1Calls<=tally.d1Statements,true);
  report.cases.push({id,scenario,status:r.status,expected:expect,ok:r.status===expect,tally});
  assert.ok(tally.d1Calls<=50&&tally.externalCalls<=50&&tally.d1Calls+tally.doCalls<=1000,'INVOCATION_RESOURCE_LIMIT');
  if(tally.d1Calls+tally.externalCalls+tally.doCalls>50||tally.d1Statements>50)report.blockers.push('CONSERVATIVE_ENGINEERING_BUDGET:'+scenario);
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
 report.scope='LOCAL_INSTRUMENTED_WORKERD_ONLY';report.assertionMode=mode;
 const origin='https://isolated-api.example.test',env=Object.fromEntries(Object.entries(vars(origin)).map(([k,v])=>[k,{type:'text',value:v}]));
 env.DB={type:'d1',id:'synthetic-business-cloud-rehearsal'};env.PASSWORD_VERIFY_DO={type:'durable-object',worker:OWNER,exportName:'PasswordVerifierDO'};
 let escaped=0;const deny=()=>{escaped++;throw Error('NETWORK_ESCAPE');};
 const mf=new Miniflare({workers:[
 {config:{name:NAME,compatibilityDate:'2026-10-14',env,manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:code}}}},dev:{outboundService:{type:'fetcher',handler:deny}}},
 {config:{name:OWNER,compatibilityDate:'2026-10-14',env:{PASSWORD_PEPPER:{type:'text',value:PEPPER}},exports:{PasswordVerifierDO:{type:'durable-object',storage:'sqlite'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:verifier},'legacy-210k.wasm':{type:'wasm',contents:new Uint8Array(wasm)}}}},dev:{outboundService:{type:'fetcher',handler:deny}}}
 ]});
 try{const db=await mf.getD1Database('DB',NAME);await exercise({origin,repeats:3,send:(...args)=>mf.dispatchFetch(...args),sql:async(s,p=[])=> (await db.prepare(s).bind(...p).all()).results});assert.equal(escaped,0);}finally{await mf.dispose();}
}

try{await offline();report.behaviorPassed=true;}catch(e){report.behaviorPassed=false;console.error(e);process.exitCode=2;}
finally{
 report.routeBudget=Object.entries(Object.groupBy(report.cases,c=>c.scenario)).map(([scenario,cases])=>{
  const keys=Object.keys(cases[0].tally),maxima=Object.fromEntries(keys.map(k=>[k,Math.max(...cases.map(c=>c.tally[k]))]));
  return {scenario,cases:cases.length,maxima,totals:Object.fromEntries(keys.map(k=>[k,cases.reduce((sum,c)=>sum+c.tally[k],0)]))};
 });
 report.blockers=[...new Set(report.blockers)];
 writeFileSync(out,JSON.stringify(report,null,2));
 console.log('XRH_LOCAL_INVOCATION_BUDGET '+JSON.stringify({sourceCommit:SOURCE,scope:report.scope,mode,behaviorPassed:report.behaviorPassed,cases:report.cases.length,blockers:report.blockers,routeBudget:report.routeBudget}));
}
