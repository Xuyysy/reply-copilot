import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {fixture,worker} from './helpers/payment-v2.mjs';

// In-memory SQLite and bundled Worker only. No remote D1, payments, provider
// calls, deployed credentials, financial fixtures or release actions.
test('eligibility-only Worker: explicit assignment, authorization, pause, replay and isolation',async t=>{
 const f=fixture({released:false});const db=f.sql;t.after(()=>db.close());
 db.exec(readFileSync(new URL('../sql-proposals/partners_v1a_policy_proposal.sql',import.meta.url),'utf8'));
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',PAYMENTS_ENABLED:'0',XIAODOU_WEBHOOKS_ENABLED:'0'});
 const tokens={};
 for(const [id,role] of [['owner','admin'],['partner','user'],['ordinary','user'],['ineligible','user']]){
  const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');
  tokens[id]=token;
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture-hash',?)").run(id,id+'@example.test','fixture-'+id,role);
  db.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'web',1,?)").run('session-'+id,createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
 }
 db.exec("UPDATE users SET is_test_account=1 WHERE id='ineligible'");
 db.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'owner',1)");
 const me='/v1/partners/me',admin='/v1/admin/partners/policy';
 async function call(id,path,body,extra={}){
  const token=tokens[id];
  const headers={Origin:f.env.WEB_ORIGIN,'Content-Type':'application/json','X-Reply-Copilot-Action':'1',...(token?{Cookie:'rc_session='+token,'X-CSRF-Token':createHmac('sha256',f.env.AUTH_HASH_SECRET).update('csrf:'+token).digest('hex')}:{}),...extra};
  const res=await worker.fetch(new Request(f.env.API_ORIGIN+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);
  return {status:res.status,body:await res.json(),cache:res.headers.get('Cache-Control')};
 }
 async function ok(...args){const r=await call(...args);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
 const grant={userId:'partner',operationId:randomUUID(),status:'active',level:'standard',rateBps:2000,termMonths:12,expectedVersion:0,reason:'local synthetic eligibility test'};
 assert.equal((await call(null,me)).status,401);
 assert.deepEqual(await ok('partner',me),{enabled:false});
 assert.equal((await call('ordinary',admin+'?q=partner')).status,403);
 db.exec("UPDATE system_settings SET value='1' WHERE key='partner_program_enabled'");
 assert.deepEqual(await ok('partner',me),{enabled:true,policy:null,recruitmentEligible:true});
 assert.equal((await call('owner',admin,grant)).status,403);
 db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('session-owner',?)").run(Date.now()+3600000);
 assert.equal((await call('owner',admin,grant,{'X-CSRF-Token':'invalid'})).status,403);
 assert.equal((await call('ordinary',admin,grant)).status,403);
 assert.equal((await call('owner',admin,{...grant,userId:'ineligible'})).status,409);
 assert.equal((await ok('owner',admin,grant)).version,1);
 assert.equal((await call('owner',admin,grant)).status,409);
 const actual=await call('partner',me);assert.equal(actual.status,200);assert.equal(actual.cache,'no-store');
 assert.equal(actual.body.policy.user_id,'partner');assert.equal(actual.body.policy.rate_bps,2000);
 assert.deepEqual(Object.keys(actual.body).sort(),['enabled','policy']);
 assert.deepEqual(await ok('ordinary',me+'?userId=partner'),{enabled:true,policy:null,recruitmentEligible:true});
 const lookup=await ok('owner',admin+'?q=partner%40example.test');
 assert.equal(lookup.user.id,'partner');assert.equal(lookup.history.length,1);
 await new Promise(resolve=>setTimeout(resolve,5));
 const pause={...grant,operationId:randomUUID(),status:'paused',expectedVersion:1};
 assert.equal((await ok('owner',admin,pause)).version,2);
 assert.equal((await ok('partner',me)).policy.status,'paused');
 assert.equal((await ok('owner',admin+'?q=partner')).history.length,2);
 db.exec("UPDATE system_settings SET value='0' WHERE key='partner_program_enabled'");
 assert.deepEqual(await ok('partner',me),{enabled:false});
 assert.equal((await call('owner',admin,{...grant,expectedVersion:2})).status,409);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_policy_versions').get().n,2);
});
