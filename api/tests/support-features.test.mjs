import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {fixture} from './helpers/payment-v2.mjs';
const proposal=new URL('../sql-proposals/0031_user_support_features.sql',import.meta.url);
const adminPath='/v1/admin/users/test-user/support-features';
const extPath='/v1/extension/support-features';
const payload=(extra)=>({operationId:randomUUID(),reason:'本地定向诊断授权测试',...extra});
function setup({migrate=true}={}){
 const f=fixture();f.env.ADMIN_PORTAL_ENABLED='1';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator VALUES(1,'test-user',1)");
 f.sql.prepare("INSERT INTO admin_reauth_sessions VALUES('test-session',?)").run(Date.now()+900000);
 f.sql.exec("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES('other-user','other@example.test',1,1,'other-user','test-hash')");
 const tokens=['c'.repeat(64),'d'.repeat(64)];
 for(const [i,user] of ['test-user','other-user'].entries()){
  f.sql.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'extension',1,?)").run('ext-'+i,createHash('sha256').update(tokens[i]).digest('hex'),user,Date.now()+900000);
 }
 if(migrate)f.sql.exec(readFileSync(proposal,'utf8'));
 const ext=(i,path=extPath)=>f.call(path,{method:'GET',headers:{Origin:f.env.EXTENSION_ORIGIN,Authorization:'Bearer '+tokens[i],Cookie:''}});
 return {...f,ext};
}
test('support proposal stays outside approved deployable migrations',()=>{
 assert.equal(readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).length,24);
 assert.match(readFileSync(proposal,'utf8'),/CREATE TABLE user_support_features/);
});
test('per-account grant is disabled by default, expires, is revocable and audited',async()=>{
 const f=setup();
 const get=async(i)=>(await f.ext(i)).body.features.localDiagnostics;
 assert.deepEqual(await get(0),{enabled:false,expiresAt:null});
 const body=payload({enabled:true,hours:24});
 assert.equal((await f.call(adminPath,{body})).status,200);
 assert.equal((await get(0)).enabled,true);
 assert.deepEqual(await get(1),{enabled:false,expiresAt:null});
 assert.equal((await f.call(adminPath,{body})).status,200);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM admin_audit_logs WHERE action='support_local_diagnostics'").get().n,1);
 f.sql.exec("UPDATE user_support_features SET updated_at=1,expires_at=2");
 assert.deepEqual(await get(0),{enabled:false,expiresAt:null});
 assert.equal((await f.call(adminPath,{body:payload({enabled:true,hours:72})})).status,200);
 assert.equal((await f.call(adminPath,{body:payload({enabled:false})})).status,200);
 assert.deepEqual(await get(0),{enabled:false,expiresAt:null});
 assert.equal(f.sql.prepare("SELECT count(*) n FROM user_support_features").get().n,0);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM admin_audit_logs WHERE action='support_local_diagnostics'").get().n,3);
});
test('extension flag uses authenticated session, admin write needs CSRF and fresh proof',async()=>{
 const f=setup();
 assert.equal((await f.call(extPath,{method:'GET'})).status,403);
 assert.equal((await f.ext(0,adminPath)).status,403);
 assert.equal((await f.call(adminPath,{body:payload({enabled:true,hours:169})})).status,400);
 assert.equal((await f.call(adminPath,{body:payload({enabled:true,hours:24}),headers:{'X-CSRF-Token':''}})).status,403);
 f.sql.exec("DELETE FROM admin_reauth_sessions");
 assert.equal((await f.call(adminPath,{body:payload({enabled:true,hours:24})})).status,403);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM user_support_features").get().n,0);
});
test('missing proposed schema fails closed for extension reads',async()=>{
 const f=setup({migrate:false}),r=await f.ext(0);
 assert.equal(r.status,200);
 assert.deepEqual(r.body.features.localDiagnostics,{enabled:false,expiresAt:null});
});
