import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture,withProvider,worker} from './helpers/payment-v2.mjs';

const pid='20881234567890',key='local-notify-fixture-only';
const trade='XRHS_test_notify_0001',merchantPayment='MK99_NOTIFY_PAID_1';
function seed(){
 const f=fixture(),now=Date.now();
 Object.assign(f.env,{
   SUBSCRIPTIONS_ENABLED:'1',SUBSCRIPTION_PURCHASES_ENABLED:'1',
   MK99_PID:pid,MK99_KEY:key,MK99_REQUEST_SIGN_TYPE:'MD5',
   MK99_NOTIFY_SIGN_TYPE:'MD5',MK99_PROTOCOL_CONFIRMED:'1',
   MK99_AMOUNT_CONTRACT:'CNY_EXACT_BUYER_TOTAL'
 });
 f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at) VALUES('notice-order','test-user','pro-v1','purchase',11990,'pending',1,9999999999999,1,1)").run();
 f.sql.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,status,risk_state,created_at,updated_at) VALUES('notice-tx','notice-order','mk99',?,?, 'ALIPAY_H5',11990,'MD5','pending','clear',1,1)").run(pid,trade);
 return f;
}
const signedData=(status='TRADE_SUCCESS',overrides={})=>{
 const p={
  pid,trade_no:merchantPayment,out_trade_no:trade,subject:'Reply Copilot Pro 30 days',
  paytype_code:'alipay',channel_id:'123',trade_status:status,timestamp:String(Math.floor(Date.now()/1000)),
  total_amount:'119.90',currency:'CNY',sign_type:'MD5',...overrides
 };
 const canonical=Object.entries(p).filter(([k,v])=>k!=='sign'&&k!=='sign_type'&&v!=='').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('&');
 return {...p,sign:createHash('md5').update(canonical+'&key='+key).digest('hex').toUpperCase()};
};
async function notify(f,data=signedData(),contentType='application/x-www-form-urlencoded'){
 const response=await worker.fetch(new Request(f.env.API_ORIGIN+'/v1/payments/mk99/subscriptions/notify',{
  method:'POST',headers:{'Content-Type':contentType},body:contentType==='application/json'?JSON.stringify(data):new URLSearchParams(data).toString()
 }),f.env);
 return {status:response.status,text:await response.text()};
}
const query=(fn)=>withProvider(req=>{
 const params=new URLSearchParams(req.body);
 assert.equal(new URL(req.url).pathname,'/openapi/pay/query');
 assert.equal(params.get('out_trade_no'),trade);
 return Response.json({code:1,data:{
  out_trade_no:trade,trade_no:merchantPayment,trade_status:'TRADE_SUCCESS',total_amount:'119.90',
  pid,paytype_code:'alipay',currency:'CNY'
 }});
},fn);
function totals(f){
 const count=table=>f.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 return {periods:count('subscription_periods'),events:count('subscription_payment_events'),
  credits: f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance,
  legacy:count('recharge_orders')};
}

test('dedicated subscription signed notify settles via fixed HTTPS merchant query only once',async()=>{
 const f=seed();
 try{
  let calls=0;
  await query(async()=>{
   calls++;
   const first=await notify(f);
   assert.equal(first.status,200,first.text);
   assert.equal(first.text,'success');
   const replay=await notify(f);
   assert.equal(replay.status,200,replay.text);
   assert.equal(replay.text,'success');
  });
  assert.equal(calls,1);
  assert.deepEqual(totals(f),{periods:1,events:1,credits:0,legacy:0});
  const r=await f.call('/v1/usage',{method:'GET'});
  assert.equal(r.body.subscription.plan,'pro');
  assert.equal(r.body.subscription.remainingToday,1000);
 }finally{f.sql.close();}
});

test('invalid signed data, unsupported content type and false amount never touch subscriptions',async()=>{
 const f=seed();
 try{
  const unsigned=await notify(f,{...signedData(),sign:'INVALID'});
  assert.equal(unsigned.status,401);
  const badType=await notify(f,signedData(),'application/json');
  assert.equal(badType.status,415);
  const badAmount=await notify(f,signedData('TRADE_SUCCESS',{total_amount:'0.01'}));
  assert.equal(badAmount.status,409);
  assert.deepEqual(totals(f),{periods:0,events:0,credits:0,legacy:0});
 }finally{f.sql.close();}
});

test('a signed SUCCESS alone never grants if HTTPS merchant query cannot confirm',async()=>{
 const f=seed();
 try{
  let called=0;
  const r=await withProvider(req=>{
   called++;
   return Response.json({code:1,data:{out_trade_no:trade,trade_no:merchantPayment,trade_status:'WAIT_BUYER_PAY',
    total_amount:'119.90',pid,paytype_code:'alipay'}});
  },()=>notify(f));
  assert.equal(called,1);
  assert.equal(r.status,409);
  assert.deepEqual(totals(f),{periods:0,events:0,credits:0,legacy:0});
 }finally{f.sql.close();}
});

test('signed freeze/refund immediately suppress subscription; signed unfreeze cannot regrant',async()=>{
 const f=seed();
 try{
  await query(async()=>assert.equal((await notify(f)).status,200));
  assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.status,'active');
  const freeze=await notify(f,signedData('TRADE_FREEZE'));
  assert.equal(freeze.status,200,freeze.text);
  assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.status,'none');
  assert.equal(f.sql.prepare("SELECT risk_state FROM subscription_payment_transactions WHERE id='notice-tx'").get().risk_state,'frozen');
  assert.equal(f.sql.prepare("SELECT status FROM subscription_periods WHERE source_order_id='notice-order'").get().status,'refund_pending');
  assert.equal((await notify(f,signedData('TRADE_UNFREEZE'))).status,200);
  assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.status,'none');
  const refund=await notify(f,signedData('TRADE_REFUND',{refund_amount:'119.90'}));
  assert.equal(refund.status,200,refund.text);
  assert.equal(f.sql.prepare("SELECT status FROM subscription_periods WHERE source_order_id='notice-order'").get().status,'revoked');
  assert.equal(f.sql.prepare("SELECT status FROM subscription_payment_transactions WHERE id='notice-tx'").get().status,'refunded');
  assert.deepEqual(totals(f),{periods:1,events:3,credits:0,legacy:0});
 }finally{f.sql.close();}
});

test('signed freeze BEFORE success prevents late provider settlement and leaves paid balance unchanged',async()=>{
 const f=seed();
 try{
  assert.equal((await notify(f,signedData('TRADE_FREEZE'))).status,200);
  const result=await query(()=>notify(f));
  assert.equal(result.status,409);
  assert.deepEqual(totals(f),{periods:0,events:1,credits:0,legacy:0});
 }finally{f.sql.close();}
});

test('feature gate and unknown trade never access legacy MK99 recharge grants',async()=>{
 const f=seed();
 try{
  f.env.SUBSCRIPTIONS_ENABLED='0';
  assert.equal((await notify(f)).status,404);
  f.env.SUBSCRIPTIONS_ENABLED='1';
  assert.equal((await notify(f,signedData('TRADE_FREEZE',{out_trade_no:'XRHS_other_trade'}))).status,404);
  assert.deepEqual(totals(f),{periods:0,events:0,credits:0,legacy:0});
 }finally{f.sql.close();}
});
