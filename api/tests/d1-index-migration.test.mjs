import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const root=new URL('../migrations/',import.meta.url);
test('0020 adds only indexes and leaves all pre-existing business rows and table schemas identical',()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const name of readdirSync(root).filter(x=>x.endsWith('.sql')&&x<'0020').sort())db.exec(readFileSync(new URL(name,root),'utf8'));
  db.exec(`INSERT INTO users(id,email,email_verified_at,created_at,username) VALUES('existing','existing@example.test',1,1,'ExistingUser');
   INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('existing',200,400,1,1);
   INSERT INTO credit_grants(user_id,grant_type,amount,created_at) VALUES('existing','signup',200,1);
   INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES('free','existing','free','signup',200,200,1,'tracked','active'),('paid','existing','paid','legacy_paid',400,400,1,'legacy_unknown','active');
   INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) VALUES('signup','existing','signup_grant',200,0,'existing',1);
   INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) VALUES('old-order','existing','starter','Original snapshot',400,100,'USD','pending',1);
   INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,generation_phase) VALUES('existing','old-request','2026-10-01','old-nonce','succeeded',1,'hash',1,'unknown');
   INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) VALUES('existing','old-request','legacy',1,1,1,1);`);
  const tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const snapshot=()=>Object.fromEntries(tables.map(t=>[t.name,db.prepare('SELECT * FROM "'+t.name+'"').all().map(x=>JSON.stringify(x)).sort()]));
  const before=snapshot();db.exec(readFileSync(new URL('0020_d1_read_indexes.sql',root),'utf8'));
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(),tables);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name IN ('users_created_id_idx','credit_ledger_created_idx','recharge_orders_created_idx','admin_audit_logs_created_idx','ai_requests_user_created_idx','ai_requests_status_completed_idx','ai_usage_costs_created_idx')").get().n,7);
 }finally{db.close()}
});
