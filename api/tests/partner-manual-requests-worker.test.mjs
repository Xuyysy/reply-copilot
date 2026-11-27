import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {fixture,worker} from './helpers/payment-v2.mjs';

// Offline-only SQLite and bundled Worker. No order/payment/refund fixtures,
// provider requests, remote D1, release actions or real financial events.
// Seed synthetic application rows solely to exercise administrative workflow.
test('manual applications: owner isolation, minimum, admin handling and terminal state',async t=>{
 const f=fixture({released:false}),db=f.sql;t.after(()=>db.close());
 for(const name of ['partners_v1a_policy_proposal.sql','partners_manual_record_proposal.sql'])db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',PAYMENTS_ENABLED:'0',XIAODOU_WEBHOOKS_ENABLED:'0'});
 const tokens={};
 for(const [id,role] of [['owner','admin'],['partner','user'],['ordinary','user'],['other','user']]){
  const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');tokens[id]=token;
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture-hash',?)").run(id,id+'@example.test','fixture-'+id,role);
  db.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'web',1,?)").run('session-'+id,createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
 }
 db.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'owner',1)");
 const me='/v1/partners/manual-report',admin='/v1/admin/partners/manual-report',policy='/v1/admin/partners/policy';
 async function call(id,path,body,extra={}){
  const token=tokens[id],headers={Origin:f.env.WEB_ORIGIN,'Content-Type':'application/json','X-Reply-Copilot-Action':'1',...(token?{Cookie:'rc_session='+token,'X-CSRF-Token':createHmac('sha256',f.env.AUTH_HASH_SECRET).update('csrf:'+token).digest('hex')}:{}),...extra};
  const res=await worker.fetch(new Request(f.env.API_ORIGIN+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);
  return {status:res.status,body:await res.json(),cache:res.headers.get('Cache-Control')};
 }
 async function ok(...args){const r=await call(...args);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
 assert.equal((await call(null,me)).status,401);
 assert.deepEqual(await ok('partner',me),{enabled:false});
 assert.deepEqual(await ok('owner',admin),{enabled:false});
 assert.equal((await call('ordinary',admin)).status,403);
 db.exec("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled')");
 db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('session-owner',?)").run(Date.now()+3600000);
 for(const userId of ['partner','other'])await ok('owner',policy,{userId,operationId:randomUUID(),status:'active',level:'standard',rateBps:2000,termMonths:null,expectedVersion:0,reason:'offline workflow fixture'});
 assert.deepEqual(await ok('ordinary',me+'?userId=partner'),{enabled:false});
 const empty=await call('partner',me);assert.equal(empty.status,200);assert.equal(empty.cache,'no-store');
 assert.equal(empty.body.minRequestFen,1000);assert.equal(empty.body.summary.estimatedFen,0);assert.equal(empty.body.requestableFen,null);
 assert.equal((await call('partner',me,{expectedAmountFen:999})).status,409);
 assert.equal((await call('partner',me,{expectedAmountFen:1000})).status,409);
 assert.equal((await call('partner',me,{expectedAmountFen:1000},{'X-CSRF-Token':'invalid'})).status,403);
 const requestId=randomUUID(),second=randomUUID();
 const seed=db.prepare("INSERT INTO partner_manual_requests(id,partner_user_id,amount_fen,created_at) VALUES(?,?,?,?)");
 assert.throws(()=>seed.run(randomUUID(),'partner',999,1));
 seed.run(requestId,'partner',1000,1);seed.run(second,'other',2000,2);
 assert.throws(()=>seed.run(randomUUID(),'partner',1000,3));
 assert.equal((await ok('partner',me)).pendingId,requestId);
 assert.equal((await ok('other',me+'?userId=partner')).pendingId,second);
 assert.equal((await ok('owner',admin)).queue.length,2);
 const resolve={requestId,operationId:randomUUID(),action:'completed',reason:'offline workflow state assertion'};
 assert.equal((await call('partner',admin,resolve)).status,403);
 assert.equal((await call('owner',admin,resolve,{'X-CSRF-Token':'invalid'})).status,403);
 assert.equal((await call('owner',admin,{...resolve,action:['completed']})).status,400);
 db.exec("DELETE FROM admin_reauth_sessions WHERE session_id='session-owner'");
 assert.equal((await call('owner',admin,resolve)).status,403);
 db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('session-owner',?)").run(Date.now()+3600000);
 await ok('owner',admin,resolve);
 assert.equal((await call('owner',admin,resolve)).status,409);
 const settled=await ok('partner',me);
 assert.equal(settled.pendingId,null);assert.equal(settled.records[0].status,'completed');assert.equal(settled.summary.recordedFen,1000);
 assert.equal(settled.requestableFen,null);assert.equal(settled.records[0].reason,undefined);
 assert.throws(()=>db.prepare("UPDATE partner_manual_requests SET amount_fen=2000 WHERE id=?").run(requestId));
 assert.throws(()=>db.prepare("DELETE FROM partner_manual_requests WHERE id=?").run(requestId));
 assert.throws(()=>db.prepare("UPDATE partner_manual_requests SET amount_fen=3000 WHERE id=?").run(second));
 await ok('owner',admin,{...resolve,requestId:second,operationId:randomUUID(),action:'rejected'});
 const rejected=await ok('other',me);assert.equal(rejected.pendingId,null);assert.equal(rejected.summary.recordedFen,0);assert.equal(rejected.records[0].status,'rejected');
 assert.equal((await ok('owner',admin)).queue.length,0);
 db.exec("UPDATE system_settings SET value='0' WHERE key='partner_manual_reporting_enabled'");
 assert.deepEqual(await ok('partner',me),{enabled:false});
 assert.equal((await call('partner',me,{expectedAmountFen:1000})).status,409);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_manual_requests').get().n,2);
});
