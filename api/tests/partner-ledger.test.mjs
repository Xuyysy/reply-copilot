import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {commissionFen,termEnd,commissionInsertPlan,refundInsertPlan} from '../src/partner-ledger.mjs';
const sql=name=>readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8');
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT,email_verified_at INTEGER,archived_at INTEGER,is_test_account INTEGER);
 CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER);
 CREATE TABLE referral_invites(invited_user_id TEXT PRIMARY KEY,inviter_user_id TEXT,registered_at INTEGER,status TEXT);
 INSERT INTO users VALUES ('owner','admin','active',1,NULL,0),('p','user','active',1,NULL,0),('b','user','active',1,NULL,0),('other','user','active',1,NULL,0);
 INSERT INTO referral_invites VALUES('b','p',100,'pending');`);
 db.exec(sql('partners_v1a_policy_proposal.sql'));db.exec(sql('partners_v1b_ledger_proposal.sql'));
 db.exec("INSERT INTO partner_policy_versions VALUES('p',1,'active','standard',2000,12,200,'owner','test only')");
 return db;
}
const facts={orderDomain:'recharge',orderId:'order1',partnerUserId:'p',buyerUserId:'b',policyVersion:1,paidAt:300,appliedAt:301,now:302,holdUntil:1000,registeredAt:100,firstAuthorizedAt:200,termMonths:12,currency:'CNY',basis:'product_principal',principalFen:1001,rateBps:2000};
function run(db,p){return p?Number(db.prepare(p.sql).run(...p.params).changes):0;}
function enable(db){db.exec("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled')");}
test('integer arithmetic, UTC term and strict input',()=>{
 assert.equal(commissionFen(1001,2000),200);
 assert.equal(commissionFen(1000000000000,9999),999900000000);
 assert.equal(termEnd(Date.UTC(2024,0,31),1),Date.UTC(2024,1,29));
 assert.throws(()=>commissionFen(1.5,2000));
 assert.throws(()=>commissionInsertPlan({...facts,basis:'gross'}));
 assert.equal(commissionInsertPlan({...facts,principalFen:1}),null);
});
test('default off, historic policy and original referral required; no reward cap dependency',t=>{
 const db=fixture(t);assert.equal(run(db,commissionInsertPlan(facts)),0);
 db.exec("UPDATE system_settings SET value='1' WHERE key='partner_program_enabled'");
 assert.equal(run(db,commissionInsertPlan(facts)),0);enable(db);
 for(const patch of [{partnerUserId:'other'},{registeredAt:101},{firstAuthorizedAt:201},{rateBps:2500},{termMonths:null},{policyVersion:2}])
   assert.equal(run(db,commissionInsertPlan({...facts,...patch})),0);
 assert.equal(run(db,commissionInsertPlan(facts)),1);
 assert.equal(run(db,commissionInsertPlan(facts)),0);
 assert.equal(run(db,commissionInsertPlan({...facts,orderDomain:'subscription'})),1);
 db.exec("INSERT INTO partner_policy_versions VALUES('p',2,'paused','standard',2000,12,400,'owner','test only')");
 assert.equal(run(db,commissionInsertPlan({...facts,orderId:'late',paidAt:500,appliedAt:501,now:502})),0);
 assert.equal(run(db,commissionInsertPlan({...facts,orderId:'before-pause'})),1);
 db.exec("UPDATE users SET is_test_account=1 WHERE id='b'");
 assert.equal(run(db,commissionInsertPlan({...facts,orderId:'test'})),0);
 assert.throws(()=>db.exec("UPDATE partner_commissions SET commission_fen=0"),/immutable/);
});
test('refunds are monotonic, cumulative, replay safe and preserve paid history',t=>{
 const db=fixture(t);enable(db);assert.equal(run(db,commissionInsertPlan(facts)),1);
 const refund={orderDomain:'recharge',orderId:'order1',refundEventId:'r1',cumulativePrincipalFen:101,now:400};
 assert.equal(run(db,refundInsertPlan(refund)),1);
 assert.equal(run(db,refundInsertPlan(refund)),0);
 assert.equal(run(db,refundInsertPlan({...refund,refundEventId:'old',cumulativePrincipalFen:99})),0);
 assert.equal(run(db,refundInsertPlan({...refund,refundEventId:'too-much',cumulativePrincipalFen:1002})),0);
 assert.equal(run(db,refundInsertPlan({...refund,refundEventId:'r2',cumulativePrincipalFen:502})),1);
 db.exec("UPDATE system_settings SET value='0' WHERE key='partner_cash_accrual_enabled'");
 assert.equal(run(db,refundInsertPlan({...refund,refundEventId:'r3',cumulativePrincipalFen:1001})),1);
 const totals=db.prepare("SELECT SUM(delta_fen) delta,MAX(cumulative_reversal_fen) reversed FROM partner_commission_refunds").get();
 assert.equal(totals.delta,-200);assert.equal(totals.reversed,200);
 assert.equal(db.prepare("SELECT commission_fen FROM partner_commissions").get().commission_fen,200);
 assert.throws(()=>db.exec("DELETE FROM partner_commission_refunds"),/immutable/);
});
test('term expires at boundary and changing rate does not reset first authorization',t=>{
 const db=fixture(t);enable(db);
 const end=termEnd(200,12);
 assert.equal(commissionInsertPlan({...facts,paidAt:end,appliedAt:end,now:end,holdUntil:end}),null);
});
