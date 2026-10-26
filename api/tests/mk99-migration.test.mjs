import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const root=new URL('../migrations/',import.meta.url);
test('0016 is additive: all old rows and indexes survive, active settings stay closed and defaults never grant MK99',()=>{
 const sql=new DatabaseSync(':memory:');try{
 for(const name of readdirSync(root).filter(n=>n.endsWith('.sql')&&n<'0016').sort())sql.exec(readFileSync(new URL(name,root),'utf8'));
 sql.exec("INSERT INTO users(id,email,email_verified_at,created_at) VALUES('u','mock@example.test',1,1); INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) VALUES('order','u','starter','400',400,149,'USD','awaiting_payment',1); INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,status,provider_trade_id,created_at,updated_at,payment_protocol) VALUES('tx','order','xiaodou','CNY',1006,'unknown','XRH_historical',1,1,'epay'); INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,received_at) VALUES('e','xiaodou','historical','tx','PAYMENT_UNKNOWN',0,'CNY',1); UPDATE system_settings SET value='0' WHERE key='purchase_enabled';");
 const tables=['users','recharge_orders','payment_transactions','provider_payment_events','credit_accounts','credit_batches','credit_ledger','admin_audit_logs'];
 const original=tables.map(name=>({name,cols:sql.prepare(`PRAGMA table_info(${name})`).all().map(r=>r.name),rows:sql.prepare(`SELECT * FROM ${name}`).all()}));
 const settings=sql.prepare('SELECT * FROM system_settings').all(),indexes=sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' ORDER BY name").all();
 sql.exec(readFileSync(new URL('0016_mk99_merchant_routing.sql',root),'utf8'));
 for(const t of original)assert.deepEqual(sql.prepare(`SELECT ${t.cols.join(',')} FROM ${t.name}`).all(),t.rows);
 for(const row of settings)assert.deepEqual(sql.prepare('SELECT * FROM system_settings WHERE key=?').get(row.key),row);
 for(const row of indexes)assert.deepEqual(sql.prepare('SELECT name,sql FROM sqlite_master WHERE name=?').get(row.name),row);
 assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(sql.prepare("SELECT merchant_provider FROM payment_transactions WHERE id='tx'").get().merchant_provider,'xiaodou');assert.equal(sql.prepare("SELECT value FROM system_settings WHERE key='active_merchant'").get().value,'xiaodou');assert.equal(sql.prepare("SELECT value FROM system_settings WHERE key='payment_mk99_enabled'").get().value,'0');
 }finally{sql.close();}
});
