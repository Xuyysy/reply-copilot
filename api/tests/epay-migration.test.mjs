import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
const migrations=new URL('../migrations/',import.meta.url);
test('0010 preserves legacy orders and amounts and tags only the protocol without touching the ledger or balances',()=>{
 const sql=new DatabaseSync(':memory:');
 try{
  for(const file of readdirSync(migrations).filter(x=>x.endsWith('.sql')&&!x.startsWith('0010')).sort())sql.exec(readFileSync(new URL(file,migrations),'utf8'));
  sql.exec("INSERT INTO users(id,email,email_verified_at,created_at) VALUES('legacy','legacy@example.test',1,1); INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('legacy',193,0,1,1); INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) VALUES('legacy-order','legacy','starter','400',400,149,'USD','awaiting_payment',1); INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,status,provider_trade_id,created_at,updated_at) VALUES('legacy-tx','legacy-order','xiaodou','CNY',1006,'unknown','XRH_legacy123',1,1)");
  const snapshot=()=>JSON.stringify(['users','recharge_orders','credit_accounts','credit_ledger','credit_batches','payment_attempts','provider_payment_events','payment_refunds'].map(t=>sql.prepare(`SELECT * FROM ${t}`).all()));
  const before=snapshot(),prior=sql.prepare('SELECT * FROM payment_transactions').get();sql.exec(readFileSync(new URL('0010_xiaodou_epay.sql',migrations),'utf8'));
  assert.equal(snapshot(),before);const {payment_protocol,epay_pid,epay_trade_no,...after}=sql.prepare('SELECT * FROM payment_transactions').get();assert.deepEqual(after,{...prior});assert.equal(payment_protocol,'rsa2');assert.equal(epay_pid,null);assert.equal(epay_trade_no,null);
 }finally{sql.close();}
});
