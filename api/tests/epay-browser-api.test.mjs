import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fixture,worker,temp,enableEpaySales } from './helpers/payment-v2.mjs';
import { submitEpayForm } from '../../web/src/lib/epay-form.mjs';
buildSync({entryPoints:[fileURLToPath(new URL('../../web/src/lib/api.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',outfile:path.join(temp,'epay-web-api.cjs'),define:{'import.meta.env':JSON.stringify({PUBLIC_API_BASE_URL:'https://api-staging.example.test',DEV:false})}});
const {api}=createRequire(import.meta.url)(path.join(temp,'epay-web-api.cjs'));
const key='local-browser-epay-test-key';
const sign=p=>createHash('md5').update(Object.keys(p).filter(k=>!['sign','sign_type'].includes(k)&&p[k]!=='').sort().map(k=>`${k}=${p[k]}`).join('&')+key).digest('hex');
test('Mock browser API -> authenticated creation -> POST form -> signed GET notify -> exact paid credits',async()=>{
 const f=enableEpaySales(fixture()),original=globalThis.fetch;Object.assign(f.env,{PAYMENT_PROVIDER:'xiaodou_epay',XIAODOU_EPAY_PID:'12345',XIAODOU_EPAY_KEY:key,XIAODOU_EPAY_GATEWAY:'https://epay.example.test/'});let csrf=0;
 globalThis.fetch=async(url,init={})=>{assert.equal(new URL(url).origin,f.env.API_ORIGIN,'No real provider network permitted');const route=new URL(url).pathname;if(route==='/v1/auth/csrf')csrf++;const r=await f.call(route,{method:init.method||'GET',...(init.body?{body:JSON.parse(init.body)}:{}),headers:init.headers||{}});return Response.json(r.body,{status:r.status});};
 try{
  const result=await api('/v1/orders',{method:'POST',body:JSON.stringify({packageId:'starter',amountFen:1})});assert.equal(csrf,1);assert.equal(result.order.amountFen,1006);
  let submitted;
  const doc={createElement(tag){return {tag,children:[],appendChild(el){this.children.push(el);},submit(){submitted=this;},remove(){}};},body:{appendChild(){}}};
  submitEpayForm(result.order.paymentForm,doc);assert.equal(submitted.method,'POST');assert.equal(submitted.action,'https://epay.example.test/submit.php');
  const posted=Object.fromEntries(submitted.children.map(x=>[x.name,x.value]));assert.equal(posted.sign,sign(posted));assert.equal(posted.money,'10.06');assert.equal(JSON.stringify(posted).includes(key),false);
  const callback={pid:posted.pid,type:posted.type,out_trade_no:posted.out_trade_no,trade_no:'MOCK_platform_123',money:posted.money,trade_status:'TRADE_SUCCESS'};callback.sign=sign(callback);callback.sign_type='MD5';
  f.env.PAYMENTS_ENABLED='0';const notify=await worker.fetch(new Request(posted.notify_url+'?'+new URLSearchParams(callback)),f.env);assert.equal(await notify.text(),'success');
  const order=await api(`/v1/orders/${result.order.id}`);assert.equal(order.order.status,'paid');assert.equal(order.quota.freeRemaining,200);assert.equal(order.quota.paidRemaining,400);
  const activity=await api('/v1/activity');assert.equal(activity.orders[0].payment_protocol,'epay');assert.equal(activity.orders[0].refund_eligibility,'manual_review');assert.equal(activity.ledger.filter(x=>x.kind==='purchase_grant').length,1);
 }finally{globalThis.fetch=original;f.sql.close();}
});
