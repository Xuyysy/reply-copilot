import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {worker} from './helpers/payment-v2.mjs';
import {setup} from './helpers/partner-browser-fixture.mjs';

// Real password/CSRF/reauth handlers, but disposable SQLite only.
// No hosted passwords, tokens, provider requests or remote D1.
test('seven synthetic accounts exercise real login, reauthentication and ownership',async t=>{
 const {f,db,enable,policy}=setup(t);
 const previousFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
 t.after(()=>{globalThis.fetch=previousFetch;});
 const pepper='local-only-fixture-pepper-not-a-deployed-secret';
 Object.assign(f.env,{PASSWORD_PEPPER:pepper,PAYMENTS_ENABLED:'0',XIAODOU_WEBHOOKS_ENABLED:'0',AI_MODE:'mock'});
 db.exec("DELETE FROM sessions; DELETE FROM admin_reauth_sessions;");
 for(const id of ['c','e','z']){
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,role,is_test_account) VALUES(?,?,1,1,?,'user',?)").run(id,id+'@example.test','fixture-'+id,id==='e'?1:0);
  db.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,0,0,1,1)").run(id);
 }
 const ids=['a','p','b','c','q','e','z'],passwords=new Map(),sessions=new Map();
 for(const id of ids){
  const password=randomBytes(24).toString('hex'),salt=randomBytes(16);
  const hash=pbkdf2Sync(password+'\u0000'+pepper,salt,100000,32,'sha256').toString('hex');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run('pbkdf2-sha256:100000:'+salt.toString('hex')+':'+hash,id);
  passwords.set(id,password);
 }
 async function request(path,{id,body,csrf,origin=f.env.WEB_ORIGIN}={}){
  const h={Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',...(id?{Cookie:sessions.get(id)?.cookie||''}:{}),...(csrf?{'X-CSRF-Token':csrf,'X-Reply-Copilot-Action':'1'}:{})};
  const r=await worker.fetch(new Request(f.env.API_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:h,...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);
  return {status:r.status,body:await r.json(),cookie:r.headers.get('Set-Cookie'),cache:r.headers.get('Cache-Control')};
 }
 assert.equal((await request('/v1/auth/login',{body:{identity:'a@example.test',password:'incorrect local password'}})).status,401);
 assert.equal((await request('/v1/auth/login',{origin:'https://wrong.example.test',body:{identity:'a@example.test',password:passwords.get('a')}})).status,403);
 for(const id of ids){
  const login=await request('/v1/auth/login',{body:{identity:id+'@example.test',password:passwords.get(id)}});
  assert.equal(login.status,200,'login '+id);assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/Secure/);assert.match(login.cookie,/SameSite=Lax/);
  const cookie=login.cookie.split(';')[0];sessions.set(id,{cookie});
  const csrf=await request('/v1/auth/csrf',{id});assert.equal(csrf.status,200);assert.ok(csrf.body.csrfToken);
  sessions.get(id).csrf=csrf.body.csrfToken;
  assert.equal((await request('/v1/me',{id})).status,200);
  const partner=await request('/v1/partners/me',{id});assert.equal(partner.status,200);assert.equal(partner.body.enabled,false);
  assert.equal((await request('/v1/admin/partners/policy?q=p',{id})).status,id==='a'?200:403);
 }
 enable();
 const auth=sessions.get('a').csrf;
 const change=()=>request('/v1/admin/partners/policy',{id:'a',csrf:auth,body:policy});
 assert.equal((await change()).status,403,'reauth required');
 assert.equal((await request('/v1/admin/reauth',{id:'a',csrf:auth,body:{password:'wrong local password'}})).status,401);
 assert.equal((await request('/v1/admin/reauth',{id:'a',csrf:auth,body:{password:passwords.get('a')}})).status,200);
 assert.equal((await request('/v1/admin/partners/policy',{id:'a',body:policy})).status,403,'csrf required');
 assert.equal((await change()).status,200);
 assert.equal((await request('/v1/admin/partners/policy',{id:'a',csrf:auth,body:{...policy,userId:'e',operationId:randomUUID()}})).status,409,'marked account excluded');
 assert.equal((await request('/v1/partners/me',{id:'p'})).body.policy.user_id,'p');
 for(const id of ids.filter(x=>x!=='p'))assert.equal((await request('/v1/partners/me',{id})).body.policy,null,'isolated '+id);
 // Local acceptance only: retain the singleton admin until all user cleanup
 // is verified. Logout first; freezing alone does not revoke the session.
 const temporaryUsers=ids.filter(id=>id!=='a');
 for(const id of temporaryUsers){
  const csrf=sessions.get(id).csrf;
  assert.equal((await request('/v1/auth/logout',{id,body:{},csrf})).status,200,'logout '+id);
  assert.equal((await request('/v1/me',{id})).status,401,'revoked '+id);
 }
 const freeze=(userIds,csrf=auth)=>request('/v1/admin/users/bulk-status',{id:'a',csrf,body:{userIds,status:'frozen',operationId:randomUUID(),reason:'local QA lifecycle cleanup'}});
 assert.equal((await freeze(['a',...temporaryUsers])).status,400,'singleton admin protected');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE status='frozen'").get().n,0);
 assert.equal((await freeze(temporaryUsers,'invalid')).status,403,'freeze requires CSRF');
 assert.equal((await freeze(temporaryUsers)).status,200);
 for(const id of temporaryUsers){
  assert.equal(db.prepare('SELECT status FROM users WHERE id=?').get(id).status,'frozen');
  assert.equal((await request('/v1/me',{id})).status,401,'frozen session denied '+id);
 }
 assert.equal((await request('/v1/auth/login',{body:{identity:'p@example.test',password:passwords.get('p')}})).status,403,'correct password cannot access frozen partner');
 assert.equal(db.prepare("SELECT status FROM users WHERE id='a'").get().status,'active');
 assert.equal((await request('/v1/auth/logout',{id:'a',body:{},csrf:auth})).status,200,'admin logout');
 assert.equal((await request('/v1/me',{id:'a'})).status,401,'admin session revoked');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE revoked_at IS NULL").get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_commissions').get().n,0);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
