import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {localPerformanceDb,measure} from './helpers/d1-performance.mjs';
const sql=readFileSync(new URL('../src/creator-momentum.ts',import.meta.url),'utf8').match(/prepare\(`(SELECT \(SELECT value[\s\S]*?)`\)/)[1];
test('isolated workerd: purchase qualification row cost and plan by order volume',{timeout:45000},async()=>{
 const report=[];
 for(const size of [100,1000,10000]){
  const f=await localPerformanceDb(size);
  try{
   await f.applyIndexes();
   const scenarios={noPurchase:await measure(f.db,sql,['creator_momentum_v1','u0']),noOrders:await measure(f.db,sql,['creator_momentum_v1','u1'])};
   await f.db.prepare("UPDATE recharge_orders SET status='paid',paid_at=1,credited_at=1 WHERE id='order0'").run();
   await f.db.prepare("INSERT INTO payment_transactions(id,order_id,provider,merchant_provider,currency,amount_fen,status,provider_trade_id,created_at,updated_at,paid_at,risk_state,base_amount_fen) VALUES('txn','order0','xiaodou','mk99','CNY',100,'paid','mock-proof',1,1,1,'clear',100)").run();
   await f.db.prepare("INSERT INTO credit_ledger(id,user_id,kind,paid_delta,reference_id,created_at) VALUES('purchase','u0','purchase_grant',400,'order0',1)").run();
   await f.db.prepare("INSERT INTO payment_transactions(id,order_id,provider,merchant_provider,currency,amount_fen,status,provider_trade_id,created_at,updated_at,paid_at,risk_state,base_amount_fen) SELECT 'paid-'||id,id,'xiaodou','mk99','CNY',100,'paid','mock-'||id,1,1,1,'clear',100 FROM recharge_orders WHERE id!='order0'").run();
   scenarios.oldestPaid=await measure(f.db,sql,['creator_momentum_v1','u0']);
   await f.db.prepare("UPDATE payment_transactions SET principal_refunded_fen=100 WHERE id='txn'").run();
   scenarios.noValidAmongPaid=await measure(f.db,sql,['creator_momentum_v1','u0']);
   assert.equal(scenarios.noValidAmongPaid.results[0].eligible,0);
   assert.equal(scenarios.noPurchase.results[0].eligible,0);
   assert.equal(scenarios.oldestPaid.results[0].eligible,1);
   report.push({size,scenarios});
  }finally{await f.close();}
 }
 writeFileSync('/private/tmp/creator-qualification-performance.json',JSON.stringify(report,null,2));
});
