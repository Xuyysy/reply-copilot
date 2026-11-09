import test from 'node:test';import assert from 'node:assert/strict';import {spawn,execFileSync}from 'node:child_process';import {mkdtempSync,writeFileSync,rmSync}from 'node:fs';import {tmpdir}from 'node:os';import path from 'node:path';import {pathToFileURL}from 'node:url';import {createRequire}from 'node:module';
const {build}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild'),web=new URL('..',import.meta.url).pathname;
test('binding confirmation: identity, safe cancel, switch, terminal codes and one approval',{timeout:30000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-payment-ui-')),pending=new Map();let chrome,buffer='',serial=0,session;
 const call=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out'));},8000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description);return r.result.result.value;};
 const until=async (expr,attempts=240)=>{for(let i=0;i<attempts;i++){if(await evaluate(`Boolean(${expr})`))return;await new Promise(r=>setTimeout(r,20));}throw Error('Browser condition failed: '+expr+' '+JSON.stringify(await evaluate('({notice:document.querySelector("[data-payment-notice]")?.textContent,reads:window.__reads,id:window.__id,status:window.__status})')));};
 const click=async expr=>{const point=await evaluate(`(()=>{const e=${expr};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});};
 try{
 await build({plugins:[{name:'binding-fixture-origin',setup(builder){
  builder.onLoad({filter:/extension-binding\.ts$/},async args=>({contents:(await import('node:fs')).readFileSync(args.path,'utf8').replace('extensionIds[location.origin]','extensionIds["https://app.x-reply-helper.top"]'),loader:'ts'}));
 }}],stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Account from './src/components/account/AccountDashboard';
 const params=new URLSearchParams(location.search), owner=params.get('owner')||'First account';
 window.posts=[];window.releaseApproval=null;window.bridgeCalls=[];
 if(params.has('bridge'))window.chrome={runtime:{sendMessage(id,message,reply){
  window.bridgeCalls.push(message.type);
  const allowed=id==='fgfjajofkapebgphfidblngcjomkbdaj' && message.deviceCode==='A1B2C3D4' && message.proof==='975984bd-b962-4814-8a11-8d842f163890';
  reply({status:!allowed?'unavailable':message.type==='XRH_BINDING_VERIFY'?'verified':window.connected?'connected':params.has('terminal')?'unavailable':'network_error'});
 }}};
 window.fetch=async(url,init={})=>{
  const u=new URL(url);
  if(u.origin!=='https://account.fixture.invalid')throw Error('External forbidden');
  if(u.pathname==='/v1/auth/csrf')return Response.json({csrfToken:'fixture-csrf'});
  if(u.pathname==='/v1/me')return Response.json({user:{userId:owner,username:owner,email:'binding-fixture-with-a-long-email-address@example.test',role:'user',emailVerified:true}});
  if(u.pathname==='/v1/usage')return Response.json({quota:{freeRemaining:0,paidRemaining:0,totalRemaining:0},signupBenefit:{status:'pending',amount:200}});
  if(u.pathname==='/v1/activity')return Response.json({ledger:[],orders:[]});
  if(u.pathname==='/v1/extension/device-code/status')return Response.json({status:params.get('status')||'pending'});
  if(init.method==='POST'){
   window.posts.push({path:u.pathname,body:JSON.parse(init.body),csrf:init.headers['X-CSRF-Token']});
   if(u.pathname==='/v1/auth/logout')return Response.json({ok:true});
   if(u.pathname==='/v1/extension/approve'){await new Promise(resolve=>window.releaseApproval=resolve);return Response.json({ok:true});}
  }
  throw Error('Unexpected API '+u.pathname);
 };
 document.documentElement.lang=params.get('lang')||'zh';
 createRoot(document.getElementById('root')).render(<Account/>);`,resolveDir:web,loader:'tsx'},bundle:true,platform:'browser',format:'iife',define:{'import.meta.env.PUBLIC_API_BASE_URL':'"https://account.fixture.invalid"','import.meta.env.DEV':'false'},outfile:path.join(dir,'app.js')});
 const {readdirSync}=await import('node:fs');
 const css=readdirSync(path.join(web,'dist/_astro')).find(x=>x.endsWith('.css'));
 const file=path.join(dir,'index.html');
 writeFileSync(file,`<html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${pathToFileURL(path.join(web,'dist/_astro',css)).href}"><div id="root"></div><script src="app.js"></script></html>`);
 chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-pipe',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});chrome.stdio[4].on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\0'))>=0){const r=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);const p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r);}}});
 const target=(await call('Target.createTarget',{url:'about:blank'},null)).result.targetId;session=(await call('Target.attachToTarget',{targetId:target,flatten:true},null)).result.sessionId;await call('Page.enable');
 const go=async extra=>call('Page.navigate',{url:pathToFileURL(file).href+'?device_code=A1B2C3D4'+extra});
 const dialog='document.querySelector("[role=dialog]")';
 const button=text=>`[...${dialog}.querySelectorAll("button")].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
 const assertLocked=async()=>{
  assert.deepEqual(await evaluate(`[...${dialog}.querySelectorAll('button')].map(b=>b.textContent.trim())`),['切换账户']);
  assert.equal(await evaluate(`!!${dialog}.querySelector('[data-slot="dialog-close"]')`),false);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  const outside=await evaluate(`(()=>{const r=${dialog}.getBoundingClientRect();return {x:4,y:Math.max(1,r.top-8)};})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...outside,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...outside,button:'left',clickCount:1});
  assert.equal(await evaluate('Boolean('+dialog+')'),true);
 };
 const shot=async name=>{
  if(!process.env.RC_BINDING_SCREENSHOTS)return;
  const image=await call('Page.captureScreenshot',{format:'png'});
  writeFileSync(path.join(process.env.RC_BINDING_SCREENSHOTS,name+'.png'),Buffer.from(image.result.data,'base64'));
 };
 await go('');
 await until(dialog);
 assert.match(await evaluate(dialog+'.textContent'),/确认绑定 X Reply Helper.*First account.*binding-fixture.*A1B2C3D4.*不是你的账户/);
 await call('Emulation.setDeviceMetricsOverride',{width:375,height:850,deviceScaleFactor:1,mobile:true});
 await until(dialog+'.getBoundingClientRect().right<=innerWidth');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await shot('binding-zh-mobile');
 await click(button('取消'));
 await until('!'+dialog);
 assert.deepEqual(await evaluate('posts'),[]);
 assert.equal(await evaluate('new URL(location.href).searchParams.has("device_code")'),false);

 await go('');
 await until(dialog);
 await click(button('切换账户'));
 await until('location.pathname==="/login" || location.href.startsWith("chrome-error:")');
 const history=(await call('Page.getNavigationHistory')).result;
 assert.ok(history.entries.some(e=>e.url.includes('/login?mode=login&device_code=A1B2C3D4')));

 await call('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
 await go('&owner=Correct%20account&lang=en');
 await until(dialog);
 assert.match(await evaluate(dialog+'.textContent'),/Confirm X Reply Helper binding.*Correct account.*Not your account/);
 await shot('binding-en-desktop');
 const approve=button('Confirm extension binding');
 await evaluate(`${approve}.click();${approve}.click()`);
 await until('Boolean(window.releaseApproval)');
 assert.deepEqual(await evaluate('posts'),[{path:'/v1/extension/approve',body:{deviceCode:'A1B2C3D4'},csrf:'fixture-csrf'}]);
 assert.equal(await evaluate(approve+'.disabled'),true);
 await evaluate('releaseApproval()');
 await until(dialog+'?.textContent.includes("Waiting for the extension to finish connecting")');
 assert.equal(await evaluate('Boolean('+approve+')'),false);
 await shot('binding-approved-en');
 for(const [status,message] of [['expired','设备码已过期'],['used','设备码已使用']]){
  await go('&status='+status);
  await until('document.body.textContent.includes('+JSON.stringify(message)+')');
  assert.equal(await evaluate('Boolean('+dialog+')'),false);
  assert.deepEqual(await evaluate('posts'),[]);
 }
 await go('&bridge=1#binding=88888888-8888-4888-8888-888888888888');
 await until('window.bridgeCalls?.length===1');
 assert.deepEqual(await evaluate('posts'),[]);
 assert.equal(await evaluate('Boolean('+button('确认绑定插件')+')'),true);

 await call('Emulation.setDeviceMetricsOverride',{width:375,height:850,deviceScaleFactor:1,mobile:true});
 await go('&bridge=2#binding=975984bd-b962-4814-8a11-8d842f163890');
 await until(dialog+'?.textContent.includes("即将连接当前账户")');
 await assertLocked();
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await shot('binding-auto-zh-mobile');
 await click(button('切换账户'));
 await until('location.pathname==="/login" || location.href.startsWith("chrome-error:")');
 assert.ok((await call('Page.getNavigationHistory')).result.entries.some(e=>e.url.includes('/login?mode=login&device_code=A1B2C3D4')));

 await go('&bridge=3#binding=975984bd-b962-4814-8a11-8d842f163890');
 await until(dialog+'?.textContent.includes("即将连接当前账户")');
 assert.deepEqual(await evaluate('posts'),[]);
 assert.equal(await evaluate('Boolean('+button('确认绑定插件')+')'),false);
 await until('Boolean(window.releaseApproval)');
 assert.equal(await evaluate('posts.length'),1);
 await evaluate('releaseApproval()');
 await until(dialog+'?.textContent.includes("正在等待插件完成连接")');
 assert.equal(await evaluate(dialog+'.textContent.includes("插件绑定完成")'),false);
 assert.equal(await evaluate(`[...${dialog}.querySelectorAll('button')].length`),0);
 await until(dialog+'?.textContent.includes("等待插件连接超时")',500);
 assert.equal(await evaluate('Boolean('+button('重新检查连接')+')'),true);
 await evaluate('window.connected=true');
 await click(button('重新检查连接'));
 await until(dialog+'?.textContent.includes("插件绑定完成")');
 assert.equal(await evaluate('posts.length'),1);
 await call('Emulation.setDeviceMetricsOverride',{width:1280,height:850,deviceScaleFactor:1,mobile:false});
 await go('&bridge=4&lang=en&terminal=1#binding=975984bd-b962-4814-8a11-8d842f163890');
 await until(dialog+'?.textContent.includes("Connecting to this account shortly")');
 assert.equal(await evaluate(`[...${dialog}.querySelectorAll('button')].map(b=>b.textContent.trim()).join(',')`),'Switch account');
 await shot('binding-auto-en-desktop');
 await until('Boolean(window.releaseApproval)');
 await evaluate('releaseApproval()');
 await until(dialog+'?.textContent.includes("could not be verified")');
 assert.equal(await evaluate('Boolean('+button('Check connection again')+')'),true);
 assert.equal(await evaluate(dialog+'.textContent.includes("Extension connected")'),false);
 }finally{if(chrome&&chrome.exitCode===null){const closed=new Promise(r=>chrome.once('exit',r));void call('Browser.close',{},null).catch(()=>{});const killer=setTimeout(()=>chrome.kill(),1500);await closed;clearTimeout(killer);}for(const p of pending.values())clearTimeout(p.timer);rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
