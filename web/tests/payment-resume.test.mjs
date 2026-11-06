import test from 'node:test';
import assert from 'node:assert/strict';
import * as payment from '../src/lib/payment-resume.mjs';
const id='11111111-1111-4111-8111-111111111111';
const order={id,packageId:'starter',paymentProvider:'mk99',paymentProtocol:'mk99',status:'pending',riskState:'clear',creditedAt:null,paidAt:null,paymentUrl:'https://mk99.cn/pay/example',paymentCashierOrigin:'https://mk99.cn'};
test('pending original order is ownership-checked, queried once and resumed with unchanged trusted URL, without creating an order',async()=>{
 let release;const hold=new Promise(r=>release=r),calls=[],remembered=[],destinations=[],inFlight=new Set();
 const options={inFlight,request:async(path,opts)=>{calls.push([path,opts.method]);await hold;return opts.method==='GET'?{order}:{ok:true,orderStatus:'pending',verificationSource:'authenticated_https_query'};},remember:id=>remembered.push(id),navigate:(url,origin)=>destinations.push({url,origin})};
 const first=payment.resumeMk99Payment(id,options);assert.equal(await payment.resumeMk99Payment(id,options),false);release();await first;
 assert.deepEqual(calls.map(c=>c[1]),['GET','POST','GET']);assert.ok(calls.every(([p])=>p.startsWith('/v1/orders/'+id)));assert.deepEqual(remembered,[id]);assert.deepEqual(destinations,[{url:order.paymentUrl,origin:order.paymentCashierOrigin}]);
});
test('all non-payable or ambiguous original orders fail closed without checkout or another transaction',async()=>{
 for(const patch of [{status:'paid'},{status:'closed'},{status:'failed'},{status:'refunded'},{status:'unknown'},{riskState:'manual_review'},{creditedAt:1},{paidAt:1},{id:'other'},{paymentProvider:'other'},{paymentUrl:null},{paymentUrl:'https://evil.invalid/pay'}]){
 await assert.rejects(payment.resumeMk99Payment(id,{inFlight:new Set(),request:async()=>({order:{...order,...patch}}),remember:()=>assert.fail(),navigate:()=>assert.fail()}));
 }
 await assert.rejects(payment.resumeMk99Payment('invalid',{inFlight:new Set(),request:()=>assert.fail(),remember:()=>assert.fail(),navigate:()=>assert.fail()}));
 await assert.rejects(payment.resumeMk99Payment(id,{inFlight:new Set(),request:async()=>{throw Object.assign(Error('not owned'),{status:404});},remember:()=>assert.fail(),navigate:()=>assert.fail()}));
});
test('paid, closed, unknown, changed URL or risk after query cannot enter the cashier',async()=>{
 for(const mode of ['paid','closed','unknown','risk','changed']){let count=0;await assert.rejects(payment.resumeMk99Payment(id,{inFlight:new Set(),request:async(p,o)=>{count++;if(o.method==='POST')return {ok:true,orderStatus:['risk','changed'].includes(mode)?'pending':mode,verificationSource:'authenticated_https_query'};return {order:count===1?order:{...order,...(mode==='risk'?{riskState:'manual_review'}:{paymentUrl:order.paymentUrl+'?changed=1'})}};},remember:()=>assert.fail(),navigate:()=>assert.fail()}));}
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

// Rollback safety: old Worker responses have no server-attested cashier origin.
test('new Pages with old Worker contract fails closed; old consumers tolerate additive fields',async()=>{
 const legacy={...order};delete legacy.paymentCashierOrigin;
 let calls=0;await assert.rejects(payment.resumeMk99Payment(id,{inFlight:new Set(),request:async()=>{calls++;return {order:legacy};},remember:()=>assert.fail(),navigate:()=>assert.fail()}));
 assert.equal(calls,1,'no provider refresh or creation after incompatible contract');
 const oldConsumer=({order:o})=>({id:o.id,status:o.status,paymentUrl:o.paymentUrl,amountFen:o.amountFen});
 assert.deepEqual(oldConsumer({order:{...legacy,amountFen:1043}}),oldConsumer({order:{...order,amountFen:1043}}));
});
