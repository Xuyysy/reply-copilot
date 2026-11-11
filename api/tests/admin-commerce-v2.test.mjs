import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';

function admin(){
 const f=fixture();
 f.env.ADMIN_PORTAL_ENABLED='1';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
 return f;
}
function seedCredit(f,id,at,verified=false){
 const packageId=f.sql.prepare('SELECT id FROM recharge_packages LIMIT 1').get().id;
 f.sql.prepare(`INSERT INTO recharge_orders
 (id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at,paid_at,credited_at)
 VALUES (?,'test-user',?,'Starter',400,149,'USD','paid',?,?,?)`).run(id,packageId,at,at,at);
 if(!verified)return;
 const tid='transaction-'+id;
 f.sql.prepare(`INSERT INTO payment_transactions
 (id,order_id,provider,currency,amount_fen,status,created_at,updated_at,paid_at,merchant_provider,merchant_account,notification_sign_type)
 VALUES (?,?,'xiaodou','CNY',699,'paid',?,?,?,'mk99','merchant-test','MD5')`).run(tid,id,at,at,at);
 f.sql.prepare(`INSERT INTO provider_payment_events
 (id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at,merchant_provider)
 VALUES (?,'xiaodou',?,?,'PAYMENT_SUCCEEDED',699,'CNY',?,?, 'mk99')`)
  .run('event-'+id,'proof-'+id,tid,'a'.repeat(64),at);
}
function seedSubscription(f,id,at,merchant='mk99'){
 const now=Date.now(),tid='transaction-'+id,period='period-'+id;
 f.sql.prepare(`INSERT INTO subscription_orders
 (id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at)
 VALUES (?,'test-user','basic-v1','purchase',6990,'paid',1,9999999999999,?,?,?,?)`)
  .run(id,at,at,at,at);
 f.sql.prepare(`INSERT INTO subscription_payment_transactions
 (id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,
  notification_sign_type,status,risk_state,created_at,updated_at,paid_at)
 VALUES (?,?,?,?,? ,?,6990,?, 'paid','clear',?,?,?)`)
  .run(tid,id,merchant,merchant==='local_mock'?null:'merchant-1','trade-'+id,
    merchant==='local_mock'?'LOCAL_MOCK':'ALIPAY_H5',merchant==='local_mock'?null:'MD5',at,at,at);
 f.sql.prepare(`INSERT INTO subscription_payment_events
 (id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at)
 VALUES (?,?,?,?,'PAYMENT_SUCCEEDED',6990,?,?)`)
  .run('event-'+id,tid,merchant,'proof-'+id,merchant==='local_mock'?null:'a'.repeat(64),at);
 const start=now-86400000;
 f.sql.prepare(`INSERT INTO subscription_periods
 (id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at)
 VALUES (?,'test-user',?,'basic-v1',500,'active',?,?,?,?)`)
  .run(period,id,start,start+30*86400000,at,at);
 f.sql.prepare('INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES (?,1,14,2,?)').run(period,at);
}
test('Admin B2 merges credit packs and subscriptions without granting extra credits',async()=>{
 const f=admin();
 try{
  const now=Date.now();
  seedCredit(f,'credit-order',now-2000);
  seedSubscription(f,'sub-order',now-1000);
  const r=await f.call('/v1/admin/commerce/orders',{method:'GET'});
  assert.equal(r.status,200,JSON.stringify(r));
  assert.deepEqual(r.body.items.map(x=>[x.product_type,x.id]),[['subscription','sub-order'],['credit','credit-order']]);
  assert.equal(r.body.items[0].payment_evidence,'verified_event');
  assert.equal(r.body.items[1].payment_evidence,'credited_legacy');
  const s=await f.call('/v1/admin/commerce/orders?product=subscription',{method:'GET'});
  assert.equal(s.status,200);assert.equal(s.body.items.length,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM credit_ledger').get().n,0);
 }finally{f.sql.close();}
});
test('Admin B3 verified gross excludes legacy-only credit and exposes subscription usage independently',async()=>{
 const f=admin();
 try{
  const now=Date.now();
  seedCredit(f,'credit-no-proof',now-2000);
  seedSubscription(f,'sub-real',now-1000);
  const r=await f.call('/v1/admin/commerce/summary',{method:'GET'});
  assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.body.verifiedCredit.gross_fen,0);
  assert.equal(r.body.verifiedGrossFen,6990);
  assert.equal(r.body.verifiedSubscription[0].kind,'purchase');
  assert.equal(r.body.creditConfirmedRefunds.amount_fen,0);
  const p=await f.call('/v1/admin/commerce/users/test-user',{method:'GET'});
  assert.equal(p.status,404,'commerce user route uses UUID for safety');
  const q=await f.call('/v1/admin/commerce/orders?product=subscription&status=paid',{method:'GET'});
  assert.equal(q.body.items.length,1);
 }finally{f.sql.close();}
});
test('Admin commerce endpoints require an admin and reject malformed selectors',async()=>{
 const f=fixture();
 try{
  f.env.ADMIN_PORTAL_ENABLED='1';
  assert.equal((await f.call('/v1/admin/commerce/orders',{method:'GET'})).status,403);
  assert.equal((await f.call('/v1/admin/commerce/summary',{method:'GET'})).status,403);
  f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
  for(const q of ['product=not-real','status=invalid','cursor=bad','from=1&to=999999999999999','q='+('x'.repeat(125))]){
   const r=await f.call('/v1/admin/commerce/orders?'+q,{method:'GET'});
   assert.equal(r.status,400,q+' '+JSON.stringify(r));
  }
 }finally{f.sql.close();}
});
