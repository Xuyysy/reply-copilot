import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';
import {DEFAULT_MOMENTUM_CONFIG} from '../../domain/creator-momentum.js';

function paid(f){
 f.sql.exec(`INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at,paid_at,credited_at)
 VALUES('paid-order','test-user','starter','fixture',400,149,'USD','paid',1,1,1);
 INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,status,provider_trade_id,created_at,updated_at,paid_at,risk_state,base_amount_fen,merchant_provider)
 VALUES('paid-txn','paid-order','xiaodou','CNY',1043,'paid','verified-transaction',1,1,1,'clear',990,'mk99');
 INSERT INTO credit_ledger(id,user_id,kind,paid_delta,reference_id,created_at)
 VALUES('real-purchase','test-user','purchase_grant',400,'paid-order',1);`);
}
const url='/v1/creator-momentum/insights';
function policy(f,ranges){f.sql.prepare("INSERT INTO system_settings(key,value,updated_at) VALUES('creator_momentum_v1',?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({...DEFAULT_MOMENTUM_CONFIG,version:'test-'+ranges[0][0],enabled:true,ranges}));}
function event(f,id,{at,status='succeeded',consumed=1,marker='verified'}){
 f.sql.prepare(`INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,delivery_confirmed_at,delivery_confirmation_id)
 VALUES('test-user',?,'2026-11-10',?,?,?,'hash',?,?,?)`).run(id,id,status,consumed,at-1000,at,marker);
}
test('paid-only insights deny anonymous and never return private metrics to free, gifted or refunded users',async()=>{
 const f=fixture();try{
  assert.equal((await f.call(url,{method:'GET',headers:{Cookie:''}})).status,401);
  assert.equal((await f.call(url,{method:'GET'})).status,403);
  f.sql.exec('UPDATE credit_accounts SET paid_balance=100');
  assert.equal((await f.call(url,{method:'GET'})).status,403,'a free gifted balance is not payment');
  paid(f);policy(f,[[1,2],[3,4],[5,6]]);
  assert.equal((await f.call(url,{method:'GET'})).status,200);
  f.sql.exec("UPDATE payment_transactions SET status='refunded'");
  assert.equal((await f.call(url,{method:'GET'})).status,403);
 }finally{f.sql.close();}
});
test('CMI is based only on current user server-confirmed delivery ACK events; admin range changes propagate',async()=>{
 const f=fixture();try{
  paid(f);const now=Date.now();const day=new Date(now+8*3600000).toISOString().slice(0,10);
  const start=Date.parse(day+'T00:00:00+08:00');
  event(f,'inside-day',{at:start+1000});
  event(f,'inside-day-two',{at:start+2000});
  event(f,'previous-day',{at:start-1000});
  event(f,'not-delivered',{at:start+4000,status:'reserved',consumed:0,marker:null});
  event(f,'no-marker',{at:start+4001,marker:null});
  policy(f,[[5,7],[10,12],[15,17]]);
  let r=await f.call(url,{method:'GET'});
  assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.totalConfirmed,2);
  assert.equal(r.body.stage,0);assert.equal(r.body.curve.length,24);
  assert.equal(r.body.eventSource,'server_confirmed_ai_delivery');
  const old=r.body.score;
  policy(f,[[1,1],[2,2],[3,3]]);
  r=await f.call(url,{method:'GET'});
  assert.equal(r.status,200);
  assert.equal(r.body.stage,2);assert.ok(r.body.score>old);
  assert.equal(r.body.policyVersion,'test-1');
  const rangeFields=JSON.stringify(r.body);
  assert.equal(rangeFields.includes('ranges'),false,'do not return secret thresholds');
  f.sql.exec("UPDATE system_settings SET value=replace(value,'\"enabled\":true','\"enabled\":false') WHERE key='creator_momentum_v1'");
  const off=await f.call(url,{method:'GET'});assert.equal(off.status,200);assert.equal(off.body.available,false);
  assert.equal(off.body.totalConfirmed,undefined);
 }finally{f.sql.close();}
});
