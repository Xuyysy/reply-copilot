import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,withProvider,providerResponse} from './helpers/payment-v2.mjs';

const merchant='20881234567890';
function mkReady(){
 const f=fixture();
 Object.assign(f.env,{
  MK99_PID:merchant,MK99_KEY:'fixture-key',MK99_REQUEST_SIGN_TYPE:'MD5',MK99_NOTIFY_SIGN_TYPE:'MD5',
  MK99_PROTOCOL_CONFIRMED:'1',MK99_AMOUNT_CONTRACT:'CNY_EXACT_BUYER_TOTAL',
  MK99_CASHIER_ORIGINS:'https://cashier.example.test',
  SUBSCRIPTIONS_ENABLED:'1',SUBSCRIPTION_PURCHASES_ENABLED:'1',SUBSCRIPTION_CHECKOUT_ENABLED:'1'
 });
 f.sql.exec("UPDATE system_settings SET value='mk99' WHERE key='active_merchant'");
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_mk99_enabled','payment_mk99_alipay_enabled','payment_mk99_alipay_released','payment_mk99_wechat_enabled','payment_mk99_wechat_released')");
 return f;
}
function xdReady(){
 const f=fixture();
 Object.assign(f.env,{SUBSCRIPTIONS_ENABLED:'1',SUBSCRIPTION_PURCHASES_ENABLED:'1',SUBSCRIPTION_CHECKOUT_ENABLED:'1'});
 f.sql.exec("UPDATE system_settings SET value='xiaodou' WHERE key='active_merchant'");
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_rsa2_enabled','payment_rsa2_alipay_enabled','payment_rsa2_alipay_released')");
 return f;
}
async function createMerchant(f,provider,type,key){
 let trade='';
 return withProvider(req=>{
  const p=new URL(req.url).pathname;
  if(provider==='mk99'){
   assert.equal(p,'/openapi/pay/create');
   const params=Object.fromEntries(new URLSearchParams(req.body));trade=params.out_trade_no;
   return Response.json({code:1,data:{trade_no:'MK99_mock_'+key,out_trade_no:trade,pay_url:'https://cashier.example.test/pay/'+key}});
  }
  assert.equal(p,'/api/open/v1/payments');
  const data=JSON.parse(req.body);trade=data.outTradeNo;
  return providerResponse(req,{outTradeNo:trade,amountFen:data.amountFen,channel:data.channel,
   openOrderId:'xd-open-'+key,payUrl:'https://cashier.example.test/pay/'+key});
 },()=>f.call(type==='subscription'?'/v1/subscriptions/orders':'/v1/orders',{
  body:type==='subscription'?{planCode:'basic',channel:'ALIPAY_H5',idempotencyKey:key}
   :{packageId:'starter',channel:'ALIPAY_H5',provider}
 })).then(r=>({...r,trade}));
}
async function lateQuery(f,provider,type,id,trade,amountFen,openId){
 return withProvider(req=>{
  const p=new URL(req.url).pathname;
  if(provider==='mk99'){
   assert.equal(p,'/openapi/pay/query');
   return Response.json({code:1,data:{trade_no:'MK99_mock_'+openId,
    out_trade_no:trade,total_amount:(amountFen/100).toFixed(2),trade_status:'TRADE_SUCCESS'}});
  }
  assert.equal(p,'/api/open/v1/payments/'+trade);
  return providerResponse(req,{outTradeNo:trade,amountFen,status:'SUCCEEDED',currency:'CNY',
    channel:'ALIPAY_H5',openOrderId:'xd-open-'+openId,payUrl:null},{status:200});
 },()=>f.call(type==='subscription'?'/v1/subscriptions/orders/'+id+'/refresh':'/v1/orders/'+id+'/refresh',{body:{}}));
}
const scalar=(f,sql,...args)=>f.sql.prepare(sql).get(...args);

