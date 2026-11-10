import test from 'node:test';import assert from 'node:assert/strict';
import * as resume from '../src/lib/checkout-resume.mjs';
const id='11111111-1111-4111-8111-111111111111';
const order={id,packageId:'starter',status:'pending',riskState:'clear',paidAt:null,creditedAt:null,paymentProvider:'mk99',paymentProtocol:'mk99',paymentUrl:'https://mk99.cn/pay/example',paymentCashierOrigin:'https://mk99.cn',amountFen:1043,credits:400};
test('pending MK99 is checked via original order query without create and validated fresh snapshots',async()=>{
 const calls=[];const r=await resume.loadOrderCheckout(id,async(path,opts)=>{calls.push([path,opts.method]);return opts.method==='GET'?{order}:{ok:true,orderStatus:'pending',verificationSource:'authenticated_https_query'};});
 assert.equal(r.verified,true);assert.equal(r.order.amountFen,1043);assert.deepEqual(calls.map(x=>x[1]),['GET','POST','GET']);assert.ok(calls.every(([p])=>p.startsWith('/v1/orders/'+id)));
});
test('terminal, unknown and risk states never start a payment or offer old cashier',async()=>{
 for(const status of ['paid','closed','failed','refunded','unknown','manual_review']){let calls=0;const r=await resume.loadOrderCheckout(id,async()=>{calls++;return {order:{...order,status}}});assert.equal(calls,1);assert.equal(r.verified,false);}
 const r=await resume.loadOrderCheckout(id,async()=>({order:{...order,riskState:'manual_review'}}));assert.equal(r.verified,false);
});
test('query errors, conflicting snapshots and bad URLs fail closed while preserving original amount',async()=>{
 for(const mode of ['error','paid','risk','url','mismatch']){
 let n=0;const r=await resume.loadOrderCheckout(id,async(p,o)=>{n++;if(o.method==='POST'){if(mode==='error')throw Error('network');return {ok:true,orderStatus:mode==='mismatch'?'closed':'pending',verificationSource:'authenticated_https_query'};}return {order:n===1?order:{...order,...(mode==='paid'?{status:'paid',creditedAt:1}:mode==='risk'?{riskState:'manual_review'}:mode==='url'?{paymentUrl:'https://evil.test/'}:{})}};});assert.equal(r.verified,false);assert.equal(r.order.amountFen,1043);
 }
});
test('explicit new package selection is not redirected back to a remembered old order',()=>{
 assert.equal(resume.checkoutResumeId('https://site.test/checkout/?package=starter',id),null);
 assert.equal(resume.checkoutResumeId('https://site.test/checkout/?order='+id,id),id);
 assert.throws(()=>resume.checkoutResumeId('https://site.test/checkout/?order=../bad',id));
});

test('explicit unknown-state refresh preserves trusted provider reconciliation without a new order',async()=>{
 const calls=[];let reads=0;const r=await resume.loadOrderCheckout(id,async(path,opts)=>{calls.push([path,opts.method]);if(opts.method==='POST')return {ok:true,orderStatus:'paid',verificationSource:'authenticated_https_query'};reads++;return {order:{...order,status:reads===1?'unknown':'paid',creditedAt:reads===1?null:123}};},{queryUnknown:true});
 assert.deepEqual(calls.map(c=>c[1]),['GET','POST','GET']);assert.equal(r.order.status,'paid');assert.equal(r.verified,false);
});


test('Xiaodou credit checkout exposes original-order resume without generating another order',()=>{
 const {readFileSync}=require('node:fs');
 const {fileURLToPath}=require('node:url');
 const source=readFileSync(fileURLToPath(new URL('../src/pages/checkout.astro',import.meta.url)),'utf8');
 assert.match(source,/id="relaunch-rsa2"/);
 assert.match(source,/paymentProtocol==="rsa2"&&next.status==="pending"/);
 assert.match(source,/\/v1\/orders\/.*\/attempts/);
 const account=readFileSync(fileURLToPath(new URL('../src/components/account/AccountDashboard.tsx',import.meta.url)),'utf8');
 assert.match(account,/payment_protocol==="rsa2"/);
 assert.match(account,/Continue or verify Xiaodou order/);
});
