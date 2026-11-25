import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {alipayRequestPlan,alipayApprovePlan,alipayRejectPlan,alipayStartPlan,alipayOutcomePlan} from '../src/partner-transfer.mjs';
import {refundInsertPlan} from '../src/partner-ledger.mjs';
import {partnerSummaryPlan,payoutResolvePlan} from '../src/partner-payout.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT,email_verified_at INTEGER,archived_at INTEGER,is_test_account INTEGER);
 CREATE TABLE site_administrator(id INTEGER PRIMARY KEY,user_id TEXT REFERENCES users(id));
 CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER);
 INSERT INTO users VALUES('a','admin','active',1,NULL,0),('p','user','active',1,NULL,0),('q','user','active',1,NULL,0),('b','user','active',1,NULL,0);
 INSERT INTO site_administrator VALUES(1,'a');`);
 for(const name of ['partners_v1a_policy_proposal.sql','partners_v1b_ledger_proposal.sql','partners_v1d_payout_proposal.sql','partners_alipay_recipient_proposal.sql','partners_alipay_transfer_proposal.sql'])
 db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 db.exec(`INSERT INTO partner_policy_versions VALUES('p',1,'active','standard',2000,12,1,'a','test only');
 INSERT INTO partner_commissions VALUES('recharge','o','p','b',1,10,11,'product_principal','CNY',1000,2000,200,20,11);
 INSERT INTO partner_alipay_recipients VALUES('p',1,'fixture','000000000000000000000000','00000000000000000000000000000000','d***@***','测**',12);`);
 return db;
}
function enable(db){db.exec("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_alipay_recipient_enabled','partner_payout_enabled')");}
function run(db,p){return Number(db.prepare(p.sql).run(...p.params).changes);}
function batch(db,ps){db.exec('BEGIN');try{for(const p of ps)assert.equal(run(db,p),1);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
const request={requestId:'r',partnerId:'p',recipientVersion:1,amountFen:200,now:25};
const approve={...request,payoutId:'x',actorId:'a',now:30,reason:'verified fixture',items:[{orderDomain:'recharge',orderId:'o',amountFen:200}]};
const start={payoutId:'x',actorId:'a',now:40,reason:'verified fixture'};
const outcome={...start,now:50,outcome:'paid',amountFen:200,reference:'fixture-transfer'};
function ready(db){enable(db);assert.equal(run(db,alipayRequestPlan(request)),1);batch(db,alipayApprovePlan(approve));}
function state(db){return db.prepare("SELECT status FROM partner_payouts WHERE id='x'").get()?.status;}
test('application is default off and approval binds exact request amount and recipient version atomically',t=>{
 const db=fixture(t);assert.equal(run(db,alipayRequestPlan(request)),0);enable(db);
 assert.equal(run(db,alipayRequestPlan({...request,partnerId:'q'})),0);
 assert.equal(run(db,alipayRequestPlan(request)),1);
 assert.equal(run(db,alipayRequestPlan({...request,requestId:'r2'})),0);
 for(const patch of [{requestId:'missing'},{actorId:'q'},{items:[{...approve.items[0],amountFen:100}]}])
  assert.throws(()=>batch(db,alipayApprovePlan({...approve,...patch})));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_payouts').get().n,0);
 batch(db,alipayApprovePlan(approve));assert.equal(state(db),'reserved');
 assert.equal(db.prepare("SELECT recipient_version FROM partner_alipay_payout_destinations WHERE payout_id='x'").get().recipient_version,1);
 assert.equal(db.prepare("SELECT status FROM partner_alipay_requests WHERE id='r'").get().status,'approved');
 assert.equal(run(db,alipayRequestPlan({...request,requestId:'r2'})),0);
});
test('refund before transfer prevents start; unknown transfer stays locked',t=>{
 const db=fixture(t);ready(db);
 assert.equal(run(db,alipayStartPlan({...start,actorId:'q'})),0);
 assert.throws(()=>run(db,payoutResolvePlan({payoutId:'x',actorId:'a',now:35,status:'paid',transferReference:'bypass'})),/evidence/);
 assert.equal(run(db,alipayStartPlan(start)),1);
 assert.equal(run(db,alipayStartPlan({...start,now:41})),0);
 assert.throws(()=>run(db,payoutResolvePlan({payoutId:'x',actorId:'a',now:45,status:'cancelled'})),/unknown transfer/);
 assert.throws(()=>run(db,alipayOutcomePlan({...outcome,amountFen:199})),/invalid transfer outcome/);
 assert.equal(state(db),'reserved');
 assert.equal(run(db,alipayOutcomePlan({...outcome,outcome:'no_transfer',amountFen:0,reference:null})),1);
 assert.equal(state(db),'cancelled');
});
test('refund before manual transfer requires reconciliation',t=>{
 const db=fixture(t);ready(db);
 assert.equal(run(db,refundInsertPlan({orderDomain:'recharge',orderId:'o',refundEventId:'rr',cumulativePrincipalFen:500,now:35})),1);
 assert.throws(()=>run(db,alipayStartPlan(start)),/reconciliation/);
 assert.equal(state(db),'reserved');
});
test('actual successful transfer is recorded despite later refund or disabled gate',t=>{
 const db=fixture(t);ready(db);assert.equal(run(db,alipayStartPlan(start)),1);
 assert.equal(run(db,refundInsertPlan({orderDomain:'recharge',orderId:'o',refundEventId:'rr',cumulativePrincipalFen:1000,now:45})),1);
 db.exec("UPDATE system_settings SET value='0'");
 assert.equal(run(db,alipayOutcomePlan(outcome)),1);
 assert.equal(state(db),'paid');
 assert.equal(run(db,alipayOutcomePlan(outcome)),0);
 const plan=partnerSummaryPlan('p',60),s=db.prepare(plan.sql).get(...plan.params);
 assert.equal(s.paid_fen,200);assert.equal(s.outstanding_fen,-200);
 assert.throws(()=>db.exec("DELETE FROM partner_alipay_transfer_outcomes"),/immutable/);
});
test('owner can reject only a pending application',t=>{
 const db=fixture(t);enable(db);assert.equal(run(db,alipayRequestPlan(request)),1);
 const reject={requestId:'r',actorId:'a',now:30,reason:'fixture rejected'};
 assert.equal(run(db,alipayRejectPlan({...reject,actorId:'q'})),0);
 assert.equal(run(db,alipayRejectPlan(reject)),1);
 assert.equal(run(db,alipayRejectPlan(reject)),0);
 assert.throws(()=>batch(db,alipayApprovePlan(approve)));
});
