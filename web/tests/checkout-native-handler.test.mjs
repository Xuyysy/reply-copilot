import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const {transformSync}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const root=new URL('../..',import.meta.url);
const readRevision=rev=>execFileSync('git',['show',rev+':web/src/pages/checkout.astro'],{cwd:root,encoding:'utf8'});
function listener(source){const a=source.indexOf('    byId("cashier-link").addEventListener("click",');return source.slice(a,source.indexOf('    byId("epay-submit").addEventListener',a));}
async function observe(source){
 const order={id:'synthetic',paymentProtocol:'mk99',status:'pending',paymentUrl:'https://cashier.fixture.invalid/original'};let handler;const calls=[];
 const anchor={getAttribute:()=>order.paymentUrl};const event={currentTarget:anchor,prevented:false,preventDefault(){this.prevented=true;}};
 const context={order,busy:false,confirmedMk99OrderId:order.id,byId:()=>({addEventListener:(_,fn)=>handler=fn}),rememberPayment:()=>calls.push('remember'),safeMk99Cashier:o=>o.paymentUrl,show(){},setStatus(){},mergeCheckoutRead:(_,next)=>next,showOrder(next){context.order=next;},loadOrderCheckout:async()=>{calls.push('GET','POST query','GET');return {verified:true,order:{...order,paymentUrl:'https://cashier.fixture.invalid/latest'}};},api(){},location:{assign:()=>calls.push('JS navigation')},navigateVerifiedCashier:()=>calls.push('JS navigation')};
 runInNewContext(transformSync(listener(source),{loader:'ts',format:'iife'}).code,context);await handler(event);return {event,calls};
}
test('normal cashier click keeps historical native navigation without remote recovery queries',async()=>{
 const old=await observe(readRevision('79e79845b470c0d0915875f18979b87b9a6c5d5c'));
 const regression=await observe(readRevision('f7ee65ecbeea1234fe22c9767ce984881fd895b6'));
 const fixed=await observe(readFileSync(new URL('../src/pages/checkout.astro',import.meta.url),'utf8'));
 assert.equal(old.event.prevented,false);assert.deepEqual(old.calls,['remember']);
 assert.equal(regression.event.prevented,true);assert.deepEqual(regression.calls,['GET','POST query','GET','remember','JS navigation']);
 assert.equal(fixed.event.prevented,false);assert.deepEqual(fixed.calls,['remember']);
});
