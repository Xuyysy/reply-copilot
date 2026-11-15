import test from 'node:test';
import assert from 'node:assert/strict';
import {createVerifiedPaymentAutoCheck,markPaymentCashierOpened,hasPaymentCashierOpened} from '../src/lib/verified-payment-auto.mjs';
const cid='11111111-1111-4111-8111-111111111111';
function env(storage=new Map()){
 let t=Date.now();const doc={visibilityState:'visible',hasFocus:()=>true};
 return {document:doc,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},now:()=>t,
  advance:ms=>{t+=ms;},store:storage};
}
const credit={id:cid,status:'pending',paymentProtocol:'rsa2',creditedAt:null};
const subscription={id:cid,status:'pending',merchantProvider:'xiaodou',checkout:{paymentConfirmed:false},riskState:'clear'};
function arm(e,kind){
 e.localStorage.setItem('reply-copilot:cashier-seen:'+kind+':'+cid,JSON.stringify({at:e.now()}));
}
test('unopened cashier never queries merchant, even if checkout page shows a pending order',async()=>{
 const e=env();let calls=0;
 const c=createVerifiedPaymentAutoCheck({kind:'credit',orderId:cid,environment:e,request:async()=>{calls++;}});
 await c.onPending(credit);assert.equal(calls,0);
 await c.onPending({...credit,id:'another'});assert.equal(calls,0);
});
test('credit only reports success after authenticated POST and local GET confirm creditedAt',async()=>{
 const e=env();arm(e,'credit');const sent=[],success=[];
 const c=createVerifiedPaymentAutoCheck({kind:'credit',orderId:cid,environment:e,request:async(url,init)=>{
  sent.push([url,init.method]);return init.method==='POST'?{orderStatus:'paid'}:{order:{id:cid,status:'paid',creditedAt:1234}};
 },onVerified:o=>success.push(o.id)});
 await c.onPending(credit);
 assert.deepEqual(sent,[['/v1/orders/'+cid+'/refresh','POST'],['/v1/orders/'+cid,'GET']]);
 assert.deepEqual(success,[cid]);
 await c.onPending(credit);assert.equal(sent.length,2,'success stops future queries');
});
test('unsigned browser return and POST paid response cannot claim credit or entitlement',async()=>{
 for(const kind of ['credit','subscription']){
  const e=env();arm(e,kind);let claims=0,calls=0;
  const c=createVerifiedPaymentAutoCheck({kind,orderId:cid,environment:e,request:async(_url,init)=>{
   calls++;return init.method==='POST'?{orderStatus:'paid',entitlementApplied:true}
    :{order:kind==='credit'?{id:cid,status:'paid',creditedAt:null}:{id:cid,status:'paid',checkout:{paymentConfirmed:false}}};
  },onVerified:()=>claims++});
  await c.onPending(kind==='credit'?credit:subscription);
  assert.equal(claims,0);assert.equal(calls,2);
  await c.onPending(kind==='credit'?credit:subscription);assert.equal(calls,2,'cooldown prevents rapid-repeat provider calls');
 }
});
test('subscription confirms paid applied entitlement, preserves queued next period',async()=>{
 const e=env();arm(e,'subscription');let checks=0,confirmed=null;
 const c=createVerifiedPaymentAutoCheck({kind:'subscription',orderId:cid,environment:e,request:async(_url,init)=>{
  checks++;return init.method==='POST'?{paymentConfirmed:true,entitlementApplied:true}
   :{order:{id:cid,status:'paid',periodStatus:'queued',checkout:{paymentConfirmed:true}}};
 },onVerified:o=>confirmed=o});
 await c.onPending(subscription);assert.equal(checks,2);assert.equal(confirmed.periodStatus,'queued');
});
test('subscription excludes manual_review, risk holds, terminal orders and wrong provider identity',async()=>{
 const e=env();arm(e,'subscription');let calls=0;
 const c=createVerifiedPaymentAutoCheck({kind:'subscription',orderId:cid,environment:e,request:async()=>{calls++;}});
 for(const o of [{...subscription,status:'manual_review'},{...subscription,riskState:'manual_review'},{...subscription,status:'closed'},{...subscription,merchantProvider:'invalid'},{...subscription,checkout:{paymentConfirmed:true}}])
  await c.onPending(o);
 assert.equal(calls,0);
});
test('foreground, logout, per-order budget and two-tab cooldown limit merchant queries',async()=>{
 const shared=new Map(),e=env(shared),other=env(shared);
 arm(e,'credit');let calls=0;
 const req=async(_url,init)=>{calls++;if(init.method==='POST')return {orderStatus:'pending'};return {order:{...credit}};};
 const a=createVerifiedPaymentAutoCheck({kind:'credit',orderId:cid,environment:e,request:req});
 const b=createVerifiedPaymentAutoCheck({kind:'credit',orderId:cid,environment:other,request:req});
 e.document.visibilityState='hidden';await a.onPending(credit);assert.equal(calls,0);
 e.document.visibilityState='visible';await a.onPending(credit);assert.equal(calls,2);
 await b.onPending(credit);assert.equal(calls,2);
 for(let i=0;i<60;i++){e.advance(3000);other.advance(3000);await a.onPending(credit);}
 assert.ok(calls<=16,'at most 8 POST+GET pairs for one checkout');
 const before=calls;e.advance(60000);await a.onPending(credit);assert.equal(calls,before);
});
test('provider failures do not fabricate grants; 401 stops retries',async()=>{
 const e=env();arm(e,'credit');let calls=0,claims=0;
 const c=createVerifiedPaymentAutoCheck({kind:'credit',orderId:cid,environment:e,request:async()=>{calls++;throw Object.assign(new Error('not signed'),{status:401});},onVerified:()=>claims++});
 await c.onPending(credit);e.advance(120000);await c.onPending(credit);
 assert.equal(calls,1);assert.equal(claims,0);
});
test('cashier marker is an eligibility flag, not a paid flag and is isolated per order',async()=>{
 const e=env();markPaymentCashierOpened('subscription',cid,e);
 assert.equal(JSON.parse(e.store.get('reply-copilot:cashier-seen:subscription:'+cid)).at>0,true);
 let calls=0;
 const c=createVerifiedPaymentAutoCheck({kind:'credit',orderId:cid,environment:e,request:async()=>{calls++;}});
 await c.onPending(credit);assert.equal(calls,0,'subscription marker must not arm credit queries');
});

test('foreground subscription watcher eligibility is gated on actual cashier link, not an unpaid creation',()=>{
 const e=env();assert.equal(hasPaymentCashierOpened('subscription',cid,e),false);
 markPaymentCashierOpened('subscription',cid,e);
 assert.equal(hasPaymentCashierOpened('subscription',cid,e),true);
 e.advance(16*60*1000);
 assert.equal(hasPaymentCashierOpened('subscription',cid,e),false,'merchant query access expires');
});
