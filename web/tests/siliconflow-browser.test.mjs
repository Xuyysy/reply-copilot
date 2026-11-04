import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const {buildSync}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const webRoot=new URL('..',import.meta.url).pathname;

test('SiliconFlow real React controls: bilingual regions, isolated keys/rates, JSON, thinking, save and rollback (mock only)',{timeout:45000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-sf-ui-'));let chrome,buffer='',serial=0,session;const pending=new Map();
 const call=(method,params={},sessionId=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Chrome timeout '+method));},10000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result.result.value;};
 const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,20));}throw Error('UI did not settle: '+expression);};
 try{
  buildSync({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Panel from './src/components/admin/AIModelManagementPanel';
  const root=createRoot(document.getElementById('root'));window.__calls=[];window.__refresh=0;window.__confirm=0;
  window.fetch=()=>{throw Error('Network forbidden in isolated UI test')};
  window.__mount=language=>root.render(React.createElement(Panel,{key:language,language,busy:false,read:async()=>({active:{provider:'qwen',name:'Existing Qwen (mock)',modelId:'qwen3.7-flash',version:1},previous:{name:'Legacy',modelId:'deepseek'},previousAvailable:true,configs:[]}),write:async(path,body)=>{window.__calls.push({path,body});return{ok:true}},refresh:async()=>{window.__refresh++},confirm:(_title,_description,action)=>{window.__confirm++;return action()}}));`,resolveDir:webRoot,loader:'tsx'},bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':JSON.stringify({PUBLIC_API_BASE_URL:'https://api-staging.x-reply-helper.top',DEV:false})},tsconfig:path.join(webRoot,'tsconfig.json'),outfile:path.join(dir,'app.js')});
  const css=readdirSync(path.join(webRoot,'dist/_astro')).filter(p=>p.endsWith('.css')).map(p=>readFileSync(path.join(webRoot,'dist/_astro',p),'utf8')).join('\n');
  writeFileSync(path.join(dir,'index.html'),'<html><meta charset="utf-8"><style>'+css+'</style><style>body{font:16px system-ui;margin:30px;background:#f5f7fa}label{display:inline-grid;margin:12px;width:40%;gap:6px}input,select,button{padding:8px}button{margin:8px}p{max-width:900px}#root{max-width:1100px;margin:auto;background:white;padding:20px}</style><div id="root"></div><script src="app.js"></script></html>');
  chrome=spawn(process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-pipe',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  chrome.stdio[4].on('data',chunk=>{buffer+=chunk.toString();let at;while((at=buffer.indexOf('\0'))>=0){const r=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);const p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r);}}});
  const target=(await call('Target.createTarget',{url:'about:blank'},undefined)).result.targetId;session=(await call('Target.attachToTarget',{targetId:target,flatten:true},undefined)).result.sessionId;
  await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:1100,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:pathToFileURL(path.join(dir,'index.html')).href});await until('typeof window.__mount === "function"');
  let expectedCalls=0;
  for(const language of ['zh','en']) for(const region of ['china','global']){
   await evaluate(`window.__mount('${language}-${region}'.split('-')[0])`);await until('!!document.querySelector("select")');
   // Reset provider between cases without remounting the language's existing root.
   await evaluate(`{const select=document.querySelector('select');select.value='deepseek';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
   await evaluate(`{const select=document.querySelector('select');select.value='siliconflow';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
   await until(`!!document.querySelector('[data-testid="siliconflow-region"]')`);
   assert.equal(await evaluate(`document.querySelectorAll('input')[2].value`),'https://api.siliconflow.cn/v1');
   // Seed a draft key/rates and prove a region change cannot retain them.
   await evaluate(`{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const i of [4,5,6]){const e=document.querySelectorAll('input')[i];set.call(e,i===4?'synthetic-china-secret':'1');e.dispatchEvent(new Event('input',{bubbles:true}));}}`);
   await evaluate(`{const e=document.querySelector('[data-testid="siliconflow-region"]');e.value='global';e.dispatchEvent(new Event('change',{bubbles:true}));}`);
   await until(`document.querySelectorAll('input')[2].value==='https://api.siliconflow.com/v1'`);
   assert.deepEqual(await evaluate(`[4,5,6].map(i=>document.querySelectorAll('input')[i].value)`),['','','']);
   if(region==='china')await evaluate(`{const e=document.querySelector('[data-testid="siliconflow-region"]');e.value='china';e.dispatchEvent(new Event('change',{bubbles:true}));}`);
   const host=region==='global'?'api.siliconflow.com':'api.siliconflow.cn';
   await until(`document.querySelectorAll('input')[2].value==='https://${host}/v1'`);
   assert.equal(await evaluate(`document.querySelectorAll('input')[2].readOnly`),true);
   assert.equal(await evaluate(`document.querySelectorAll('select')[2].value`),'disabled');
   if(language==='zh'&&process.env.SILICONFLOW_SCREENSHOT){const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(process.env.SILICONFLOW_SCREENSHOT.replace('.png','-'+region+'.png'),Buffer.from(shot.result.data,'base64'));}
   await evaluate(`{const thinking=document.querySelectorAll('select')[2];thinking.value='';thinking.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('input[type="checkbox"]').click();
   const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const inputs=document.querySelectorAll('input');for(const [index,value]of [[0,'Synthetic SiliconFlow ${region}'],[3,'Qwen/Any-Valid-Model'],[4,'synthetic-${region}-never-real'],[5,'0.3'],[6,'1.2']]){set.call(inputs[index],value);inputs[index].dispatchEvent(new Event('input',{bubbles:true}));}}`);
   if(region==='china')await evaluate(`document.querySelector('[data-testid="siliconflow-rate-confirmation"]').click()`);
   await evaluate(`new Promise(r=>requestAnimationFrame(r))`);
   await evaluate(`[...document.querySelectorAll('button')].find(e=>/保存配置|Save without switching/.test(e.textContent)).click()`);
   await until(`window.__calls.length===${++expectedCalls}`);
   const saved=await evaluate('window.__calls.at(-1)');assert.equal(saved.path,'/v1/admin/ai-models');assert.equal(saved.body.provider,'siliconflow');assert.equal(saved.body.baseUrl,`https://${host}/v1`);assert.equal(saved.body.modelId,'Qwen/Any-Valid-Model');assert.equal(saved.body.apiKey,`synthetic-${region}-never-real`);assert.equal(saved.body.options.jsonMode,false);assert.equal('thinkingMode'in saved.body.options,false);assert.equal(saved.body.options.rateCurrency,'USD');
   await evaluate(`[...document.querySelectorAll('button')].find(e=>/回滚上一可用|Rollback previous/.test(e.textContent)).click()`);await until(`window.__calls.length===${++expectedCalls}`);assert.equal(await evaluate('window.__calls.at(-1).path'),'/v1/admin/ai-models/rollback');
  }
 }finally{if(chrome&&chrome.exitCode===null){const closed=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await closed;}for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Browser closed'));}rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
