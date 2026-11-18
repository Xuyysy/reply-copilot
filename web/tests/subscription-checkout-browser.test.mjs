import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withMomentumBrowser} from '../../tests/helpers/momentum-browser.js';

const {build}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const web=new URL('..',import.meta.url).pathname;

test('subscription checkout restores a recoverable cashier on first order read and refresh', {timeout:30000},async()=>{
 const bundle=await build({
  stdin:{resolveDir:web,loader:'tsx',contents:`
   import React from 'react';
   import {createRoot} from 'react-dom/client';
   import SubscriptionCheckout from './src/components/account/SubscriptionCheckout';
   const id='11111111-1111-4111-8111-111111111111';
   const Search=window.URLSearchParams;
   window.URLSearchParams=class extends Search {
     constructor(value){super(value===''?'order='+id:value);}
   };
   window.__status='WAIT_BUYER_PAY';window.__calls=[];
   window.fetch=async(url,options={})=>{
    const dest=new URL(url);
    if(dest.origin!=='https://subscription.fixture.invalid')throw Error('Unexpected origin');
    const path=dest.pathname;
    window.__calls.push([options.method??'GET',path]);
    if(path==='/v1/auth/csrf')return Response.json({csrfToken:'synthetic'});
    if(path.endsWith('/refresh'))return Response.json({orderStatus:window.__status==='WAIT_BUYER_PAY'?'pending':'paid',providerStatus:window.__status});
    if(path.endsWith(id))return Response.json({order:{id,planCode:'pro',kind:'renewal',amountFen:11990,
     status:window.__status==='WAIT_BUYER_PAY'?'pending':'paid',riskState:'clear',
     checkout:{outcome:'ready',paymentUrl:'https://cashier.fixture.invalid/original',paymentConfirmed:window.__status==='TRADE_SUCCESS'}}});
    throw Error('Unexpected API '+path);
   };
   createRoot(document.querySelector('#root')).render(<SubscriptionCheckout/>);
   window.momentumReady=true;
  `},
  bundle:true,platform:'browser',format:'iife',write:false,
  define:{'import.meta.env.PUBLIC_API_BASE_URL':'"https://subscription.fixture.invalid"','import.meta.env.DEV':'false'}
 });
 await withMomentumBrowser('<div id="root"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>',async({evaluate,call})=>{
  await call('Emulation.setDeviceMetricsOverride',{width:375,height:800,deviceScaleFactor:1,mobile:true});
  const until=async expression=>{
   for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,20));}
   assert.fail('Timed out waiting for '+expression);
  };
  await until('document.querySelector("button")!==null');
  await until('document.querySelector("a[target]")!==null');
  await evaluate('document.querySelector("button").click();document.querySelector("button").click()');
  await until('document.querySelector("a[target]")!==null');
  assert.equal(await evaluate('document.querySelector("a[target]").href'),'https://cashier.fixture.invalid/original');
  assert.equal(await evaluate('document.querySelector("a[target]").rel'),'noopener noreferrer');
  assert.equal(await evaluate('window.__calls.filter(([,path])=>path.endsWith("/refresh")).length'),1);
  await evaluate('window.__status="TRADE_SUCCESS";document.querySelector("button").click();document.documentElement.lang="en";window.dispatchEvent(new Event("reply-copilot-language"))');
  await until('document.body.textContent.includes("Payment verified and entitlement processed")');
  await until('document.querySelector("a[target]")===null');
  assert.equal(await evaluate('window.__calls.some(([method,path])=>method==="POST"&&path==="/v1/subscriptions/orders")'),false);
 });
});


test('Xiaodou pending subscription keeps cashier and verification without unused extra actions', {timeout:30000},async()=>{
 const bundle=await build({
  stdin:{resolveDir:web,loader:'tsx',contents:`
   import React from 'react';
   import {createRoot} from 'react-dom/client';
   import SubscriptionCheckout from './src/components/account/SubscriptionCheckout';
   const id='22222222-2222-4222-8222-222222222222';
   const Search=window.URLSearchParams;
   window.URLSearchParams=class extends Search {constructor(v){super(v===''?'order='+id:v);}};
   window.__calls=[];window.__providerStatus='CREATED';
   function makeOrder(){return {id,merchantProvider:'xiaodou',planCode:'basic',kind:'renewal',amountFen:6990,
     status:'pending',riskState:'clear',checkout:{outcome:'ready',paymentConfirmed:false,
     paymentUrl:'https://cashier.fixture.invalid/original'}};}
   window.fetch=async(url,options={})=>{
    const path=new URL(url).pathname;
    window.__calls.push([options.method??'GET',path]);
    if(path==='/v1/auth/csrf')return Response.json({csrfToken:'synthetic'});
    if(path.endsWith('/refresh'))return Response.json({paymentConfirmed:false,orderStatus:'pending',providerStatus:window.__providerStatus});
    if(path.endsWith(id))return Response.json({order:makeOrder()});
    throw Error('unexpected '+path);
   };
   createRoot(document.querySelector('#root')).render(<SubscriptionCheckout/>);
   window.momentumReady=true;
  `},
  bundle:true,platform:'browser',format:'iife',write:false,
  define:{'import.meta.env.PUBLIC_API_BASE_URL':'"https://subscription.fixture.invalid"','import.meta.env.DEV':'false'}
 });
 await withMomentumBrowser('<div id="root"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>',async({evaluate})=>{
  const until=async x=>{for(let i=0;i<150;i++){if(await evaluate(x))return;await new Promise(r=>setTimeout(r,20));}assert.fail('timeout: '+x);};
  await until('document.querySelector("a[target]")!==null');
  assert.equal(await evaluate('document.querySelector("a[target]").href'),'https://cashier.fixture.invalid/original');
  await evaluate('window.__providerStatus="PAYING";document.querySelector("button").click()');
  await until('document.body.textContent.includes("仍待付款")');
  assert.equal(await evaluate('document.querySelector("a[target]").href'),'https://cashier.fixture.invalid/original');
  const buttons=await evaluate('[...document.querySelectorAll("button")].map(b=>b.textContent.trim())');
  assert.deepEqual(buttons,['查验付款状态']);
  assert.equal(await evaluate('document.body.textContent.includes("重新生成原订单二维码")'),false);
  assert.equal(await evaluate('document.body.textContent.includes("申请关闭本笔人民币原订单")'),false);
  assert.equal(await evaluate('window.__calls.filter(([method,p])=>method==="POST"&&p.endsWith("/attempts")).length'),0);
  assert.equal(await evaluate('window.__calls.filter(([method,p])=>method==="POST"&&p.endsWith("/cancel")).length'),0);
  assert.equal(await evaluate('window.__calls.some(([method,p])=>method==="POST"&&p==="/v1/subscriptions/orders")'),false);
 });
});
