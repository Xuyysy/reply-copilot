import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,sign} from 'node:crypto';
import {fixture,withProvider,providerResponse,platform} from './helpers/payment-v2.mjs';

function owner({approved=true}={}){
 const f=fixture({released:false});
 f.env.ADMIN_PORTAL_ENABLED='1';
 f.env.ENVIRONMENT='production';
 f.env.XIAODOU_PRODUCTION_PILOT_ENABLED='1';
 f.env.XIAODOU_PRODUCTION_PILOT_TRADE_APPROVED=approved?'1':'0';
 f.env.XIAODOU_SOURCE_IP_CONFIRMED='0';
 f.env.XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED='1';
 f.env.XIAODOU_RSA2_SUBSCRIPTIONS_READY='0';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'");
 f.sql.exec("INSERT INTO site_administrator VALUES(1,'test-user',1)");
 f.sql.prepare("INSERT INTO admin_reauth_sessions VALUES('test-session',?)").run(Date.now()+900000);
 f.sql.exec("UPDATE system_settings SET value='mk99' WHERE key='active_merchant'");
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_rsa2_enabled','payment_rsa2_alipay_enabled','purchase_enabled')");
 f.sql.exec("UPDATE system_settings SET value='0' WHERE key='payment_rsa2_alipay_released'");
 return f;
}
const request=(override={})=>({operationId:randomUUID(),reason:'管理员明确确认小豆验收真实付款',packageId:'starter',
 expectedAmountFen:990,confirmation:'CREATE_REAL_ALIPAY_TEST_ORDER',...override});
