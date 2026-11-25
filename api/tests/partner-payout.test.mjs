import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {payoutReservePlan,payoutResolvePlan,partnerSummaryPlan} from '../src/partner-payout.mjs';
import {refundInsertPlan} from '../src/partner-ledger.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT,email_verified_at INTEGER,archived_at INTEGER,is_test_account INTEGER);
 CREATE TABLE site_administrator(id INTEGER PRIMARY KEY,user_id TEXT REFERENCES users(id));
 CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER);
 INSERT INTO users VALUES('a','admin','active',1,NULL,0),('p','user','active',1,NULL,0),('b','user','active',1,NULL,0),('q','user','active',1,NULL,0);
 INSERT INTO site_administrator VALUES(1,'a');`);
 for(const name of ['partners_v1a_policy_proposal.sql','partners_v1b_ledger_proposal.sql','partners_v1d_payout_proposal.sql'])
 db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 db.exec(`INSERT INTO partner_policy_versions VALUES('p',1,'active','standard',2000,12,1,'a','test only');
 INSERT INTO partner_commissions VALUES('recharge','o','p','b',1,10,11,'product_principal','CNY',1000,2000,200,20,11);`);
 return db;
}
const f={payoutId:'x',partnerId:'p',actorId:'a',now:30,reason:'local fixture',items:[{orderDomain:'recharge',orderId:'o',amountFen:200}]};
function run(db,p){return Number(db.prepare(p.sql).run(...p.params).changes);}
function batch(db,ps){db.exec('BEGIN');try{for(const p of ps){assert.equal(run(db,p),1);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
function enable(db){db.exec("UPDATE system_settings SET value='1' WHERE key='partner_payout_enabled'");}
function resolve(db,patch={}){return run(db,payoutResolvePlan({payoutId:'x',actorId:'a',now:40,status:'paid',transferReference:'demo-ref',...patch}));}
function summary(db,id='p'){const p=partnerSummaryPlan(id,50);return db.prepare(p.sql).get(...p.params);}
test('default-off, ownership, hold, duplicate and partial transaction protection',t=>{
 const db=fixture(t);
 assert.throws(()=>batch(db,payoutReservePlan(f)));enable(db);
 for(const patch of [{partnerId:'q'},{actorId:'q'},{now:19},{items:[{...f.items[0],amountFen:201}]}])assert.throws(()=>batch(db,payoutReservePlan({...f,...patch})));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_payouts').get().n,0);
 batch(db,payoutReservePlan(f));
 assert.throws(()=>batch(db,payoutReservePlan({...f,payoutId:'y'})));
 assert.equal(summary(db).reserved_fen,200);assert.equal(summary(db,'q').orders,0);
 assert.equal(resolve(db,{actorId:'q'}),0);assert.equal(resolve(db),1);assert.equal(resolve(db),0);
 assert.throws(()=>batch(db,payoutReservePlan({...f,payoutId:'z'})));
 assert.equal(summary(db).paid_fen,200);
});
test('refund before settlement blocks confirmation; cancelled reservation releases',t=>{
 const db=fixture(t);enable(db);batch(db,payoutReservePlan(f));
 assert.equal(run(db,refundInsertPlan({orderDomain:'recharge',orderId:'o',refundEventId:'r',cumulativePrincipalFen:500,now:35})),1);
 assert.throws(()=>resolve(db),/reconciliation/);
 assert.equal(resolve(db,{status:'cancelled',transferReference:null}),1);
 batch(db,payoutReservePlan({...f,payoutId:'y',now:41,items:[{...f.items[0],amountFen:100}]}));
 assert.equal(resolve(db,{payoutId:'y',now:42}),1);
 assert.equal(summary(db).paid_fen,100);
});
test('post-payment refund preserves immutable paid amount and exposes negative net',t=>{
 const db=fixture(t);enable(db);batch(db,payoutReservePlan(f));assert.equal(resolve(db),1);
 assert.equal(run(db,refundInsertPlan({orderDomain:'recharge',orderId:'o',refundEventId:'r',cumulativePrincipalFen:1000,now:45})),1);
 assert.equal(summary(db).outstanding_fen,-200);assert.equal(summary(db).paid_fen,200);
 assert.throws(()=>db.exec("DELETE FROM partner_payouts"),/immutable/);
});
