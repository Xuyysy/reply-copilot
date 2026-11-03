import {Miniflare} from 'miniflare';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,createHmac,pbkdf2Sync,generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {encryptProviderApiKey} from '../../src/ai-model-crypto.js';
const root=new URL('../../',import.meta.url);
export const TOKEN='b'.repeat(64),EXT='c'.repeat(64),SECRET='synthetic-profile-auth-secret-32-characters',PASSWORD='Synthetic-password-only-123';
export const output=JSON.stringify({recommendation:'reply',defaultStyle:'natural',language:'en',replies:{natural:'That small detail changes how I read this.',light_humor:'My spreadsheet has filed a formal objection.',thoughtful:'I wonder whether the same tradeoff holds at a smaller scale.'},reason:'A conversational reply fits.',quoteCandidate:null});
export async function runtime({history=1000,referenceSql=false}={}){
 const now=Date.now(),source=(await build({stdin:{contents:`import app from './src/index.ts';import {cleanup} from './src/cleanup.ts';import {hmac} from './src/security.ts';import {releaseExpiredDeliveryReservations} from './src/quota.ts';import {meteredD1} from './scripts/lib/metered-d1.js';export default {async fetch(req,env){const p=new URL(req.url).pathname;if(p==='/__profile/expire'){const metrics={queries:0,rowsRead:0,rowsWritten:0};await releaseExpiredDeliveryReservations({...env,DB:meteredD1(env.DB,metrics)},Date.now(),new URL(req.url).searchParams.has('scoped')?'profile-user':undefined);return Response.json(metrics)}if(p==='/__profile/cron'){await cleanup(env);return new Response('ok')}if(p==='/__profile/hmac'){for(let i=0;i<20;i++)await hmac(env,'synthetic:'+i);return new Response('ok')}if(p==='/__profile/wait'){await new Promise(r=>setTimeout(r,50));return new Response('ok')}if(new URL(req.url).searchParams.has('__meter')){const metrics={queries:0,rowsRead:0,rowsWritten:0};const res=await app.fetch(req,{...env,DB:meteredD1(env.DB,metrics)});const h=new Headers(res.headers);h.set('X-Isolated-Metrics',JSON.stringify(metrics));return new Response(res.body,{status:res.status,headers:h})}return app.fetch(req,env)}}`,resolveDir:new URL('../..',import.meta.url).pathname,sourcefile:'isolated-profile-entry.ts'},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',plugins:referenceSql?[{name:'reference-sql',setup(b){b.onLoad({filter:/ai-cost-queries\.js$/},()=>({contents:'export const COST_HISTORY_SQL='+JSON.stringify(readFileSync(new URL('../../tests/fixtures/model-cost-before.sql',import.meta.url),'utf8'))+';',loader:'js'}))}}]:[]})).outputFiles[0].text;
 const values={ENVIRONMENT:'production',WEB_ORIGIN:'https://app.profile.example',API_ORIGIN:'https://api.profile.example',EXTENSION_ORIGIN:'chrome-extension://'+'a'.repeat(32),AUTH_HASH_SECRET:SECRET,PASSWORD_PEPPER:'synthetic-pepper-profile-only-32-chars',AI_MODE:'production',ADMIN_PORTAL_ENABLED:'1',PAYMENTS_ENABLED:'0',DEEPSEEK_API_KEY:'synthetic-local-provider-key',DEEPSEEK_INPUT_USD_PER_MILLION:'0.30',DEEPSEEK_OUTPUT_USD_PER_MILLION:'1.32',MAIL_FROM:'Profile <profile@example.test>',MAIL_API_KEY:'synthetic-mail-only',TURNSTILE_SECRET_KEY:'synthetic-turnstile-only'};
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 Object.assign(values,{AI_CONFIG_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),MK99_PID:'20881234567890',MK99_PRIVATE_KEY:rsa.privateKey.export({type:'pkcs8',format:'pem'}).toString(),MK99_PLATFORM_PUBLIC_KEY:rsa.publicKey.export({type:'spki',format:'pem'}).toString(),MK99_REQUEST_SIGN_TYPE:'RSA',MK99_NOTIFY_SIGN_TYPE:'RSA',MK99_PROTOCOL_CONFIRMED:'1',MK99_AMOUNT_CONTRACT:'CNY_EXACT_BUYER_TOTAL',MK99_CASHIER_ORIGINS:'https://mk99.cn'});
 const env=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{type:'text',value}]));env.DB={type:'d1',id:'isolated-free-profile'};
 let modelCalls=0,outbound=0;
 const mf=new Miniflare({inspectorPort:0,workers:[{config:{name:'free-profile',compatibilityDate:'2026-10-14',env,manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:source}}}},dev:{outboundService:{type:'fetcher',handler:async req=>{
  outbound++;const u=new URL(req.url);
  if(u.hostname==='api.deepseek.com'){modelCalls++;return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:output}}],usage:{prompt_tokens:200,completion_tokens:100}})}
  if(u.hostname==='challenges.cloudflare.com')return Response.json({success:true,hostname:'app.profile.example',action:'register'});
  if(u.hostname==='api.resend.com')return Response.json({id:'synthetic-email'});
  if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
  throw Error('External network forbidden');
 }}}}]});
 try{
  const db=await mf.getD1Database('DB'),schema=new DatabaseSync(':memory:');
  for(const f of readdirSync(new URL('migrations/',root)).filter(x=>x.endsWith('.sql')).sort())schema.exec(readFileSync(new URL('migrations/'+f,root),'utf8'));
  const salt='00'.repeat(16),hash=pbkdf2Sync(PASSWORD+'\0'+values.PASSWORD_PEPPER,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
  schema.prepare("INSERT INTO users(id,email,username,password_hash,email_verified_at,created_at,role) VALUES('profile-user','profile@example.test','ProfileUser',?,1,?,'admin')").run('pbkdf2-sha256:100000:'+salt+':'+hash,now);
  schema.exec("INSERT INTO site_administrator VALUES(1,'profile-user',1)");
  for(const [kind,token]of [['web',TOKEN],['extension',EXT]])schema.prepare('INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,\'profile-user\',?,?,?)').run(kind,createHash('sha256').update(token).digest('hex'),kind,now,now+86400000);
  schema.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('profile-user',100000,0,?,?)").run(now,now);
  schema.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES('profile-batch','profile-user','free','signup',100000,100000,?,'tracked','active')").run(now);
  schema.exec("UPDATE system_settings SET value='1' WHERE key='ai_enabled';UPDATE system_settings SET value='5000000' WHERE key='daily_cost_limit_micro_usd'");
  for(const row of schema.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index') ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name").all())await db.prepare(row.sql).run();
  for(const {name}of schema.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
   const rows=schema.prepare('SELECT * FROM "'+name+'"').all();if(!rows.length)continue;
   const keys=Object.keys(rows[0]),sql='INSERT INTO "'+name+'"('+keys.map(k=>'"'+k+'"').join(',')+') VALUES('+keys.map(()=>'?').join(',')+')';
   await db.batch(rows.map(r=>db.prepare(sql).bind(...keys.map(k=>r[k]))));
  }schema.close();
  const seq=`WITH RECURSIVE seq(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM seq WHERE i<${history})`,day=new Date(now).toISOString().slice(0,10);
  await db.prepare(`${seq} INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) SELECT 'profile-user','history-'||i,'legacy-synthetic',200,100,100,? FROM seq`).bind(now-1000).run();
  // Ledger rows are synthetic net-zero adjustments; balance invariants remain true.
  await db.prepare(`${seq} INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) SELECT 'history-'||i,'profile-user','admin_adjustment',0,0,'history-'||i,? FROM seq`).bind(now-1000).run();
  const cipher=await encryptProviderApiKey(values.AI_CONFIG_ENCRYPTION_KEY,'profile-model',1,'synthetic-local-provider-key');
  await db.prepare("INSERT INTO ai_provider_configs(id,display_name,latest_version,created_at,updated_at,updated_by) VALUES('profile-model','Synthetic',1,1,1,'profile-user')").run();
  await db.prepare("INSERT INTO ai_provider_config_versions(config_id,version,provider,protocol,base_url,model_id,api_key_ciphertext,input_rate_micro_usd_per_million,output_rate_micro_usd_per_million,max_output_tokens,timeout_ms,options_json,endpoint_addresses_json,created_at,created_by) VALUES('profile-model',1,'deepseek','openai_chat','https://api.deepseek.com','synthetic-model',?,300000,1320000,512,10000,'{}','[\"8.8.8.8\"]',1,'profile-user')").bind(cipher).run();
  await db.prepare("UPDATE ai_usage_costs SET provider_config_id='profile-model',provider_config_version=1 WHERE CAST(substr(request_id,9) AS INTEGER)%10<7").run();
  const inspector=await mf.getInspectorURL(),url=new URL(inspector);url.protocol='http:';url.pathname='/json/list';
  const targets=await (await fetch(url)).json(),target=targets.find(t=>t.title==='workerd: worker core:user:free-profile');if(!target)throw Error('Profile target missing');
  const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let seqId=0;const pending=new Map();
  ws.addEventListener('message',e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result)}});
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seqId;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
  await cdp('Profiler.enable');await cdp('Profiler.setSamplingInterval',{interval:100});
  async function request(path,{method='GET',body,extension=false,headers={},meter=false}={}){
   const h={Origin:extension?values.EXTENSION_ORIGIN:values.WEB_ORIGIN,'CF-Connecting-IP':'8.8.8.8','Content-Type':'application/json',...(extension?{Authorization:'Bearer '+EXT}:{Cookie:'rc_session='+TOKEN,'X-Reply-Copilot-Action':'1','X-CSRF-Token':createHmac('sha256',SECRET).update('csrf:'+TOKEN).digest('hex')}),...headers};
   const r=await mf.dispatchFetch(values.API_ORIGIN+path+(meter?(path.includes('?')?'&':'?')+'__meter=1':''),{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();return {status:r.status,text,metrics:r.headers.has('X-Isolated-Metrics')?JSON.parse(r.headers.get('X-Isolated-Metrics')):undefined};
  }
  async function passwordIterations(iterations){const h=pbkdf2Sync(PASSWORD+'\0'+values.PASSWORD_PEPPER,Buffer.from(salt,'hex'),iterations,32,'sha256').toString('hex');await db.prepare("UPDATE users SET password_hash=? WHERE id='profile-user'").bind('pbkdf2-sha256:'+iterations+':'+salt+':'+h).run();}
  async function managed(enabled){await db.prepare('UPDATE ai_provider_runtime SET active_config_id=?,active_version=? WHERE id=1').bind(enabled?'profile-model':null,enabled?1:null).run();}
  async function payment(){const id=randomUUID(),trade='XRH_'+id.replaceAll('-','');
   await db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) VALUES(?,'profile-user','starter','Synthetic',400,149,'USD','awaiting_payment',?)").bind(id,Date.now()).run();
   await db.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,status,provider_trade_id,created_at,updated_at,payment_protocol,merchant_provider,merchant_account,notification_sign_type,payment_channel,provider_requested_fen,amount_contract,base_amount_fen) VALUES(?,?,'xiaodou','CNY',1043,'pending',?, ?,?,'epay','mk99','20881234567890','RSA','ALIPAY_H5',1043,'CNY_EXACT_BUYER_TOTAL',990)").bind(id,id,trade,Date.now(),Date.now()).run();
   const fields={pid:'20881234567890',trade_no:'SYNTHETIC_'+id.replaceAll('-',''),out_trade_no:trade,total_amount:'10.43',subject:'Synthetic',paytype_code:'alipay',channel_id:'1',trade_status:'TRADE_SUCCESS',timestamp:String(Math.floor(Date.now()/1000)),sign_type:'RSA'};
   const canonical=Object.entries(fields).filter(([k,v])=>k!=='sign_type'&&v!=='').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('&');fields.sign=sign('RSA-SHA256',Buffer.from(canonical),rsa.privateKey).toString('base64');
   return {id,async notify(){const form=new FormData();for(const [k,v]of Object.entries(fields))form.append(k,v);const request=new Request(values.API_ORIGIN+'/v1/payments/mk99/notify',{method:'POST',body:form});const bytes=await request.arrayBuffer();const res=await mf.dispatchFetch(request.url,{method:'POST',headers:Object.fromEntries(request.headers),body:bytes});return {status:res.status,text:await res.text()}}};
  }
  return {mf,db,cdp,request,passwordIterations,managed,payment,modelCalls:()=>modelCalls,outbound:()=>outbound,async close(){ws.close();await mf.dispose()}};
 }catch(e){await mf.dispose();throw e}
}
