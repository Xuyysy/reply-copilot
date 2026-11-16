import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Production five-chain initial SQL is additive, retains ordinary tables, enforces network and transaction uniqueness',()=>{
 const proposal=fileURLToPath(new URL('../sql-proposals/0031_boltutil_five_networks_production_initial.sql',import.meta.url));
 const py=String.raw`
import sqlite3,sys
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for name in ['users','recharge_orders','subscription_orders']:
 db.execute('CREATE TABLE '+name+'(id TEXT PRIMARY KEY)')
db.execute("INSERT INTO users VALUES('existing-prod-user')")
for i in range(5):db.execute('INSERT INTO recharge_orders VALUES(?)',('c'+str(i),))
db.commit()
sql=open(sys.argv[1],encoding='utf8').read()
assert 'DROP TABLE' not in sql and 'ALTER TABLE' not in sql
assert "('TRC20','POLYGON','BEP20','ERC20','SOLANA')" in sql
assert "('TRC20','POLYGON','BEP20')" not in sql
db.executescript(sql)
assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
for i,network in enumerate(['TRC20','POLYGON','BEP20','ERC20','SOLANA']):
 db.execute("INSERT INTO boltutil_orders(id,external_order_id,user_id,operation_id,product_type,credit_order_id,network,token_contract,token_decimals,base_amount_fen,cny_per_usdt_micros,quoted_usdt_micros,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  (str(i),'ext'+str(i),'existing-prod-user','op'+str(i),'credits','c'+str(i),network,'token',18 if network=='BEP20' else 6,6990,7000000,1000000,'pending',1,1))
 db.execute("INSERT INTO boltutil_payment_events(event_id,external_order_id,status,network,tx_hash,body_sha256,received_at) VALUES(?,?,?,?,?,?,?)",
  ('ev'+str(i),'ext'+str(i),'CONFIRMED',network,'same_hash','digest',1))
assert db.execute('SELECT COUNT(*) FROM boltutil_orders').fetchone()[0]==5
assert db.execute('SELECT COUNT(*) FROM boltutil_payment_events').fetchone()[0]==5
assert db.execute('SELECT COUNT(*) FROM users').fetchone()[0]==1
assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
try:
 db.execute("INSERT INTO boltutil_payment_events(event_id,external_order_id,status,network,tx_hash,body_sha256,received_at) VALUES('duplicate','ext0','CONFIRMED','TRC20','same_hash','digest',1)")
 raise AssertionError('same-chain tx replay was accepted')
except sqlite3.IntegrityError:pass
try:
 db.executescript(sql)
 raise AssertionError('initial-only SQL unexpectedly allowed re-application')
except sqlite3.OperationalError:pass
assert db.execute('SELECT COUNT(*) FROM boltutil_orders').fetchone()[0]==5
assert db.execute('SELECT COUNT(*) FROM users').fetchone()[0]==1
print('PRODUCTION_INITIAL_FIVE_CHAIN_SCHEMA_OK')
`;
 const run=spawnSync('python3',['-c',py,proposal],{encoding:'utf8',timeout:15000});
 assert.equal(run.status,0,run.stderr||run.stdout);
 assert.match(run.stdout,/PRODUCTION_INITIAL_FIVE_CHAIN_SCHEMA_OK/);
});
