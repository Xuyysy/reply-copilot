import test from 'node:test';
import assert from 'node:assert/strict';
import {TARGET,preflight,cloudflareReadClient} from '../qa/partners-qa-preflight.mjs';
function fixture(){
 const bindings=[
 {type:'d1',name:'DB',id:TARGET.database},
 ...Object.entries({ENVIRONMENT:'staging',WEB_ORIGIN:TARGET.origin,API_ORIGIN:TARGET.origin,QA_ISOLATION:'partners-qa-20261125',AI_MODE:'mock',PAYMENTS_ENABLED:'0',QA_SCHEDULED_ENABLED:'0',XIAODOU_WEBHOOKS_ENABLED:'0',BOLTUTIL_ENABLED:'0',SUBSCRIPTION_CHECKOUT_ENABLED:'0'}).map(([name,text])=>({type:'plain_text',name,text})),
 ...['AUTH_HASH_SECRET','PARTNER_ALIPAY_ENCRYPTION_KEY','PASSWORD_PEPPER','QA_ACCESS_SECRET'].map(name=>({type:'secret_text',name}))
 ];
 const data={database:{name:TARGET.databaseName,uuid:TARGET.database},settings:{bindings},subdomain:{enabled:true,previews_enabled:false},state:{migrations:33,profiles:7,initialized:0,active_sessions:0,commissions:0,enabled_flags:0},profiles:['qa-admin','qa-buyer-b','qa-buyer-c','qa-excluded-e','qa-outsider-d','qa-partner-a','qa-partner-f'].map(id=>({id,role:id==='qa-admin'?'admin':'user',is_test_account:id==='qa-excluded-e'?1:0})),admin:[{n:1}],fk:[]};
 const calls=[];
 async function call(method,path,body){
  calls.push({method,path,body});
  assert.ok(path.startsWith('/accounts/'+TARGET.account+'/'));
  if(method==='GET'){
   if(path.endsWith('/settings'))return data.settings;
   if(path.endsWith('/subdomain'))return data.subdomain;
   assert.ok(path.endsWith('/d1/database/'+TARGET.database));return data.database;
  }
  assert.equal(method,'POST');assert.ok(path.endsWith('/d1/database/'+TARGET.database+'/query'));
  const sql=body.sql;
  const rows=sql.includes('qa_schema_migrations')?[data.state]:sql.includes('ORDER BY id')?data.profiles:sql.includes('site_administrator')?data.admin:sql==='PRAGMA foreign_key_check'?data.fk:null;
  assert.ok(rows);
  return [{success:true,results:rows}];
 }
 return {data,call,calls};
}
test('exact independent QA is checked, never declared owner-ready',async()=>{
 const f=fixture(),r=await preflight(f.call);
 assert.equal(r.isolated,true);assert.equal(r.readyForOwner,false);assert.equal(r.hostedLogin,'NOT_RUN');assert.equal(r.credentialsInitialized,0);assert.equal(f.calls.length,7);
 assert.ok(f.calls.filter(c=>c.method==='POST').every(c=>/^(SELECT|PRAGMA foreign_key_check)/.test(c.body.sql)));
});
for(const [name,change,expected] of [
 ['wrong database',d=>d.database.uuid='wrong','QA_DATABASE_MISMATCH'],
 ['wrong binding',d=>d.settings.bindings[0].id='wrong','QA_D1_BINDING_MISMATCH'],
 ['extra database',d=>d.settings.bindings.push({type:'d1',name:'OTHER',id:'other'}),'QA_D1_BINDING_MISMATCH'],
 ['live payments',d=>d.settings.bindings.find(x=>x.name==='PAYMENTS_ENABLED').text='1','QA_CONFIGURATION_PAYMENTS_ENABLED'],
 ['provider secret',d=>d.settings.bindings.push({type:'secret_text',name:'MAIL_API_KEY'}),'QA_UNEXPECTED_SECRET_BINDINGS'],
 ['extra service',d=>d.settings.bindings.push({type:'service',name:'OTHER'}),'QA_UNEXPECTED_BINDING_TYPE'],
 ['preview exposed',d=>d.subdomain.previews_enabled=true,'QA_SUBDOMAIN_CONFIGURATION'],
 ['partial credentials',d=>d.state.initialized=3,'QA_PARTIAL_CREDENTIAL_STATE'],
 ['active sessions',d=>d.state.active_sessions=1,'QA_NOT_QUIESCENT'],
 ['financial records',d=>d.state.commissions=1,'QA_NOT_QUIESCENT'],
 ['enabled flag',d=>d.state.enabled_flags=1,'QA_NOT_QUIESCENT'],
 ['wrong profile',d=>d.profiles[0].id='real-user','QA_PROFILE_IDENTITIES'],
 ['marker removed',d=>d.profiles[3].is_test_account=0,'QA_PROFILE_ROLE_OR_MARKER'],
 ['singleton missing',d=>d.admin[0].n=0,'QA_SINGLETON_ADMIN'],
 ['bad foreign key',d=>d.fk.push({table:'fixture'}),'QA_FOREIGN_KEY_ERROR']
]){
 test('fails closed: '+name,async()=>{const f=fixture();change(f.data);await assert.rejects(preflight(f.call),{message:expected});});
}
test('HTTP client rejects arbitrary endpoints or SQL before outbound fetch',async()=>{
 let calls=0;const c=cloudflareReadClient('local-fixture-token-only',async()=>{calls++;throw Error('unexpected');});
 for(const [m,p,b] of [['GET','/accounts/other'],['DELETE','/accounts/'+TARGET.account],['POST','/accounts/'+TARGET.account+'/d1/database/'+TARGET.database+'/query',{sql:'DELETE FROM users'}],['GET','https://example.test']])await assert.rejects(c(m,p,b),{message:'QA_REQUEST_DENIED'});
 assert.equal(calls,0);
});
test('HTTP client restricts destination, redirects and response errors',async()=>{
 const token='local-fixture-token-only';let opts,url;
 const c=cloudflareReadClient(token,async(u,o)=>{url=u;opts=o;return new Response(JSON.stringify({success:true,result:{uuid:TARGET.database}}),{status:200});});
 assert.deepEqual(await c('GET','/accounts/'+TARGET.account+'/d1/database/'+TARGET.database),{uuid:TARGET.database});
 assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/accounts/'));assert.equal(opts.redirect,'error');
 const fail=cloudflareReadClient(token,async()=>new Response('untrusted payload',{status:403}));
 await assert.rejects(fail('GET','/accounts/'+TARGET.account+'/d1/database/'+TARGET.database),{message:'QA_API_HTTP_403'});
});
