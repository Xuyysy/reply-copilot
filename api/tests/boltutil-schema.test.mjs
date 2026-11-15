import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const proposal=fileURLToPath(new URL('../sql-proposals/0028_boltutil_usdt.sql',import.meta.url));
const script=`
import sqlite3,sys
db=sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.execute("CREATE TABLE users(id TEXT PRIMARY KEY)")
db.execute("CREATE TABLE recharge_orders(id TEXT PRIMARY KEY)")
db.execute("CREATE TABLE subscription_orders(id TEXT PRIMARY KEY)")
db.execute("INSERT INTO users VALUES('u1')")
db.execute("INSERT INTO recharge_orders VALUES('credit1')")
db.execute("INSERT INTO subscription_orders VALUES('sub1')")
with open(sys.argv[1],encoding="utf8") as f:
    db.executescript(f.read())
def put(id,ex,operation,kind,network,contract,decimals,other):
    db.execute("INSERT INTO boltutil_orders(id,external_order_id,user_id,operation_id,product_type,credit_order_id,subscription_order_id,network,token_contract,token_decimals,base_amount_fen,cny_per_usdt_micros,quoted_usdt_micros,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (id,ex,'u1',operation,kind,'credit1' if kind=='credits' else None,'sub1' if kind=='subscription' else None,network,contract,decimals,6990,7000000,9985715,'pending',0,0))
put('b1','inv1','op1','credits','TRC20','tron',6,0)
put('b2','inv2','op2','subscription','BEP20','bsc',18,0)
db.execute("UPDATE boltutil_orders SET tx_hash='hashx' WHERE id='b1'")
db.execute("UPDATE boltutil_orders SET tx_hash='hashx' WHERE id='b2'")
db.execute("INSERT INTO boltutil_payment_events VALUES('evt1','inv1','CONFIRMED','TRC20','hashx','digest',1)")
db.execute("INSERT INTO boltutil_payment_events VALUES('evt2','inv2','CONFIRMED','BEP20','hashx','digest',1)")
db.execute("UPDATE boltutil_orders SET payable_token_raw=? WHERE id='b2'",('12345678000000000000',))
assert db.execute("SELECT payable_token_raw FROM boltutil_orders WHERE id='b2'").fetchone()[0]=='12345678000000000000'
for sql,args in [
    ("INSERT INTO boltutil_payment_events VALUES(?,?,?,?,?,?,?)",('evt3','inv1','CONFIRMED','TRC20','hashx','x',1)),
    ("UPDATE boltutil_orders SET network='TRC20' WHERE id='b2'",()),
]:
    try: db.execute(sql,args)
    except sqlite3.IntegrityError: pass
    else:
        raise AssertionError('same-network transfer reuse accepted')
assert db.execute("SELECT COUNT(*) FROM boltutil_payment_events").fetchone()[0]==2
assert db.execute("SELECT COUNT(*) FROM boltutil_orders").fetchone()[0]==2
print("BOLTUTIL_SQL_SCHEMA_OK")
`;
test('BoltUtil proposal applies locally and enforces network-keyed transfer uniqueness',()=>{
  const run=spawnSync('python3',['-c',script,proposal],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/BOLTUTIL_SQL_SCHEMA_OK/);
});
