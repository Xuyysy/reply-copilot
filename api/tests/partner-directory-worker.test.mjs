import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {fixture,worker} from './helpers/payment-v2.mjs';
test('partner directory persists authorization, referral privacy, and minimum rate',async t=>{
 const f=fixture({released:false}),db=f.sql;t.after(()=>db.close());
 for(const n of ['0027_referral_rewards_v1.sql','partners_v1a_policy_proposal.sql'])db.exec(readFileSync(new URL('../sql-proposals/'+n,import.meta.url),'utf8'));
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('external forbidden')};t.after(()=>{globalThis.fetch=old});
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',PAYMENTS_ENABLED:'0',XIAODOU_WEBHOOKS_ENABLED:'0'});
 const tokens={};
 for(const [id,role] of [['owner','admin'],['partner','user'],['buyer','user'],['other','user']]){
  const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');tokens[id]=token;
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture',?)").run(id,id+'@example.test',id,role);
  db.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'web',1,?)").run('s-'+id,createHash('sha256').update(token).digest('hex'),id,Date.now()+60000);
 }
 db.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'owner',1);UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','referrals_enabled')");
 db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('s-owner',?)").run(Date.now()+60000);
 async function call(id,path,body){const token=tokens[id];const r=await worker.fetch(new Request(f.env.API_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{Origin:f.env.WEB_ORIGIN,'Content-Type':'application/json','X-Reply-Copilot-Action':'1',...(token?{Cookie:'rc_session='+token,'X-CSRF-Token':createHmac('sha256',f.env.AUTH_HASH_SECRET).update('csrf:'+token).digest('hex')}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);return {status:r.status,body:await r.json()};}
 const policy='/v1/admin/partners/policy',list='/v1/admin/partners/list',invites='/v1/admin/partners/invites?userId=partner',mine='/v1/referrals/me';
 const grant={userId:'partner',operationId:randomUUID(),status:'active',level:'standard',rateBps:1500,termMonths:null,expectedVersion:0,reason:'offline synthetic test'};
 assert.equal((await call('owner',policy,{...grant,rateBps:1499})).status,400);
 assert.equal((await call('owner',policy,grant)).status,200);
 db.prepare("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,registered_at) VALUES('buyer','partner','0123456789abcdef',?)").run(Date.now());
 const r=await call('owner',list);assert.equal(r.status,200);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].id,'partner');assert.equal(r.body.items[0].registered,1);
 assert.equal((await call('owner',invites)).body.items[0].email,'buyer@example.test');
 assert.equal((await call('other',list)).status,403);assert.equal((await call('partner',invites)).status,403);
 const own=await call('partner',mine);assert.equal(own.status,200);assert.equal(own.body.invites.length,1);assert.equal(own.body.invites[0].label,'b***');assert.ok(!JSON.stringify(own.body.invites).includes('buyer@example.test'));
 assert.deepEqual((await call('other',mine+'?userId=partner')).body.invites,[]);
});
