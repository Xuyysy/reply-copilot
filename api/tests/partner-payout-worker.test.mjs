import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fixture,worker} from './helpers/payment-v2.mjs';
import {encryptRecipient,decryptRecipient} from '../src/partner-payout-crypto.mjs';
test('payout ciphertext binds identity and version',async()=>{
 const key=randomBytes(32).toString('base64'),value={name:'Synthetic User',account:'synthetic@example.test'};
 const cipher=await encryptRecipient(key,'partner',1,value);assert.ok(!cipher.includes(value.account));assert.notEqual(cipher,await encryptRecipient(key,'partner',1,value));
 assert.deepEqual(await decryptRecipient(key,'partner',1,cipher),value);
 for(const [id,v,k] of [['other',1,key],['partner',2,key],['partner',1,randomBytes(32).toString('base64')]])await assert.rejects(decryptRecipient(k,id,v,cipher));
});
test('recipient profile: owner-only, reauth, encrypted versions, request snapshot and pending lock',async t=>{
 const f=fixture({released:false}),db=f.sql;t.after(()=>db.close());
 for(const name of ['0027_referral_rewards_v1.sql','partners_v1a_policy_proposal.sql','partners_manual_record_proposal.sql','partners_payout_profile_proposal.sql'])db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('external forbidden')};t.after(()=>{globalThis.fetch=old});
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',PAYMENTS_ENABLED:'0',XIAODOU_WEBHOOKS_ENABLED:'0',PARTNER_PAYOUT_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
 const tokens={};for(const [id,role] of [['owner','admin'],['partner','user'],['other','user']]){
 const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');tokens[id]=token;
 db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture',?)").run(id,id+'@example.test',id,role);
 db.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'web',1,?)").run('s-'+id,createHash('sha256').update(token).digest('hex'),id,Date.now()+60000);
 }
 db.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'owner',1);UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled')");
 db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('s-owner',?)").run(Date.now()+60000);
 async function call(id,path,body,extra={}){const token=tokens[id];const r=await worker.fetch(new Request(f.env.API_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{Origin:f.env.WEB_ORIGIN,'Content-Type':'application/json','X-Reply-Copilot-Action':'1',...(token?{Cookie:'rc_session='+token,'X-CSRF-Token':createHmac('sha256',f.env.AUTH_HASH_SECRET).update('csrf:'+token).digest('hex')} : {}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);return {status:r.status,body:await r.json(),cache:r.headers.get('Cache-Control')};}
 const me='/v1/partners/payout',admin='/v1/admin/partners/payout',report='/v1/partners/manual-report',policy='/v1/admin/partners/policy',manual='/v1/admin/partners/manual-report';
 const grant={userId:'partner',operationId:randomUUID(),status:'active',level:'standard',rateBps:1500,termMonths:null,expectedVersion:0,reason:'offline synthetic test'};
 assert.equal((await call('owner',policy,grant)).status,200);assert.deepEqual((await call('partner',me)).body,{enabled:false});
 db.exec("UPDATE system_settings SET value='1' WHERE key='partner_payout_profile_enabled'");
 assert.equal((await call(null,me)).status,401);assert.equal((await call('other',me)).status,403);assert.equal((await call('partner',admin+'?userId=partner')).status,403);
 const value={name:'Synthetic Recipient',account:'synthetic@example.test',expectedVersion:0};
 assert.equal((await call('partner',me,value,{'X-CSRF-Token':'bad'})).status,403);
 assert.equal((await call('partner',me,{...value,userId:'other'})).status,409);
 const saved=await call('partner',me,value);assert.equal(saved.status,200);assert.equal(saved.cache,'no-store');assert.equal(saved.body.profile.name,'S***');assert.ok(!JSON.stringify(saved.body).includes(value.account));
 const stored=db.prepare("SELECT * FROM partner_payout_profiles").get();assert.ok(!JSON.stringify(stored).includes(value.account));assert.ok(!JSON.stringify(stored).includes(value.name));
 assert.equal((await call('partner',me,value)).status,409);
 const reveal={userId:'partner',reason:'verify synthetic recipient',operationId:randomUUID()};
 db.exec("DELETE FROM admin_reauth_sessions WHERE session_id='s-owner'");
 assert.equal((await call('owner',admin,reveal)).status,403);assert.equal((await call('other',admin,reveal)).status,403);
 db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('s-owner',?)").run(Date.now()+60000);
 assert.equal((await call('owner',admin+'?userId=partner')).body.configured,true);
 assert.deepEqual((await call('owner',admin,reveal)).body.profile,{name:value.name,account:value.account});
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_payout_reveal_audit").get().n,1);
 const requestId=randomUUID(),seed=db.prepare("INSERT INTO partner_manual_requests(id,partner_user_id,amount_fen,created_at) VALUES(?,?,?,?)");
 assert.throws(()=>seed.run(randomUUID(),'other',1000,Date.now()));
 seed.run(requestId,'partner',1000,Date.now());
 assert.equal(db.prepare("SELECT profile_version FROM partner_request_recipients WHERE request_id=?").get(requestId).profile_version,1);
 assert.equal((await call('partner',me,{...value,expectedVersion:1})).status,409);
 assert.equal((await call('owner',admin,{...reveal,requestId})).body.version,1);
 assert.equal((await call('owner',manual,{requestId,operationId:randomUUID(),action:'rejected',reason:'synthetic rejection'})).status,200);
 const changed=await call('partner',me,{name:'New Recipient',account:'new@example.test',expectedVersion:1});assert.equal(changed.status,200);assert.equal(changed.body.version,2);
 assert.equal((await call('owner',admin,{...reveal,requestId})).body.profile.account,value.account);
 assert.equal((await call('owner',admin,reveal)).body.profile.account,'new@example.test');
 const key=f.env.PARTNER_PAYOUT_ENCRYPTION_KEY;f.env.PARTNER_PAYOUT_ENCRYPTION_KEY='invalid';
 assert.equal((await call('partner',me)).status,503);assert.equal((await call('owner',admin,reveal)).status,503);
 const denied=await call('partner',report);assert.equal(denied.status,200);assert.equal(denied.body.recipientReady,false);assert.equal(denied.body.requestableFen,null);f.env.PARTNER_PAYOUT_ENCRYPTION_KEY=key;
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_payout_profiles").get().n,2);
});