const count=(f,table)=>f.sql.prepare('SELECT count(*) n FROM '+table).get().n;
async function create(f,body=request()){
 return await withProvider(r=>{
   const input=JSON.parse(r.body);
   assert.equal(new URL(r.url).pathname,'/api/open/v1/payments');
   assert.equal(r.method,'POST');
   assert.equal(input.amountFen,990);
   assert.equal(input.channel,'ALIPAY_H5');
   assert.match(input.subject,/小豆生产验收/);
   assert.equal(input.currency,'CNY');
   return providerResponse(r,{outTradeNo:input.outTradeNo,amountFen:990,channel:'ALIPAY_H5'});
 },()=>f.call('/v1/admin/payments/xiaodou/pilot',{body}));
}
function signedHeaders(event){
 const text=JSON.stringify(event);
 const keyId='test-platform',timestamp=String(Math.floor(Date.now()/1000)),nonce='abcdefgh12345678';
 const canonical=['XD-Webhook-v1',event.eventId,event.eventType,timestamp,nonce,keyId,createHash('sha256').update(text).digest('hex')].join('\n');
 return {'X-XD-Webhook-Event-Id':event.eventId,'X-XD-Webhook-Event-Type':event.eventType,
  'X-XD-Webhook-Timestamp':timestamp,'X-XD-Webhook-Nonce':nonce,'X-XD-Webhook-Key-Id':keyId,
  'X-XD-Webhook-Signature':sign('RSA-SHA256',Buffer.from(canonical),platform.privateKey).toString('base64')};
}
test('Production pilot is fail-closed unless vendor trade scope and Alipay are explicitly approved',async()=>{
 const f=owner({approved:false});
 try{
  const state=await f.call('/v1/admin/payments/xiaodou/pilot',{method:'GET'});
  assert.equal(state.status,200);
  assert.equal(state.body.eligible,false);
  assert.ok(state.body.blockers.includes('vendor_approval_unconfirmed'));
  const denied=await withProvider(()=>{throw Error('must not contact provider');},()=>f.call('/v1/admin/payments/xiaodou/pilot',{body:request()}));
  assert.equal(denied.status,409,JSON.stringify(denied.body));
  assert.equal(count(f,'admin_operations'),0);
  assert.equal(count(f,'recharge_orders'),0);
 }finally{f.sql.close();}
});
test('Production pilot requires the verified site administrator, password reauth and explicit price confirmation',async()=>{
 const f=owner();
 try{
  const badPrice=await f.call('/v1/admin/payments/xiaodou/pilot',{body:request({expectedAmountFen:1})});
  assert.equal(badPrice.status,409);
  const noConsent=await f.call('/v1/admin/payments/xiaodou/pilot',{body:request({confirmation:'yes'})});
  assert.equal(noConsent.status,400);
  assert.equal(count(f,'admin_operations'),0);
  f.sql.exec("DELETE FROM admin_reauth_sessions");
  const noReauth=await f.call('/v1/admin/payments/xiaodou/pilot',{body:request()});
  assert.equal(noReauth.status,403);
  assert.equal(noReauth.body.code,'ADMIN_REAUTH_REQUIRED');
  f.sql.exec("UPDATE users SET role='user' WHERE id='test-user'");
  const notAdmin=await f.call('/v1/admin/payments/xiaodou/pilot',{body:request()});
  assert.equal(notAdmin.status,403);
  assert.equal(count(f,'recharge_orders'),0);
 }finally{f.sql.close();}
});
test('Isolated ¥9.90 Production pilot preserves MK99 selection and records only one unpaid provider order',async()=>{
 const f=owner();
 try{
  const state=await f.call('/v1/admin/payments/xiaodou/pilot',{method:'GET'});
  assert.equal(state.status,200,JSON.stringify(state.body));
  assert.equal(state.body.eligible,true,JSON.stringify(state.body));
  assert.equal(state.body.amountFen,990);
  const op=request();
  const created=await create(f,op);
  assert.equal(created.status,201,JSON.stringify(created.body));
  assert.equal(created.body.order.amountFen,990);
  assert.equal(created.body.order.checkout.outcome,'ready');
  assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='active_merchant'").get().value,'mk99');
  const saved=f.sql.prepare('SELECT o.package_name,o.payment_method,o.credited_at,t.merchant_provider,t.amount_fen,t.payment_channel,t.merchant_account FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id').get();
  assert.match(saved.package_name,/^【小豆生产验收】/);
  assert.equal(saved.payment_method,'xiaodou_pilot');
  assert.equal(saved.merchant_provider,'xiaodou');
  assert.equal(saved.payment_channel,'ALIPAY_H5');
  assert.equal(saved.amount_fen,990);
  assert.equal(saved.credited_at,null);
  assert.equal(f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance,0);
  assert.equal(count(f,'payment_attempts'),1);
  assert.equal(count(f,'admin_audit_logs'),1);
  const again=await withProvider(()=>{throw Error('must never create another provider payment');},()=>f.call('/v1/admin/payments/xiaodou/pilot',{body:op}));
  assert.equal(again.status,409);
  const extra=await withProvider(()=>{throw Error('must not create a second payment in same day');},()=>f.call('/v1/admin/payments/xiaodou/pilot',{body:request()}));
  assert.equal(extra.status,409);
  assert.equal(count(f,'recharge_orders'),1);
  const blocked=await f.call('/v1/admin/payments/xiaodou/pilot',{method:'GET'});
  assert.ok(blocked.body.blockers.includes('daily_test_attempt_used'));
 }finally{f.sql.close();}
});
test('Signed paid webhook settles the test order once; replay does not double-grant credits',async()=>{
 const f=owner();
 try{
  const checkout=await create(f);
  assert.equal(checkout.status,201,JSON.stringify(checkout.body));
  const trade=f.sql.prepare('SELECT provider_trade_id FROM payment_transactions').get().provider_trade_id;
  const event={eventId:'evt-pilot-'+randomUUID(),eventType:'PAYMENT_SUCCEEDED',status:'SUCCEEDED',
   appId:f.env.XIAODOU_APP_ID,outTradeNo:trade,currency:'CNY',grossAmountFen:990,
   eventAmountFen:990,feeProjection:{ruleVersion:'test-v1',thresholdFen:0,tier:'STANDARD',
   merchantRateBps:250,companyServiceFeeRateBps:100,merchantSettlementFen:960,companyServiceFeeFen:30}};
  const headers=signedHeaders(event);
  const first=await f.call('/v1/payments/xiaodou/webhook',{body:event,headers});
  assert.equal(first.status,200,JSON.stringify(first.body));
  const second=await f.call('/v1/payments/xiaodou/webhook',{body:event,headers});
  assert.equal(second.status,200,JSON.stringify(second.body));
  assert.equal(f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance,400);
  assert.equal(f.sql.prepare('SELECT status FROM recharge_orders').get().status,'paid');
  assert.equal(count(f,'provider_payment_events'),1);
  assert.equal(count(f,'credit_ledger'),1);
  assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='active_merchant'").get().value,'mk99');
 }finally{f.sql.close();}
});
