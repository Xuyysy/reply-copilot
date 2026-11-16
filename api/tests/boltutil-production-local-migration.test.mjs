import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './helpers/payment-v2.mjs';

/**
 * The entire fixture is built from the real, ordered Production migrations,
 * not a mocked users/orders schema. This test does NOT access remote D1.
 */
const proposal=readFileSync(new URL('../sql-proposals/0031_boltutil_five_networks_production_initial.sql',import.meta.url),'utf8');
const sanctioned=new Set([
 'boltutil_orders','boltutil_owner_recent_idx','boltutil_pending_idx',
 'boltutil_tx_unique','boltutil_payment_events','boltutil_payment_event_tx'
]);
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const objects=sql=>sql.prepare(
 "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
).all();
const tables=sql=>sql.prepare(
 "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all().map(row=>row.name);
const rows=sql=>Object.fromEntries(tables(sql).map(table=>[
 table,
 sql.prepare('SELECT * FROM '+quote(table)).all()
  .map(row=>JSON.stringify(row)).sort()
]));
const snapshot=sql=>({schema:objects(sql),tables:rows(sql)});
const fks=sql=>sql.prepare('PRAGMA foreign_key_check').all();
const integrity=sql=>sql.prepare('PRAGMA integrity_check').get().integrity_check;
function seedFiatEvidence(sql){
 const makeOrder=sql.prepare(
  "INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) "+
  "VALUES(?, 'test-user','starter','Fiat preserved',400,199,'USD','awaiting_payment',1)"
 );
 const makeTx=sql.prepare(
  "INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,status,created_at,updated_at,merchant_provider) "+
  "VALUES(?,?,'xiaodou','CNY',1990,'pending',1,1,?)"
 );
 for(const rail of ['mk99','xiaodou']){
  makeOrder.run('fiat-'+rail);
  makeTx.run('txn-fiat-'+rail,'fiat-'+rail,rail);
 }
 const plan=sql.prepare('SELECT id FROM subscription_plan_versions ORDER BY id LIMIT 1').get();
 assert.ok(plan?.id,'real Production subscription schema and seeded plan version required');
 sql.prepare(
  "INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,currency,status,quoted_at,quote_expires_at,created_at,updated_at) "+
  "VALUES('fiat-sub','test-user',?,'purchase',1990,'CNY','pending',1,9999999,1,1)"
 ).run(plan.id);
}
function applyTransaction(sql){
 sql.exec('BEGIN IMMEDIATE');
 try{sql.exec(proposal);sql.exec('COMMIT');}
 catch(error){sql.exec('ROLLBACK');throw error;}
}
test('0031 locally adds exactly the proposed tables/indexes to full Production schema without altering real fiat rows or schema',()=>{
 const f=fixture();
 try{
  const sql=f.sql;
  seedFiatEvidence(sql);
  assert.equal(sql.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.equal(integrity(sql),'ok');
  assert.deepEqual(fks(sql),[]);
  const before=snapshot(sql);
  const stripped=proposal.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n');
  assert.doesNotMatch(stripped,/\b(?:DROP|ALTER|DELETE|UPDATE|REPLACE|ATTACH|DETACH|VACUUM)\b/i);
  assert.equal(before.schema.some(item=>item.name.startsWith('boltutil_')),false);
  applyTransaction(sql);
  const after=snapshot(sql);
  const extra=after.schema.filter(item=>!before.schema.some(old=>old.name===item.name));
  assert.deepEqual(new Set(extra.map(item=>item.name)),sanctioned);
  assert.deepEqual(after.schema.filter(item=>!sanctioned.has(item.name)),before.schema,
   'existing CNY table definitions, triggers and indexes cannot change');
  for(const [table,entries] of Object.entries(before.tables))
   assert.deepEqual(after.tables[table],entries,'pre-existing records changed: '+table);
  assert.deepEqual(fks(sql),[]);
  assert.equal(integrity(sql),'ok');
  assert.equal(sql.prepare("SELECT merchant_provider FROM payment_transactions WHERE id='txn-fiat-mk99'").get().merchant_provider,'mk99');
  assert.equal(sql.prepare("SELECT merchant_provider FROM payment_transactions WHERE id='txn-fiat-xiaodou'").get().merchant_provider,'xiaodou');
  assert.equal(sql.prepare("SELECT currency FROM subscription_orders WHERE id='fiat-sub'").get().currency,'CNY');
  console.log('LOCAL_FULL_PRODUCTION_D1_0031_ADD_ONLY_VALIDATED');
 }finally{f.sql.close();}
});
test('0031 preserves five-network isolation, signed-event tx uniqueness, CNY/USDT ledger separation and FK enforcement',()=>{
 const f=fixture();
 try{
  const sql=f.sql;applyTransaction(sql);
  const pack=sql.prepare(
   "INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) "+
   "VALUES(?,'test-user','starter','Crypto test',400,199,'USD','awaiting_payment',1)"
  );
  const order=sql.prepare(
   "INSERT INTO boltutil_orders(id,external_order_id,user_id,operation_id,product_type,credit_order_id,network,token_contract,token_decimals,base_amount_fen,cny_per_usdt_micros,quoted_usdt_micros,status,created_at,updated_at,tx_hash) "+
   "VALUES(?,?, 'test-user',?,'credits',?,?,'locally-checked-token',?,1990,7000000,1000000,'pending',1,1,?)"
  );
  const event=sql.prepare(
   "INSERT INTO boltutil_payment_events(event_id,external_order_id,status,network,tx_hash,body_sha256,received_at) "+
   "VALUES(?,?,'CONFIRMED',?,'same-transaction-hash','local-signed-proof',1)"
  );
  for(const [i,n] of ['TRC20','POLYGON','BEP20','ERC20','SOLANA'].entries()){
   const id='crypto-'+n,external='ext-'+n;
   pack.run(id);
   order.run(id,external,'op-'+n,id,n,n==='BEP20'?18:6,'same-transaction-hash');
   event.run('event-'+n,external,n);
  }
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boltutil_orders').get().n,5);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM boltutil_payment_events').get().n,5);
  assert.throws(()=>event.run('event-replay','ext-TRC20','TRC20'),/UNIQUE/);
  pack.run('crypto-bad');
  assert.throws(()=>order.run('bad-net','ext-bad','op-bad','crypto-bad','NOT_A_CHAIN',6,'different'),/CHECK/);
  assert.throws(()=>order.run('fake-user','ext-fake','op-fake','absent-fiat-order','TRC20',6,'different'),/FOREIGN KEY/);
  assert.throws(()=>sql.prepare(
   "INSERT INTO boltutil_payment_events(event_id,external_order_id,status,network,tx_hash,body_sha256,received_at) "+
   "VALUES('invalid-order','unknown-external','CONFIRMED','TRC20','fresh','local-hash',1)"
  ).run(),/FOREIGN KEY/);
  assert.deepEqual(fks(sql),[]);assert.equal(integrity(sql),'ok');
  assert.equal(sql.prepare("SELECT count(*) AS n FROM payment_transactions").get().n,0);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM subscription_payment_transactions").get().n,0);
 }finally{f.sql.close();}
});
test('0031 safely fails repeated execution or unexpected partial pre-existing BoltUtil schema, with explicit rollback',()=>{
 for(const partial of ['none','orders-exist','events-exist']){
  const f=fixture();
  try{
   const sql=f.sql;seedFiatEvidence(sql);
   if(partial==='orders-exist')sql.exec('CREATE TABLE boltutil_orders(previous TEXT NOT NULL)');
   if(partial==='events-exist')sql.exec('CREATE TABLE boltutil_payment_events(previous TEXT NOT NULL)');
   if(partial==='none')applyTransaction(sql);
   const before=snapshot(sql);
   assert.throws(()=>applyTransaction(sql),/already exists/,'unexpected schema should never be silently overwritten');
   assert.deepEqual(snapshot(sql),before,
     'failure rollback must preserve pre-existing financial evidence');
   assert.deepEqual(fks(sql),[]);assert.equal(integrity(sql),'ok');
   if(partial==='events-exist')
    assert.equal(sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='boltutil_orders'").get().n,0,
     'a failure at the second CREATE TABLE must rollback the first CREATE TABLE');
  }finally{f.sql.close();}
 }
});
