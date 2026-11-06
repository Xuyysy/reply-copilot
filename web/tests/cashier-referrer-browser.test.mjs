import test from 'node:test';import assert from 'node:assert/strict';import {spawn,execFileSync}from 'node:child_process';import {mkdtempSync,writeFileSync,rmSync}from 'node:fs';import {tmpdir}from 'node:os';import path from 'node:path';import {pathToFileURL}from 'node:url';import {createRequire}from 'node:module';
const {build}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild'),web=new URL('..',import.meta.url).pathname;
test('browser proves native noreferrer policy differs from location.assign and candidate restores legacy privacy',{timeout:30000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-cashier-privacy-')),pending=new Map();let chrome,buffer='',serial=0,session;
 const call=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out'));},8000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description);return r.result.result.value;};
 const until=async expr=>{for(let i=0;i<240;i++){if(await evaluate(`Boolean(${expr})`))return;await new Promise(r=>setTimeout(r,20));}throw Error('Browser condition failed: '+expr+' '+JSON.stringify(await evaluate('({notice:document.querySelector("[data-payment-notice]")?.textContent,reads:window.__reads,id:window.__id,status:window.__status})')));};
 const click=async expr=>{const point=await evaluate(`(()=>{const e=${expr};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});};
 try{
 let networkError=null;const observations=[];
 const targetUrl='https://cashier.fixture.invalid/process/next?trade_no=synthetic-only';
 const result=await build({stdin:{contents:`import {navigateVerifiedCashier}from './src/lib/cashier-navigation.mjs';window.openCandidate=()=>navigateVerifiedCashier(${JSON.stringify(targetUrl)},{allowedOrigin:'https://cashier.fixture.invalid'});`,resolveDir:web,loader:'js'},bundle:true,format:'iife',platform:'browser',write:false});
 const html=`<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><a id="legacy" href="${targetUrl}" target="_self" rel="noopener noreferrer">Legacy</a><button id="assign" onclick="location.assign('${targetUrl}')">Current</button><button id="candidate" onclick="window.openCandidate()">Candidate</button><script>${result.outputFiles[0].text}</script>`;
 const serve=async event=>{
  const req=event.params.request,source=req.url.startsWith('https://site.fixture.invalid/');
  if(!source&&!req.url.startsWith('https://cashier.fixture.invalid/'))throw Error('Unexpected external request');
  const observed=!source&&req.url===targetUrl?{url:req.url,referrer:Object.entries(req.headers).find(([k])=>k.toLowerCase()==='referer')?.[1]||null}:null;
  await call('Fetch.fulfillRequest',{requestId:event.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'},{name:'Referrer-Policy',value:'strict-origin-when-cross-origin'}],body:Buffer.from(source?html:'<!doctype html><link rel="icon" href="data:,">Synthetic cashier; no payment service contacted').toString('base64')},event.sessionId);
  if(observed)observations.push(observed);
 };
 chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-pipe',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});chrome.stdio[4].on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\0'))>=0){const r=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);if(r.method==='Fetch.requestPaused'){void serve(r).catch(error=>networkError=error);continue;}const p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r);}}});
 const target=(await call('Target.createTarget',{url:'about:blank'},null)).result.targetId;session=(await call('Target.attachToTarget',{targetId:target,flatten:true},null)).result.sessionId;await call('Page.enable');
 await call('Fetch.enable',{patterns:[{urlPattern:'https://site.fixture.invalid/*'},{urlPattern:'https://cashier.fixture.invalid/*'}]});
 for(const [index,button]of ['legacy','assign','candidate'].entries()){
  await call('Page.navigate',{url:'https://site.fixture.invalid/checkout/?synthetic=1'});await until('document.querySelector("#candidate")');await evaluate(`document.querySelector('#${button}').click()`);
  for(let i=0;i<100&&observations.length<=index;i++)await new Promise(r=>setTimeout(r,15));
  if(networkError)throw networkError;assert.equal(observations.length,index+1);assert.equal(observations[index].url,targetUrl);
 }
 assert.equal(observations[0].referrer,null);assert.equal(observations[1].referrer,'https://site.fixture.invalid/');assert.equal(observations[2].referrer,null);
 console.log('Synthetic Chrome network evidence: legacy=absent, location.assign=source origin, candidate=absent; original destination unchanged. This is not an MK99 approval test.');
 }finally{if(chrome&&chrome.exitCode===null){const closed=new Promise(r=>chrome.once('exit',r));void call('Browser.close',{},null).catch(()=>{});const killer=setTimeout(()=>chrome.kill(),1500);await closed;clearTimeout(killer);}for(const p of pending.values())clearTimeout(p.timer);rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
