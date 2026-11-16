import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Staging-only five-network D1 proposal locally migrates a populated three-network database',()=>{
 const old=fileURLToPath(new URL('../sql-proposals/0028_boltutil_usdt.sql',import.meta.url));
 const migration=fileURLToPath(new URL('../sql-proposals/0030_boltutil_five_networks_staging.sql',import.meta.url));
 const py=`
import sqlite3,sys
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for name in ['users','recharge_orders','subscription_orders']:
 db.execute('CREATE TABLE '+name+'(id TEXT PRIMARY KEY)')
db.execute("INSERT INTO users VALUES('u1')")
for code in ['c1','c2','c3']:
 db.execute('INSERT INTO recharge_orders VALUES(?)',(code,))
with open(sys.argv[1],encoding='utf8') as f:
 old=f.read()
assert "('TRC20','POLYGON','BEP20','ERC20','SOLANA')" not in old
assert "('TRC20','POLYGON','BEP20')" in old
db.executescript(old)
def order(id,net,credit):
 db.execute("INSERT INTO boltutil_orders(id,external_order_id,user_id,operation_id,product_type,credit_order_id,network,token_contract,token_decimals,base_amount_fen,cny_per_usdt_micros,quoted_usdt_micros,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(id,'ex'+id,'u1','op'+id,'credits',credit,net,'contract',6,6990,7000000,1000000,'pending',1,1))
order('1','TRC20','c1')
db.execute("INSERT INTO boltutil_payment_events VALUES('evt1','ex1','CONFIRMED','TRC20','hash','digest',1)")
db.commit()
with open(sys.argv[2],encoding='utf8') as f:m=f.read()
db.executescript('BEGIN;\\n'+m+'\\nCOMMIT;')
assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
assert db.execute("SELECT network FROM boltutil_orders WHERE id='1'").fetchone()[0]=='TRC20'
assert db.execute('SELECT count(*) FROM boltutil_payment_events').fetchone()[0]==1
order('2','ERC20','c2')
order('3','SOLANA','c3')
assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
assert db.execute('SELECT count(*) FROM boltutil_orders').fetchone()[0]==3
try:
 db.execute("INSERT INTO boltutil_payment_events VALUES('evt2','ex1','CONFIRMED','TRC20','hash','x',1)")
 raise AssertionError('duplicate same-chain transfer accepted')
except sqlite3.IntegrityError:pass
print('FIVE_NETWORK_MIGRATION_OK')
`;
 const run=spawnSync('python3',['-c',py,old,migration],{encoding:'utf8',timeout:15000});
 assert.equal(run.status,0,run.stderr||run.stdout);
 assert.match(run.stdout,/FIVE_NETWORK_MIGRATION_OK/);
});