for(const provider of ['xiaodou','mk99']){
 for(const type of ['subscription','credits']){
  test(provider+' '+type+' local cancellation releases new checkout without merchant close or entitlement',async()=>{
   const f=provider==='xiaodou'?xdReady():mkReady();
   try{
    const first=await createMerchant(f,provider,type,provider+'-'+type+'-first');
    assert.equal(first.status,201,JSON.stringify(first.body));
    const id=first.body.order.id;
    const path=(type==='subscription'?'/v1/subscriptions/orders/':'/v1/orders/')+id+'/local-cancel';
    const missing=await f.call(path,{body:{}});
    assert.equal(missing.status,400,'explicit consent required');
    const closed=await withProvider(()=>{throw Error('LOCAL cancellation must NOT call merchant');},
      ()=>f.call(path,{body:{confirm:true}}));
    assert.equal(closed.status,200,JSON.stringify(closed.body));
    assert.equal(closed.body.orderStatus,'closed');
    assert.equal(closed.body.localOnly,true);
    assert.equal((await f.call(path,{body:{confirm:true}})).status,409,'double cancel is rejected');
    if(type==='subscription'){
     assert.equal(scalar(f,'SELECT status FROM subscription_orders WHERE id=?',id).status,'closed');
     assert.equal(scalar(f,'SELECT status FROM subscription_payment_transactions WHERE order_id=?',id).status,'closed');
     assert.equal(scalar(f,'SELECT count(*) n FROM subscription_periods').n,0);
    }else{
     assert.equal(scalar(f,'SELECT status FROM recharge_orders WHERE id=?',id).status,'expired');
     assert.equal(scalar(f,'SELECT status FROM payment_transactions WHERE order_id=?',id).status,'closed');
     assert.equal(scalar(f,"SELECT count(*) n FROM payment_attempts WHERE provider_code LIKE '%|USER_LOCAL_CANCEL'").n,1);
     assert.equal(scalar(f,'SELECT paid_balance FROM credit_accounts').paid_balance,0);
     assert.equal(scalar(f,"SELECT count(*) n FROM credit_ledger WHERE kind='purchase_grant'").n,0);
    }
    const second=await createMerchant(f,provider,type,provider+'-'+type+'-second');
    assert.equal(second.status,201,JSON.stringify(second.body));
    assert.notEqual(second.body.order.id,id);
   }finally{f.sql.close();}
  });

  test(provider+' '+type+' late verified payment of locally cancelled order is held without a second grant',async()=>{
   const f=provider==='xiaodou'?xdReady():mkReady();
   try{
    const key='late-'+provider+'-'+type;
    const first=await createMerchant(f,provider,type,key);
    assert.equal(first.status,201,JSON.stringify(first.body));
    const id=first.body.order.id;
    const cancel=await f.call((type==='subscription'?'/v1/subscriptions/orders/':'/v1/orders/')+id+'/local-cancel',{body:{confirm:true}});
    assert.equal(cancel.status,200,JSON.stringify(cancel.body));
    const amount=type==='subscription'?6990:provider==='mk99'?1043:990;
    const late=await lateQuery(f,provider,type,id,first.trade,amount,key);
    assert.equal(late.status,200,JSON.stringify(late.body));
    assert.equal(late.body.orderStatus,'manual_review',JSON.stringify(late.body));
    if(type==='subscription'){
     assert.equal(scalar(f,'SELECT status FROM subscription_orders WHERE id=?',id).status,'manual_review');
     assert.equal(scalar(f,'SELECT risk_state FROM subscription_payment_transactions WHERE order_id=?',id).risk_state,'manual_review');
     assert.equal(scalar(f,'SELECT count(*) n FROM subscription_periods').n,0);
    }else{
     assert.equal(scalar(f,'SELECT status FROM recharge_orders WHERE id=?',id).status,'expired');
     assert.equal(scalar(f,'SELECT risk_state FROM payment_transactions WHERE order_id=?',id).risk_state,'manual_review');
     assert.equal(scalar(f,'SELECT paid_balance FROM credit_accounts').paid_balance,0);
     assert.equal(scalar(f,"SELECT count(*) n FROM credit_ledger WHERE kind='purchase_grant'").n,0);
     assert.equal(scalar(f,'SELECT count(*) n FROM credit_batches WHERE source_order_id=?',id).n,0);
     const second=await lateQuery(f,provider,type,id,first.trade,amount,key);
     assert.equal(second.status,200,JSON.stringify(second.body));
     assert.equal(second.body.orderStatus,'manual_review','replayed proof must not be shown as ordinary paid');
     assert.equal(scalar(f,'SELECT paid_balance FROM credit_accounts').paid_balance,0);
    }
   }finally{f.sql.close();}
  });
 }
}
test('cancel refuses paid, untrusted-risk and prepared-state orders',async()=>{
 const f=mkReady();try{
  const created=await createMerchant(f,'mk99','credits','deny-risk-001');
  assert.equal(created.status,201);
  const id=created.body.order.id,path='/v1/orders/'+id+'/local-cancel';
  f.sql.prepare("UPDATE payment_transactions SET risk_state='manual_review' WHERE order_id=?").run(id);
  assert.equal((await f.call(path,{body:{confirm:true}})).status,409);
  f.sql.prepare("UPDATE payment_transactions SET risk_state='clear',status='paid',paid_at=1 WHERE order_id=?").run(id);
  assert.equal((await f.call(path,{body:{confirm:true}})).status,409);
 }finally{f.sql.close();}
});
