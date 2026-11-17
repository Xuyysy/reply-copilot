import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withMomentumBrowser} from '../../tests/helpers/momentum-browser.js';

const {build}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const web=new URL('..',import.meta.url).pathname;

test('unpaid USDT subscription conflict has one actionable primary CTA, not a duplicate alert', {timeout:30000},async()=>{
 const bundle=await build({
  stdin:{resolveDir:web,loader:'tsx',contents:`
   import React from 'react';
   import {createRoot} from 'react-dom/client';
   import SubscriptionCheckout from './src/components/account/SubscriptionCheckout';
   const oldId='967e1cb3-4e3f-4bd7-a49e-10ccf6d9f551';
   const Original=window.URLSearchParams;
   window.URLSearchParams=class extends Original {
     constructor(value){super(value===''?'plan=basic':value);}
   };
   window.__calls=[];window.__errorMode='conflict';
   window.fetch=async(url,options={})=>{
     const path=new URL(url).pathname,method=options.method??'GET';
     window.__calls.push([method,path]);
     if(path==='/v1/auth/csrf')return Response.json({csrfToken:'synthetic'});
     if(path==='/v1/boltutil/availability')return Response.json({available:true,networks:['BEP20']});
     if(path==='/v1/subscriptions/plans')return Response.json({
       plans:[{plan_code:'basic',price_fen:6990,daily_limit:100,name_zh:'Basic',name_en:'Basic'}],
       checkoutAvailable:true,paymentMethods:['ALIPAY_H5']
     });
     if(path==='/v1/usage')return Response.json({subscription:{status:'none',plan:null,expiresAt:null}});
     if(path==='/v1/subscriptions/orders'&&method==='POST'){
       return window.__errorMode==='conflict'
         ? Response.json({ok:false,code:'SUBSCRIPTION_ORDER_CONFLICT',
           message:'订阅状态已变化，请重新查看账户。'},{status:409})
         : Response.json({ok:false,code:'PAYMENT_UNAVAILABLE',
           message:'支付服务暂时不可用。'},{status:503});
     }
     if(path==='/v1/boltutil/subscription-blockers')
       return Response.json({orders:[{id:oldId,rail:'usdt',status:'pending'}]});
     if(path==='/v1/subscriptions/orders'&&method==='GET')return Response.json({orders:[]});
     throw Error('Unexpected request '+method+' '+path);
   };
   createRoot(document.querySelector('#root')).render(<SubscriptionCheckout/>);
   window.momentumReady=true;
  `},
  bundle:true,platform:'browser',format:'iife',write:false,
  define:{'import.meta.env.PUBLIC_API_BASE_URL':'"https://subscription.fixture.invalid"','import.meta.env.DEV':'false'}
 });
 await withMomentumBrowser('<div id="root"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>',async({evaluate,call})=>{
  await call('Emulation.setDeviceMetricsOverride',{width:375,height:800,deviceScaleFactor:1,mobile:true});
  const until=async condition=>{
   for(let i=0;i<150;i++){
     if(await evaluate(condition))return;
     await new Promise(resolve=>setTimeout(resolve,20));
   }
   assert.fail('Timed out: '+condition);
  };
  const createBtn='Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("确认金额并创建订单"))';
  await until(createBtn+'!==undefined');
  await evaluate(createBtn+'.click()');
  const selector='a.button[href*="/usdt-checkout/?order="]';
  await until('document.querySelector('+JSON.stringify(selector)+')!==null');
  const info=await evaluate(`(()=>{
    const a=document.querySelector(${JSON.stringify(selector)});
    return {href:a.getAttribute('href'),label:a.textContent,
      isPrimary:a.classList.contains('button')&&!a.classList.contains('secondary'),
      fullWidthOnMobile:a.classList.contains('w-full'),
      alerts:[...document.querySelectorAll('[role="alert"]')].map(x=>x.textContent),
      duplicate:document.body.textContent.includes('订阅状态已变化，请重新查看账户。')
    };
  })()`);
  assert.equal(info.href,'/usdt-checkout/?order=967e1cb3-4e3f-4bd7-a49e-10ccf6d9f551');
  assert.match(info.label,/查看并关闭旧 USDT 订单/);
  assert.equal(info.isPrimary,true);
  assert.equal(info.fullWidthOnMobile,true);
  assert.deepEqual(info.alerts,[]);
  assert.equal(info.duplicate,false);

  // An unrelated payment outage must still produce a visible error.
  await evaluate('window.__errorMode="unavailable";'+createBtn+'.click()');
  await until('document.querySelector("[role=alert]")!==null');
  assert.equal(await evaluate('document.body.textContent.includes("支付服务暂时不可用。")'),true);
 });
});
