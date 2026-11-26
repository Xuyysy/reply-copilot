// Independent QA release preflight: fixed resources, metadata and SELECTs only.
// Never configures credentials, creates sessions, changes flags, or deploys.
export const TARGET=Object.freeze({
 account:'cb5fc919a9f05dcf39b3ca29c9538a1f',
 database:'22f7a8f1-28c1-42ad-a69d-54ee8bc7e5dc',
 databaseName:'reply-copilot-partners-qa-20261125',
 worker:'reply-copilot-api-partners-qa',
 origin:'https://reply-copilot-api-partners-qa.yyx0149.workers.dev',
 sourceSha:'ff8a2e2c7e85f2faf56232739d280415f964ef9d'
});
const expectedVars={
 ENVIRONMENT:'staging',WEB_ORIGIN:TARGET.origin,API_ORIGIN:TARGET.origin,
 QA_ISOLATION:'partners-qa-20261125',AI_MODE:'mock',PAYMENTS_ENABLED:'0',
 QA_SCHEDULED_ENABLED:'0',XIAODOU_WEBHOOKS_ENABLED:'0',BOLTUTIL_ENABLED:'0',
 SUBSCRIPTION_CHECKOUT_ENABLED:'0'
};
const expectedSecrets=['AUTH_HASH_SECRET','PARTNER_ALIPAY_ENCRYPTION_KEY','PASSWORD_PEPPER','QA_ACCESS_SECRET'];
const expectedIds=['qa-admin','qa-buyer-b','qa-buyer-c','qa-excluded-e','qa-outsider-d','qa-partner-a','qa-partner-f'];
const required=(cond,code)=>{if(!cond)throw Error(code);};
const root='/accounts/'+TARGET.account;
const db=root+'/d1/database/'+TARGET.database;
const worker=root+'/workers/scripts/'+TARGET.worker;
const queries=Object.freeze([
 "SELECT (SELECT COUNT(*) FROM qa_schema_migrations) migrations,(SELECT COUNT(*) FROM users) profiles,(SELECT COUNT(*) FROM users WHERE password_hash IS NOT NULL) initialized,(SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL) active_sessions,(SELECT COUNT(*) FROM partner_commissions) commissions,(SELECT COUNT(*) FROM system_settings WHERE key LIKE 'partner_%_enabled' AND value<>'0') enabled_flags",
 "SELECT id,role,is_test_account FROM users ORDER BY id",
 "SELECT COUNT(*) n FROM site_administrator WHERE id=1 AND user_id='qa-admin'",
 'PRAGMA foreign_key_check'
]);
export async function preflight(call){
 const d=await call('GET',db);
 required(d?.uuid===TARGET.database&&d?.name===TARGET.databaseName,'QA_DATABASE_MISMATCH');
 const s=await call('GET',worker+'/settings');
 const bindings=s?.bindings;
 required(Array.isArray(bindings),'QA_BINDINGS_MISSING');
 const names=bindings.map(x=>x.name);
 required(names.length===new Set(names).size,'QA_DUPLICATE_BINDING');
 const d1=bindings.filter(x=>x.type==='d1');
 required(d1.length===1&&d1[0].name==='DB'&&d1[0].id===TARGET.database,'QA_D1_BINDING_MISMATCH');
 for(const [name,text] of Object.entries(expectedVars))
  required(bindings.some(x=>x.name===name&&x.type==='plain_text'&&x.text===text),'QA_CONFIGURATION_'+name);
 const secrets=bindings.filter(x=>x.type==='secret_text').map(x=>x.name).sort();
 required(JSON.stringify(secrets)===JSON.stringify(expectedSecrets),'QA_UNEXPECTED_SECRET_BINDINGS');
 // Do not accept alternate services, storage, AI, or execution bindings.
 required(bindings.every(x=>['d1','plain_text','secret_text'].includes(x.type)),'QA_UNEXPECTED_BINDING_TYPE');
 required(!bindings.some(x=>/^(MAIL_API_KEY|DEEPSEEK_API_KEY|XIAODOU_PRIVATE_KEY|MK99_KEY|BOLTUTIL_API_KEY|QA_OIDC_TRUST|QA_OIDC_GRANT_KEY)$/.test(x.name)),'QA_PROVIDER_OR_GRANT_BINDING');
 const sub=await call('GET',worker+'/subdomain');
 required(sub?.enabled===true&&sub?.previews_enabled===false,'QA_SUBDOMAIN_CONFIGURATION');
 async function select(sql){
  required(queries.includes(sql),'QA_QUERY_NOT_ALLOWED');
  const r=await call('POST',db+'/query',{sql});
  required(Array.isArray(r)&&r.length===1&&r[0]?.success===true&&Array.isArray(r[0].results),'QA_QUERY_FAILED');
  return r[0].results;
 }
 const rows=await select(queries[0]);required(rows.length===1,'QA_STATE_MISSING');
 const state=rows[0];
 required(state.migrations===33&&state.profiles===7,'QA_SCHEMA_OR_PROFILE_COUNT');
 required(state.active_sessions===0&&state.commissions===0&&state.enabled_flags===0,'QA_NOT_QUIESCENT');
 required(state.initialized===0||state.initialized===7,'QA_PARTIAL_CREDENTIAL_STATE');
 const users=await select(queries[1]);
 required(JSON.stringify(users.map(x=>x.id))===JSON.stringify(expectedIds),'QA_PROFILE_IDENTITIES');
 required(users.every(x=>x.role===(x.id==='qa-admin'?'admin':'user')&&x.is_test_account===(x.id==='qa-excluded-e'?1:0)),'QA_PROFILE_ROLE_OR_MARKER');
 const admin=await select(queries[2]);required(admin.length===1&&admin[0].n===1,'QA_SINGLETON_ADMIN');
 required((await select(queries[3])).length===0,'QA_FOREIGN_KEY_ERROR');
 return {sourceSha:TARGET.sourceSha,worker:TARGET.worker,database:TARGET.databaseName,isolated:true,migrations:state.migrations,profiles:state.profiles,credentialsInitialized:state.initialized,activeSessions:state.active_sessions,commissions:state.commissions,enabledPartnerFlags:state.enabled_flags,realPayments:false,previews:false,foreignKeys:'pass',hostedLogin:'NOT_RUN',financialAcceptance:'NOT_RUN',readyForOwner:false};
}
export function cloudflareReadClient(token,fetcher=fetch){
 required(typeof token==='string'&&token.length>=20&&token.length<=512&&!/\s/.test(token),'QA_TOKEN_MISSING');
 const paths=new Set([db,worker+'/settings',worker+'/subdomain']);
 return async(method,path,body)=>{
  required((method==='GET'&&paths.has(path)&&body===undefined)||(method==='POST'&&path===db+'/query'&&body&&Object.keys(body).length===1&&queries.includes(body.sql)),'QA_REQUEST_DENIED');
  let r;
  try{r=await fetcher('https://api.cloudflare.com/client/v4'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw Error('QA_API_TRANSPORT_FAILED');}
  required(r.ok,'QA_API_HTTP_'+r.status);
  let v;try{v=await r.json();}catch{throw Error('QA_API_INVALID_JSON');}
  required(v?.success===true,'QA_API_REJECTED');
  return v.result;
 };
}
