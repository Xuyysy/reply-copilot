import test from 'node:test';import assert from 'node:assert/strict';import {spawn,execFileSync}from 'node:child_process';import {mkdtempSync,writeFileSync,rmSync}from 'node:fs';import {tmpdir}from 'node:os';import path from 'node:path';import {pathToFileURL}from 'node:url';import {createRequire}from 'node:module';
const {build}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild'),web=new URL('..',import.meta.url).pathname;
test('ordinary checkout: current package selection, no recovery UI, explicit creation and payment safety',{timeout:30000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-checkout-ui-')),pending=new Map();let chrome,buffer='',serial=0,session;
 const call=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out'));},8000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description);return r.result.result.value;};
 const until=async expr=>{for(let i=0;i<240;i++){if(await evaluate(`Boolean(${expr})`))return;await new Promise(r=>setTimeout(r,20));}throw Error('Browser condition failed: '+expr+' '+JSON.stringify(await evaluate('({notice:document.querySelector("[data-payment-notice]")?.textContent,reads:window.__reads,id:window.__id,status:window.__status})')));};
 const click=async expr=>{const point=await evaluate(`(()=>{const e=${expr};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});};
 const cashierRequests=[];
 try{
 const {readFileSync,readdirSync}=await import('node:fs');const source=readFileSync(path.join(web,'src/pages/checkout.astro'),'utf8');
 const script=source.slice(source.indexOf('  <script>')+10,source.indexOf('  </script>'));
 const setup=`const fixtureId='11111111-1111-4111-8111-111111111111';const mode=new URL(location.href).searchParams.get('fixture')||'pending';window.__calls=[];window.__creates=0;
 try{localStorage.setItem('reply-copilot:pending-payment',JSON.stringify({orderId:fixtureId,at:Date.now()}));}catch{}
 const pkg={id:'starter',name_zh:'入门包',name_en:'Starter',credits:400,price_cents:149,promo_price_cents:null,currency:'USD',price_cny_fen:990,service_fee_fen:0,total_payment_fen:1043,fee_rate_bps:0};
 const status=['closed','failed','refunded','paid','unknown'].includes(mode)?mode:mode==='unavailable'?'closed':'pending';
 const order={id:fixtureId,packageId:'starter',packageName:'原套餐 snapshot',credits:400,displayPriceCents:149,displayCurrency:'USD',baseAmountFen:990,serviceFeeFen:0,feeRateBps:0,amountFen:1043,currency:'CNY',merchantPricing:{rateBps:500,costCoverageFen:53,status:'estimate_unverified'},status,riskState:mode==='risk'?'manual_review':'clear',creditedAt:status==='paid'?1:null,paidAt:status==='paid'?1:null,paymentProvider:mode==='epay'?'xiaodou_epay':'mk99',paymentProtocol:mode==='epay'?'epay':'mk99',paymentChannel:'WECHAT_H5',paymentUrl:mode==='epay'?null:mode==='badurl'?'https://evil.invalid/': 'https://cashier.fixture.invalid/pay/example',paymentCashierOrigin:'https://cashier.fixture.invalid'};
 window.fetch=async(url,init={})=>{if(!String(url).startsWith('https://checkout.fixture.invalid'))throw Error('External requests forbidden');const p=new URL(url).pathname;window.__calls.push([p,init.method||'GET']);
 if(p==='/v1/packages')return Response.json({packages:mode==='unavailable'?[]:[pkg],paymentAvailable:true,paymentProvider:'mk99',paymentMethods:[{provider:'mk99',channel:'ALIPAY_H5'},{provider:'mk99',channel:'WECHAT_H5'},{provider:'xiaodou_epay',channel:'ALIPAY_H5'}]});
 if(p==='/v1/auth/csrf')return Response.json({csrfToken:'synthetic-only'});
 if(p==='/v1/me')return Response.json({user:{userId:'synthetic-user'}});
 if(p==='/v1/usage')return Response.json({quota:{freeRemaining:200,paidRemaining:400,totalRemaining:600}});
 if(p.endsWith('/attempts'))return Response.json({paymentForm:{method:'POST',action:'https://epay.fixture.invalid/submit.php',fields:{pid:'synthetic-only'}}});
 if(p==='/v1/orders'){window.__creates++;if(mode.startsWith('newsuccess')){order.id='22222222-2222-4222-8222-222222222222';order.paymentChannel=JSON.parse(init.body).channel;return Response.json({order},{status:201});}return Response.json({code:'UNRESOLVED_ORDER_EXISTS',message:'Existing order'}, {status:409});}
 if(p.endsWith('/refresh'))return mode==='queryerror'?Response.json({code:'UPSTREAM_FAILED',message:'Synthetic network failure'},{status:502}):Response.json({ok:true,orderStatus:'pending',verificationSource:'authenticated_https_query'});
 if(p.startsWith('/v1/orders/'))return mode==='otheruser'?Response.json({code:'ORDER_NOT_FOUND',message:'Not found'},{status:404}):Response.json({order:{...order,...(mode==='newsuccess-latest'?{paymentUrl:'https://cashier.fixture.invalid/pay/latest'}:mode==='newsuccess-paid'?{status:'paid',paidAt:1,creditedAt:1}:{})},quota:{paidRemaining:0,totalRemaining:200}});
 throw Error('Unexpected route '+p);
 };`;
 await build({stdin:{contents:'{'+setup+'}\n'+script,resolveDir:path.join(web,'src/pages'),loader:'ts'},bundle:true,platform:'browser',format:'iife',define:{'import.meta.env.PUBLIC_API_BASE_URL':'"https://checkout.fixture.invalid"','import.meta.env.DEV':'false'},outfile:path.join(dir,'app.js')});
 const css=readdirSync(path.join(web,'dist/_astro')).find(x=>x.endsWith('.css'));
 const content=source.slice(source.indexOf('  <div class="container page-hero">'),source.indexOf('  <script>'));
 writeFileSync(path.join(dir,'index.html'),`<html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${pathToFileURL(path.join(web,'dist/_astro',css)).href}">${content}<script src="app.js"></script></html>`);
 chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-pipe',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});chrome.stderr.on('data',c=>{if(String(c).includes('FATAL'))console.error(String(c));});chrome.on('exit',(code,signal)=>{if(code)console.error('Test Chrome exited',code,signal);});chrome.stdio[4].on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\0'))>=0){const r=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);if(r.method==='Fetch.requestPaused'){const request=r.params.request;if(request.url!=='https://cashier.fixture.invalid/favicon.ico')cashierRequests.push({url:request.url});void call('Fetch.fulfillRequest',{requestId:r.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<!doctype html><link rel="icon" href="data:,">Synthetic cashier; no merchant contacted').toString('base64')},r.sessionId).catch(()=>{});continue;}const p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r);}}});
 const target=(await call('Target.createTarget',{url:'about:blank'},null)).result.targetId;session=(await call('Target.attachToTarget',{targetId:target,flatten:true},null)).result.sessionId;await call('Page.enable');await call('Fetch.enable',{patterns:[{urlPattern:'https://cashier.fixture.invalid/*'}]});
 const id='11111111-1111-4111-8111-111111111111',base=pathToFileURL(path.join(dir,'index.html')).href;
 for(const mode of ['pending','unknown','paid','closed','failed','refunded','risk','badurl','queryerror','unavailable','otheruser','epay']){
  await call('Page.navigate',{url:base+'?order='+id+'&fixture='+mode});await until('window.__calls?.some(c=>c[0].startsWith("/v1/orders/"))');
  if(mode==='otheruser'){await until('document.querySelector("#checkout-status").textContent.includes("无法读取原订单")');assert.equal(await evaluate('document.querySelector("#cashier-link").hidden'),true);continue;}
  await until('document.querySelector("#package-cny").textContent.includes("10.43")');
  if(mode==='pending')await until('!document.querySelector("#cashier-link").hidden');
  assert.equal(await evaluate('window.__creates'),0,'review never creates an order');
  assert.match(await evaluate('document.querySelector("#package-cny").textContent'),/10\.43/);
  assert.equal(await evaluate('!document.querySelector("#cashier-link").hidden'),mode==='pending');
  assert.equal(await evaluate('document.querySelector("#order-reference,#replacement-purchase,#replacement-help,#cashier-help,#payment-support")===null'),true,'no extra recovery UI');
  if(['unknown','risk','queryerror','badurl'].includes(mode))assert.equal(await evaluate('document.querySelector("#restart-payment").hidden'),true);
  if(mode==='unknown'){await evaluate('document.querySelector("#refresh-order").click()');await until('window.__calls.some(c=>c[0].endsWith("/refresh"))');assert.equal(await evaluate('document.querySelector("#cashier-link").hidden'),true);}
  if(mode==='epay'){assert.equal(await evaluate('document.querySelector("#epay-submit").hidden'),false);await evaluate('document.querySelector("#epay-submit").click()');await until('!document.querySelector("#epay-pay-label").hidden');assert.equal(await evaluate('window.__calls.filter(c=>c[0].endsWith("/attempts")).length'),1);}
  await evaluate('document.documentElement.lang="en";window.dispatchEvent(new Event("reply-copilot-language"))');assert.match(await evaluate('document.querySelector("#package-cny").textContent'),/10\.43/);
  if(mode==='pending'){await call('Emulation.setDeviceMetricsOverride',{width:375,height:850,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);}
 }
 await call('Page.navigate',{url:base+'?package=starter'});await until('!document.querySelector("#create-order").disabled');assert.equal(await evaluate('window.__calls.some(c=>c[0].startsWith("/v1/orders/"))'),false,'remembered old order must not override explicit package');
 assert.equal(await evaluate('document.querySelectorAll("input[name=payment-channel]").length'),3);assert.equal(await evaluate('document.querySelector("#order-reference,#cashier-help,#replacement-purchase")===null'),true);
 await evaluate('document.querySelector("#create-order").click();document.querySelector("#create-order").click()');await until('document.querySelector("#checkout-status").textContent.includes("该套餐已有待付款")');assert.equal(await evaluate('window.__creates'),1);assert.equal(await evaluate('document.querySelector("#restart-payment").hidden'),true);
 for(const mode of ['newsuccess','newsuccess-latest','newsuccess-paid']){
 await call('Page.navigate',{url:base+'?package=starter&fixture='+mode});await until('!document.querySelector("#create-order").disabled');await evaluate('document.querySelectorAll("input[name=payment-channel]")[1].click();document.querySelector("#create-order").click()');
 await until('window.__calls.some(c=>c[0]==="/v1/orders/22222222-2222-4222-8222-222222222222")');
 if(mode==='newsuccess-paid'){await until('document.querySelector("#cashier-link").hidden');continue;}
 await until('!document.querySelector("#cashier-link").hidden');assert.equal(await evaluate('window.__creates'),1);
 const before=await evaluate('window.__calls.length');
 // Last test-only listener prevents external navigation after observing the real handler.
 await evaluate(`document.querySelector('#cashier-link').addEventListener('click',event=>{window.__navigation={prevented:event.defaultPrevented,url:event.currentTarget.href,target:event.currentTarget.target,rel:event.currentTarget.rel};event.preventDefault();});document.querySelector('#cashier-link').click()`);
 const nav=await evaluate('window.__navigation');assert.equal(nav.prevented,false,'ordinary purchase must retain native navigation');assert.equal(nav.target,'_blank');assert.equal(nav.rel,'noopener noreferrer');assert.equal(nav.url,'https://cashier.fixture.invalid/pay/'+(mode==='newsuccess-latest'?'latest':'example'));assert.equal(await evaluate('window.__calls.length'),before,'no asynchronous query inserted into normal cashier click');
 assert.equal(await evaluate('window.__creates'),1,'cashier click never creates a second transaction');
 }
 await call('Page.navigate',{url:base+'?order=bad'});await until('document.querySelector("#checkout-status").textContent.includes("订单编号无效")');assert.equal(await evaluate('window.__calls.length'),0);
 }finally{if(chrome&&chrome.exitCode===null){const closed=new Promise(r=>chrome.once('exit',r));void call('Browser.close',{},null).catch(()=>{});const killer=setTimeout(()=>chrome.kill(),1500);await closed;clearTimeout(killer);}for(const p of pending.values())clearTimeout(p.timer);rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
