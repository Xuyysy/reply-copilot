import test from 'node:test';
import assert from 'node:assert/strict';
import * as payment from '../src/lib/payment-resume.mjs';
const id='11111111-1111-4111-8111-111111111111';
const order={id,paymentProvider:'mk99',paymentProtocol:'mk99',status:'pending',riskState:'clear',creditedAt:null,paidAt:null,paymentUrl:'https://mk99.cn/pay/example',paymentCashierOrigin:'https://mk99.cn'};
test('resume uses owner GET, trusted refresh, fresh GET, original URL and tracking only once',async()=>{
 let release;const held=new Promise(r=>release=r),calls=[],saved=[],jumps=[],lock=new Set();
 const options={inFlight:lock,request:async(path,opts)=>{calls.push([path,opts.method]);await held;return opts.method==='GET'?{order}:{ok:true,orderStatus:'pending',verificationSource:'authenticated_https_query'};},remember:x=>saved.push(x),navigate:x=>jumps.push(x)};
 const first=payment.resumeMk99Payment(id,options);assert.equal(await payment.resumeMk99Payment(id,options),false);release();await first;
 assert.deepEqual(calls.map(x=>x[1]),['GET','POST','GET']);assert.deepEqual(saved,[id]);assert.deepEqual(jumps,[order.paymentUrl]);assert.equal(lock.size,0);assert.ok(calls.every(([p])=>p.startsWith('/v1/orders/'+id)));
});
test('all unsafe states, settled, wrong order, risk, bad URLs fail closed without navigation',async()=>{
 for(const changed of [{status:'paid'},{status:'closed'},{status:'failed'},{status:'refunded'},{status:'unknown'},{status:'manual_review'},{riskState:'manual_review'},{creditedAt:1},{paidAt:1},{id:'wrong'},{paymentProvider:'xiaodou'},{paymentUrl:null},...['http://mk99.cn/pay','https://mk99.cn.evil.test/pay','https://user:pass@mk99.cn/pay','javascript:alert(1)','https://mk99.cn:8443/pay'].map(paymentUrl=>({paymentUrl}))]){
 let navigated=false;await assert.rejects(payment.resumeMk99Payment(id,{inFlight:new Set(),request:async()=>({order:{...order,...changed}}),remember:()=>{},navigate:()=>navigated=true}));assert.equal(navigated,false);
 }
});
test('refresh failure or latest status change never redirects or creates an order',async()=>{
 for(const mode of ['paid','closed','unknown','query_failed','risk']){let n=0;await assert.rejects(payment.resumeMk99Payment(id,{inFlight:new Set(),request:async(path,opts)=>{n++;if(opts.method==='POST'){if(mode==='query_failed')throw Error('failed');return {ok:true,orderStatus:mode==='risk'?'pending':mode,verificationSource:'authenticated_https_query'};}return {order:n===1?order:{...order,riskState:'manual_review'}};},remember:()=>assert.fail('must not remember'),navigate:()=>assert.fail('must not navigate')}));}
});

test('list gating and customer messages preserve closed, risk and paid protections in both languages',()=>{
 const row={provider:'mk99',payment_protocol:'mk99',payment_status:'pending',status:'awaiting_payment',risk_state:'clear',credited_at:null,paid_at:null};
 assert.equal(payment.canResumeMk99Order(row),true);
 for(const patch of [{payment_status:'closed'},{status:'expired'},{risk_state:'manual_review'},{credited_at:1},{paid_at:1}])assert.equal(payment.canResumeMk99Order({...row,...patch}),false);
 assert.match(payment.paymentResumeMessage({paymentState:'paid'},'zh'),/已付款/);assert.match(payment.paymentResumeMessage({paymentState:'closed'},'en'),/closed/);
});
