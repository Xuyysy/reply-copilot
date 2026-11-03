import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {buildSync}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const root=new URL('..',import.meta.url).pathname;

test('guide tutorial and admin editor work with live content changes, both languages and narrow layouts', {timeout:60000}, async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-guide-')),pending=new Map();let chrome,server,buffer='',serial=0,session,script;
 const call=(method,params={},sessionId=session)=>new Promise((resolve,reject)=>{
  const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Chrome timeout: '+method));},10000);
  pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
 });
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result.result.value;};
 const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,20));}throw Error('Did not settle: '+expression);};
 const url1='https://x.com/i/article/1234567890123456789',url2='https://x.com/example/article/2345678901234567890';
 try{
  buildSync({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Editor from './src/components/admin/SiteEditor';
   window.__saved=[];window.__restored=[];window.__render=(language,content,pending=false)=>{window.__root?.unmount();window.__root=createRoot(document.getElementById('root'));window.__root.render(React.createElement(Editor,{language,content,pending,onSave:c=>window.__saved.push(c),loadHistory:async()=>({versions:[{id:'version-1',created_at:1,actor_user_id:'synthetic'}]}),onRestore:id=>window.__restored.push(id)}));};`,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:path.join(dir,'editor.js')});
  server=createServer((req,res)=>{try{
   const name=new URL(req.url,'http://localhost').pathname;
   if(name==='/editor.html'){res.setHeader('content-type','text/html');res.end('<div id="root"></div><script src="/editor.js"></script>');return;}
   if(name==='/editor.js'){res.setHeader('content-type','application/javascript');res.end(readFileSync(path.join(dir,'editor.js')));return;}
   const file=path.resolve(root,'dist','.'+name+(name.endsWith('/')?'index.html':''));if(!file.startsWith(path.join(root,'dist')+path.sep))throw Error('Forbidden');
   res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'image/svg+xml');res.end(readFileSync(file));
  }catch{res.statusCode=404;res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  chrome=spawn(process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-pipe',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  chrome.stdio[4].on('data',chunk=>{buffer+=chunk.toString();let index;while((index=buffer.indexOf('\0'))>=0){const r=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);const p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r);}}});
  const target=(await call('Target.createTarget',{url:'about:blank'},undefined)).result.targetId;
  session=(await call('Target.attachToTarget',{targetId:target,flatten:true},undefined)).result.sessionId;
  await call('Page.enable');await call('Runtime.enable');
  // No remote API or authenticated browser session: actual built page, local HTTP,
  // fixed public-content response and unauthenticated account response only.
  for(const width of [1200,375,260]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
   for(const language of ['zh','en']){
    for(const xTutorialUrl of ['',url1,url2,'']){
     if(script)await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:script});
     script=(await call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('replyCopilotLanguage',${JSON.stringify(language)});window.fetch=async url=>{const p=new URL(String(url),location.href).pathname;if(p==='/v1/site')return Response.json({content:${JSON.stringify({xTutorialUrl,chromeStoreUrl:'https://chromewebstore.google.com/detail/fgfjajofkapebgphfidblngcjomkbdaj'})}});if(p==='/v1/me')return Response.json({code:'UNAUTHORIZED'},{status:401});throw Error('Unexpected external request');};`})).result.identifier;
     await call('Page.navigate',{url:origin+'/guide/'});
     await until(`document.readyState==='complete'&&document.querySelector('#language-toggle')?.textContent===${JSON.stringify(language==='zh'?'English':'中文')}&&!!document.querySelector('[data-site-link="chromeStoreUrl"][href]')`);
     const state=await evaluate(`(()=>{const a=document.querySelector('[data-site-link="xTutorialUrl"]'),install=document.querySelector('.guide-actions [data-site-link="chromeStoreUrl"]');return {hidden:a.hidden,href:a.getAttribute('href'),text:a.textContent,target:a.target,rel:a.rel,overflow:document.documentElement.scrollWidth>innerWidth,install:!!install.href,steps:document.querySelectorAll('.feature-card').length,top:a.getBoundingClientRect().top,installTop:install.getBoundingClientRect().top};})()`);
     assert.equal(state.hidden,!xTutorialUrl);assert.equal(state.href,xTutorialUrl||null);assert.equal(state.text,language==='zh'?'查看 X 图文教程':'View X Tutorial');assert.equal(state.target,'_blank');assert.equal(state.rel,'noopener noreferrer');assert.equal(state.overflow,false,JSON.stringify({width,language,state}));assert.equal(state.install,true);assert.equal(state.steps,3);
     if(xTutorialUrl&&width===1200)assert.equal(state.top,state.installTop);
     // Real page language handler must not change destination or visibility.
     await evaluate(`document.querySelector('#language-toggle').click()`);
     assert.equal(await evaluate(`document.querySelector('[data-site-link="xTutorialUrl"]').textContent`),language==='en'?'查看 X 图文教程':'View X Tutorial');
     assert.equal(await evaluate(`document.querySelector('[data-site-link="xTutorialUrl"]').getAttribute('href')`),xTutorialUrl||null);
    }
   }
  }
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:script});script=null;
  await call('Page.navigate',{url:origin+'/editor.html'});await until('typeof window.__render === "function"');
  for(const language of ['zh','en']){
   await evaluate(`window.__render(${JSON.stringify(language)},{homeTitleZh:'Existing title',guideEn:'Existing guide'})`);await until('!!document.querySelector("#x-tutorial-url")');
   assert.match(await evaluate(`document.querySelector('[for="x-tutorial-url"]').textContent`),language==='en'?/X Tutorial URL/:/X 图文教程链接/);
   const set=async value=>{await evaluate(`(()=>{const e=document.querySelector('#x-tutorial-url');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await evaluate('new Promise(r=>requestAnimationFrame(r))');};
   const save=()=>evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='保存内容').click()`);
   const before=await evaluate('window.__saved.length');await set('https://x.com.evil.test/example/status/123');await save();assert.equal(await evaluate('window.__saved.length'),before);assert.ok(await evaluate(`!!document.querySelector('[role="alert"]')`));
   await set(url1);await save();assert.deepEqual(await evaluate('window.__saved.at(-1)'),{homeTitleZh:'Existing title',guideEn:'Existing guide',xTutorialUrl:url1});
   await set('');await save();assert.equal(await evaluate('window.__saved.at(-1).xTutorialUrl'),'');
   await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='读取历史').click()`);await until(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='恢复此版本')`);
   await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='恢复此版本').click()`);assert.equal(await evaluate('window.__restored.at(-1)'),'version-1');
  }
 }finally{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Test cleanup'));}pending.clear();
  if(chrome){const closed=new Promise(r=>chrome.once('exit',r));chrome.kill();await Promise.race([closed,new Promise(r=>setTimeout(r,2000))]);}
  if(server)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});
 }
});
