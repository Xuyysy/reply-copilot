import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {ELIGIBLE,REQUEST,CONSUME,CREATE_SESSION,BAD_ATTEMPT} from "../api/src/email-login-sql.mjs";
const now=1794900000000,email="member@example.test",codeHash="purpose-scoped-hmac-test";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function setup({status="active",role="user",verified=1,admin=false}={}){
 const s=new DatabaseSync(":memory:");
 for(const f of readdirSync(path.join(root,"api/migrations")).filter(x=>/^\d{4}.*\.sql$/.test(x)).sort())
   s.exec(readFileSync(path.join(root,"api/migrations",f),"utf8"));
 s.prepare("INSERT INTO users(id,email,email_verified_at,created_at,status,role) VALUES(?,?,?,?,?,?)").run("u1",email,verified,now,status,role);
 if(admin)s.prepare("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'u1',?)").run(now);
 return s;
}
function send(s){return s.prepare(REQUEST).run(email,codeHash,now+600000,now,now-60000);}
function login(s,{ts=now,nonce="n1",hash=codeHash,sid="s1"}={}){
 s.exec("BEGIN IMMEDIATE");
 try{
  const a=s.prepare(CONSUME).all(ts,nonce,email,hash,ts).length;
  const b=s.prepare(CREATE_SESSION).run(sid,"a".repeat(64),ts,ts+30*86400_000,email,nonce,hash).changes;
  s.exec("COMMIT");return {consumed:a,sessions:Number(b)};
 }catch(e){s.exec("ROLLBACK");throw e;}
}
test("only verified active non-admin accounts can request the login code",()=>{
 for(const x of [{},{status:"frozen"},{role:"admin"},{verified:0},{admin:true}]){
  const s=setup(x);assert.equal(Boolean(s.prepare(ELIGIBLE).get(email)),Object.keys(x).length===0);s.close();
 }
});
test("single use code only mints a web session, never a user/credit/trial",()=>{
 const s=setup();assert.equal(send(s).changes,1);
 assert.deepEqual(login(s),{consumed:1,sessions:1});
 assert.deepEqual(login(s,{nonce:"n2",sid:"s2"}),{consumed:0,sessions:0});
 for(const table of ["users","sessions","trials","signup_benefit_claims","credit_ledger","credit_batches"]){
  assert.equal(s.prepare("SELECT COUNT(*) n FROM "+table).get().n,table==="users"||table==="sessions"?1:0);
 }
 s.close();
});
test("bad and expired codes fail; attempts cap at five; resending is cooled down",()=>{
 const s=setup();assert.equal(send(s).changes,1);assert.equal(send(s).changes,0);
 assert.deepEqual(login(s,{hash:"invalid",sid:"bad"}),{consumed:0,sessions:0});
 for(let i=0;i<12;i++)s.prepare(BAD_ATTEMPT).run(email,now);
 assert.equal(s.prepare("SELECT attempts FROM email_verifications").get().attempts,5);
 assert.deepEqual(login(s),{consumed:0,sessions:0});s.close();
 const t=setup();send(t);assert.deepEqual(login(t,{ts:now+600001}),{consumed:0,sessions:0});t.close();
});
test("frozen after issuance cannot mint an authenticated session",()=>{
 const s=setup();send(s);s.prepare("UPDATE users SET status='frozen'").run();
 assert.deepEqual(login(s),{consumed:1,sessions:0});
 assert.equal(s.prepare("SELECT COUNT(*) n FROM sessions").get().n,0);s.close();
});
test("opt-in, Turnstile login action, global email budget and passwordless contract",()=>{
 const page=readFileSync(path.join(root,"web/src/pages/login.astro"),"utf8");
 const ui=readFileSync(path.join(root,"web/src/components/auth/AuthPanel.tsx"),"utf8");
 const code=readFileSync(path.join(root,"api/src/email-login.ts"),"utf8");
 const auth=readFileSync(path.join(root,"api/src/auth.ts"),"utf8");
 assert.match(page,/<AuthPanel client:load localVerification=\{localVerification\} sitekey=\{sitekey\} \/>/);
 assert.match(ui,/PUBLIC_EMAIL_LOGIN_ENABLED === '1'/);
 assert.match(code,/EMAIL_LOGIN_ENABLED!=="1"/);
 assert.match(code,/verifyLoginTurnstile\(request,env,body\.turnstileToken\)/);
 assert.match(code,/email-login:global-send",40,86400_000/);
 assert.match(auth,/purpose==="login"\?"登录"/);
 assert.match(ui,/action:view==="login-code-request"\?"login":"register"/);
 assert.doesNotMatch(code,/verifyPassword|hashPassword|INSERT INTO users|INSERT INTO credit_/);
});
