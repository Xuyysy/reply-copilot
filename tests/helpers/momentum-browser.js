import {spawn} from 'node:child_process';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
export async function withMomentumBrowser(html,action){
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-momentum-'));let chrome,buffer='',seq=0,session;const pending=new Map();
 const call=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated browser command timeout: '+method));},30000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');});
 try{
  writeFileSync(path.join(dir,'index.html'),'<meta name="viewport" content="width=device-width, initial-scale=1">'+html);
  chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-pipe',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  chrome.stdio[4].on('data',c=>{buffer+=c;let n;while((n=buffer.indexOf('\0'))>=0){const r=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);const p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r);}}});
  const id=(await call('Target.createTarget',{url:'about:blank'},null)).result.targetId;session=(await call('Target.attachToTarget',{targetId:id,flatten:true},null)).result.sessionId;await call('Page.enable');await call('Page.navigate',{url:pathToFileURL(path.join(dir,'index.html')).href});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description);return r.result.result.value;};
  for(let i=0;i<150;i++){if(await evaluate('document.readyState==="complete"&&Boolean(window.momentumReady)'))break;if(i===149)throw Error('Fixture not ready');await new Promise(r=>setTimeout(r,10));}
  return await action({evaluate,call});
 }finally{
  if(chrome&&chrome.exitCode===null){const exited=new Promise(r=>chrome.once('exit',r));void call('Browser.close',{},null).catch(()=>{});const timer=setTimeout(()=>chrome.kill(),1500);await exited;clearTimeout(timer);}for(const p of pending.values())clearTimeout(p.timer);rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
 }
}
