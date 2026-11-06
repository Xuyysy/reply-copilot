import test from 'node:test';
import assert from 'node:assert/strict';
import * as payment from '../src/lib/payment-resume.mjs';
const id='11111111-1111-4111-8111-111111111111';
const order={id,packageId:'starter',paymentProvider:'mk99',paymentProtocol:'mk99',status:'pending',riskState:'clear',creditedAt:null,paidAt:null,paymentUrl:'https://mk99.cn/pay/example',paymentCashierOrigin:'https://mk99.cn'};
test('account continuation validates the original package and only opens normal checkout without payment operations',async()=>{
 let release;const held=new Promise(r=>release=r),calls=[],saved=[],jumps=[],inFlight=new Set();
 const options={inFlight,request:async(path,opts)=>{calls.push([path,opts.method]);await held;return path==='/v1/packages'?{packages:[{id:'starter',total_payment_fen:1043}]}:{order};},remember:x=>saved.push(x),navigate:x=>jumps.push(x)};
 const first=payment.resumeMk99Payment(id,options);assert.equal(await payment.resumeMk99Payment(id,options),false);release();await first;
 assert.deepEqual(calls,[['/v1/orders/'+id,'GET'],['/v1/packages','GET']]);assert.deepEqual(jumps,['/checkout/?package=starter']);assert.deepEqual(saved,[]);assert.equal(inFlight.size,0);
});
test('owned order links are never reused; only their actual package selects the normal purchase page',async()=>{
 for(const status of ['pending','unknown','paid','closed','failed','refunded','manual_review']){let destination;await payment.resumeMk99Payment(id,{inFlight:new Set(),request:async path=>path==='/v1/packages'?{packages:[{id:'starter',total_payment_fen:1043}]}:{order:{...order,status,paymentUrl:'javascript:alert(1)'}},remember:()=>{},navigate:x=>destination=x});assert.equal(destination,'/checkout/?package=starter');}
});
test('invalid locator, wrong order or other account response cannot navigate',async()=>{
 for(const request of [async()=>({order:{...order,id:'different'}}),async()=>{throw Object.assign(Error('not found'),{status:404});}])await assert.rejects(payment.resumeMk99Payment(id,{inFlight:new Set(),request,remember:()=>assert.fail(),navigate:()=>assert.fail()}));
 await assert.rejects(payment.resumeMk99Payment('../other',{inFlight:new Set(),request:()=>assert.fail(),remember:()=>assert.fail(),navigate:()=>assert.fail()}));
});
test('cashier origin and pending settlement validation remains strict separately from local navigation',()=>{
 assert.equal(payment.safeMk99Cashier(order,id),order.paymentUrl);
 for(const patch of [{status:'paid'},{status:'closed'},{riskState:'manual_review'},{paidAt:1},{creditedAt:1},{paymentUrl:'https://mk99.cn.evil.test/pay'},{paymentUrl:'http://mk99.cn/pay'},{paymentUrl:'https://user:pass@mk99.cn/pay'}])assert.equal(payment.safeMk99Cashier({...order,...patch},id),null);
});

test('list gating and customer messages preserve closed, risk and paid protections in both languages',()=>{
 const row={provider:'mk99',payment_protocol:'mk99',payment_status:'pending',status:'awaiting_payment',risk_state:'clear',credited_at:null,paid_at:null};
 assert.equal(payment.canResumeMk99Order(row),true);
 for(const patch of [{payment_status:'closed'},{status:'expired'},{risk_state:'manual_review'},{credited_at:1},{paid_at:1}])assert.equal(payment.canResumeMk99Order({...row,...patch}),false);
 assert.match(payment.paymentResumeMessage({paymentState:'paid'},'zh'),/已付款/);assert.match(payment.paymentResumeMessage({paymentState:'closed'},'en'),/closed/);
});

test('missing or inactive package and invalid price cannot navigate or create a payment',async()=>{
 for(const packages of [[],[{id:'different',total_payment_fen:1043}],[{id:'starter',total_payment_fen:null}]])await assert.rejects(payment.resumeMk99Payment(id,{inFlight:new Set(),request:async path=>path==='/v1/packages'?{packages}:{order},navigate:()=>assert.fail()}));
});
