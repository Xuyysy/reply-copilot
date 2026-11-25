import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {accrualEnqueuePlan,dueAccrualPlan,recoveryFailurePlan,recoveredAccrualPlan} from '../src/partner-recovery.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT,email_verified_at INTEGER,archived_at INTEGER,is_test_account INTEGER);
 CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER);
 CREATE TABLE referral_invites(invited_user_id TEXT PRIMARY KEY,inviter_user_id TEXT,registered_at INTEGER,status TEXT);
 INSERT INTO users VALUES('a','admin','active',1,NULL,0),('p','user','active',1,NULL,0),('b','user','active',1,NULL,0);
 INSERT INTO referral_invites VALUES('b','p',100,'pending');`);
 for(const name of ['partners_v1a_policy_proposal.sql','partners_v1b_ledger_proposal.sql','partners_v1b_recovery_proposal.sql'])
 db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 db.exec("INSERT INTO partner_policy_versions VALUES('p',1,'active','standard',2000,12,200,'a','test only')");
 return db;
}
function enable(db){db.exec("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled')");}
function window(db){db.exec("INSERT INTO partner_accrual_windows VALUES('w',300,NULL,'product_principal',100,'a','fixture only')");}
function run(db,p){return Number(db.prepare(p.sql).run(...p.params).changes);}
function batch(db,ps){db.exec('BEGIN');try{for(const p of ps)run(db,p);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
const order={orderDomain:'recharge',orderId:'o',paidAt:350,now:360};
const facts={...order,partnerUserId:'p',buyerUserId:'b',policyVersion:1,appliedAt:351,holdUntil:451,registeredAt:100,firstAuthorizedAt:200,termMonths:12,currency:'CNY',basis:'product_principal',principalFen:1000,rateBps:2000};
const input={facts,windowId:'w',attempts:0,refundPrincipalFen:250};
function due(db,now){const p=dueAccrualPlan(now);return db.prepare(p.sql).all(...p.params);}
test('default off, no old orders, closed interval and duplicate enqueue',t=>{
 const db=fixture(t);window(db);assert.equal(run(db,accrualEnqueuePlan(order)),0);enable(db);
 assert.equal(run(db,accrualEnqueuePlan({...order,paidAt:299})),0);
 assert.equal(run(db,accrualEnqueuePlan(order)),1);assert.equal(run(db,accrualEnqueuePlan(order)),0);
 assert.throws(()=>db.exec("INSERT INTO partner_accrual_windows VALUES('w2',301,NULL,'product_principal',100,'a','fixture only')"));
 db.exec("UPDATE partner_accrual_windows SET ends_at=400 WHERE id='w'");
 db.exec("INSERT INTO partner_accrual_windows VALUES('w2',500,NULL,'product_principal',100,'a','fixture only')");
 assert.equal(run(db,accrualEnqueuePlan({...order,orderId:'gap',paidAt:450,now:600})),0);
 assert.equal(run(db,accrualEnqueuePlan({...order,orderId:'new',paidAt:500,now:600})),1);
});
test('atomic gross, prior partial refund, done state and replay',t=>{
 const db=fixture(t);enable(db);window(db);run(db,accrualEnqueuePlan(order));
 batch(db,recoveredAccrualPlan(input));
 assert.equal(db.prepare("SELECT commission_fen FROM partner_commissions").get().commission_fen,200);
 assert.equal(db.prepare("SELECT delta_fen FROM partner_commission_refunds").get().delta_fen,-50);
 assert.equal(db.prepare("SELECT state FROM partner_accrual_jobs").get().state,'done');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_recovery_assertions").get().n,0);
 assert.throws(()=>batch(db,recoveredAccrualPlan(input)));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_commissions").get().n,1);
});
test('stale policy, wrong hold, disabled gate and stale attempt never partially commit',t=>{
 const db=fixture(t);enable(db);window(db);run(db,accrualEnqueuePlan(order));
 for(const patch of [{facts:{...facts,rateBps:2100}},{facts:{...facts,holdUntil:452}},{attempts:1}]){
 assert.throws(()=>batch(db,recoveredAccrualPlan({...input,...patch})));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_commissions").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_commission_refunds").get().n,0);
 }
 db.exec("UPDATE system_settings SET value='0' WHERE key='partner_cash_accrual_enabled'");
 assert.throws(()=>batch(db,recoveredAccrualPlan(input)));
 assert.equal(db.prepare("SELECT state FROM partner_accrual_jobs").get().state,'pending');
});
test('bounded retry, CAS and manual review',t=>{
 const db=fixture(t);enable(db);window(db);run(db,accrualEnqueuePlan(order));
 assert.equal(due(db,360).length,1);
 const failure={...order,attempts:0,code:'temporary_failure'};
 assert.equal(run(db,recoveryFailurePlan(failure)),1);
 assert.equal(run(db,recoveryFailurePlan(failure)),0);
 assert.equal(due(db,361).length,0);
 assert.equal(due(db,30360).length,1);
 assert.equal(run(db,recoveryFailurePlan({...failure,attempts:1,now:30360,code:'risk_review',review:true})),1);
 assert.equal(due(db,99999999).length,0);
 assert.equal(db.prepare("SELECT state FROM partner_accrual_jobs").get().state,'review');
});
