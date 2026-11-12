import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const apiRoot = new URL('../../', import.meta.url);
export const temp = mkdtempSync(path.join(tmpdir(), 'xrh-v2-test-'));
buildSync({entryPoints:[fileURLToPath(new URL('src/index.ts',apiRoot))],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:path.join(temp,'worker.cjs')});
const loaded = createRequire(import.meta.url)(path.join(temp,'worker.cjs'));
export const worker = loaded.default;
const merchant = generateKeyPairSync('rsa',{modulusLength:2048});
export const platform = generateKeyPairSync('rsa',{modulusLength:2048});
const token='b'.repeat(64), secret='local-v2-auth-secret-which-is-not-a-real-secret';
export function fixture({released=true}={}) {
  const sql = new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('migrations/',apiRoot)).filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(`migrations/${file}`,apiRoot),'utf8'));
  // Local fixture only: exercise the not-yet-approved 0025 contract without adding it
  // to deployable api/migrations or querying any remote D1.
  sql.exec(readFileSync(new URL('sql-proposals/0025_subscription_xiaodou_rsa2.sql',apiRoot),'utf8'));
  sql.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES('test-user','v2@example.test',1,1,'v2-user','test-hash')").run();
  sql.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES('test-session',?,'test-user','web',1,?)").run(createHash('sha256').update(token).digest('hex'),Date.now()+60000);
  sql.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('test-user',200,0,1,1)").run();
  sql.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES('free-batch','test-user','free','signup',200,200,1,'tracked','active')").run();
  sql.prepare("UPDATE system_settings SET value='1' WHERE key='purchase_enabled'").run();
  if(released)sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_alipay_released','payment_wechat_released','payment_rsa2_alipay_released','payment_rsa2_wechat_released','payment_epay_alipay_released')");
  const DB={prepare(query){const statement={query,args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)??null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...this.args).changes)}};}};return statement;},async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>({meta:{changes:Number(sql.prepare(s.query).run(...s.args).changes)}}));sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  const env={ENVIRONMENT:'staging',WEB_ORIGIN:'https://staging.example.test',API_ORIGIN:'https://api-staging.example.test',EXTENSION_ORIGIN:'chrome-extension://'+'a'.repeat(32),AUTH_HASH_SECRET:secret,PAYMENTS_ENABLED:'1',XIAODOU_WEBHOOKS_ENABLED:'1',PAYMENT_PROVIDER:'xiaodou',AI_MODE:'mock',XIAODOU_EPAY_TEST_COMPAT:'1',XIAODOU_RSA2_SUBSCRIPTIONS_READY:'1',XIAODOU_SOURCE_IP_CONFIRMED:'1',ADMIN_PORTAL_ENABLED:'0',XIAODOU_BASE_URL:'https://provider.example.test',XIAODOU_APP_ID:'xdop_1234567890abcdef',XIAODOU_KEY_ID:'mkid_0123456789abcdef',XIAODOU_PRIVATE_KEY:merchant.privateKey.export({type:'pkcs8',format:'pem'}).toString(),XIAODOU_PLATFORM_PUBLIC_KEYS:JSON.stringify({'test-platform':platform.publicKey.export({type:'spki',format:'pem'}).toString()}),DB};
  const headers={Origin:env.WEB_ORIGIN,Cookie:`rc_session=${token}`,'Content-Type':'application/json','CF-Connecting-IP':'8.8.8.8','X-Reply-Copilot-Action':'1','X-CSRF-Token':createHmac('sha256',secret).update(`csrf:${token}`).digest('hex')};
  async function call(route, {method='POST',body={packageId:'starter'},headers:extra={}}={}){const response=await worker.fetch(new Request(env.API_ORIGIN+route,{method,headers:{...headers,...extra},...(method==='GET'?{}:{body:JSON.stringify(body)})}),env);return {status:response.status,body:await response.json()};}
  return {sql,env,call,DB};
}
export function enableEpaySales(f){
  f.sql.exec("UPDATE system_settings SET value='0' WHERE key='payment_rsa2_enabled'");
  f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_epay_enabled','payment_alipay_enabled')");
  return f;
}
export const feeProjection={ruleVersion:'test-v1',thresholdFen:0,tier:'STANDARD',merchantRateBps:250,companyServiceFeeRateBps:100,merchantSettlementFen:960,companyServiceFeeFen:30};
export function providerResponse(request, fields={}, {status=201,signed=true,badSignature=false}={}) {
  const requestId=request.headers.get('X-XD-Request-Id');
  const body=JSON.stringify(fields.code?{requestId,...fields}:{requestId,outTradeNo:JSON.parse(request.body||'{}').outTradeNo,amountFen:990,currency:'CNY',status:'CREATED',payUrl:'https://cashier.example.test/pay/test',feeProjection,...fields});
  const headers={'Content-Type':'application/json','X-XD-Request-Id':requestId};
  if(signed){const timestamp=String(Math.floor(Date.now()/1000)),nonce='response-nonce-12345',keyId='test-platform';const canonical=['XD-Response-v1',String(status),'application/json',requestId,timestamp,nonce,keyId,createHash('sha256').update(body).digest('hex')].join('\n');Object.assign(headers,{'X-XD-Response-Timestamp':timestamp,'X-XD-Response-Nonce':nonce,'X-XD-Response-Key-Id':keyId,'X-XD-Response-Sign':badSignature?'AAAA':sign('RSA-SHA256',Buffer.from(canonical),platform.privateKey).toString('base64')});}
  return new Response(body,{status,headers});
}
export async function withProvider(fn,run){const original=globalThis.fetch;const calls=[];globalThis.fetch=async(url,init)=>{const request={url,method:init.method,headers:new Headers(init.headers),body:init.body,redirect:init.redirect};calls.push(request);return fn(request);};try{return await run(calls);}finally{globalThis.fetch=original;}}
