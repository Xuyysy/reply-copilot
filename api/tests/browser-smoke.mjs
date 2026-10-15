import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const api=path.join(repo,'api'),web=path.join(repo,'web');
const temp=mkdtempSync(path.join(os.tmpdir(),'reply-copilot-chrome-smoke-'));
const wrangler=path.join(api,'node_modules/.bin/wrangler');
const chrome=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const webPort=20000+Math.floor(Math.random()*5000),apiPort=30000+Math.floor(Math.random()*5000),debuggerPort=40000+Math.floor(Math.random()*5000);
const webBase=`http://127.0.0.1:${webPort}`,apiBase=`http://127.0.0.1:${apiPort}`;
const randomSecret=()=>crypto.randomUUID()+crypto.randomUUID();
const env={...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(temp,'wrangler.log')};
const processes=[];let logs='';let socket,webServer;let nextId=0;const pending=new Map();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch{}await wait(100);}throw new Error(`Timed out. ${logs.slice(-800)}`);}
function launch(command,args,cwd){const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']});processes.push(child);for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{logs+=chunk.toString();});return child;}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{if(pending.delete(id))reject(new Error(`CDP timeout: ${method}`));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const reply=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(reply.result?.exceptionDetails)throw new Error(JSON.stringify(reply.result.exceptionDetails));return reply.result?.result?.value;}
async function browserCall(url,options={}){return evaluate(`(async()=>{const response=await fetch(${JSON.stringify(`${apiBase}${url}`)},${JSON.stringify({credentials:'include',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}})});return {status:response.status,body:await response.json()}})()`);}
async function nodeCall(url,body){const response=await fetch(`${apiBase}${url}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
try{
  assert.ok(existsSync(chrome),`Chrome not found: ${chrome}. Set CHROME_BINARY to its executable path.`);
  execFileSync(wrangler,['d1','migrations','apply','DB','--local','--persist-to',temp],{cwd:api,env,stdio:'pipe'});
  execFileSync('npm',['run','build'],{cwd:web,env,stdio:'pipe'});
  launch(wrangler,['dev','--local','--ip','127.0.0.1','--port',String(apiPort),'--persist-to',temp,'--var','ENVIRONMENT:development','--var','AI_MOCK:1','--var',`WEB_ORIGIN:${webBase}`,'--var',`API_ORIGIN:${apiBase}`,'--var',`PASSWORD_PEPPER:${randomSecret()}`,'--var',`AUTH_HASH_SECRET:${randomSecret()}`,'--var','TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA'],api);
  webServer=createServer((request,response)=>{try{const pathname=decodeURIComponent(new URL(request.url,webBase).pathname);const relative=pathname.endsWith('/')?`${pathname}index.html`:pathname;const filename=path.resolve(web,'dist',`.${relative}`);if(!filename.startsWith(path.resolve(web,'dist')+path.sep))throw new Error('Invalid path');const type=filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.svg')?'image/svg+xml':'text/html';response.setHeader('Content-Type',type);response.end(readFileSync(filename));}catch{response.statusCode=404;response.end('Not found');}});
  await new Promise((resolve,reject)=>webServer.listen(webPort,'127.0.0.1',error=>error?reject(error):resolve()));
  await until(async()=>{const response=await fetch(`${apiBase}/health`);return response.ok;});
  await until(async()=>{const response=await fetch(webBase);return response.ok;});
  launch(chrome,['--headless=new','--no-first-run','--no-default-browser-check',`--user-data-dir=${path.join(temp,'chrome')}`,`--remote-debugging-port=${debuggerPort}`,webBase],temp);
  const target=await until(async()=>{const tabs=await (await fetch(`http://127.0.0.1:${debuggerPort}/json/list`)).json();return tabs.find(tab=>tab.type==='page'&&tab.url.startsWith(webBase));},20000);
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const item=pending.get(message.id);pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(new Error(message.error.message)):item.resolve(message);}});
  await cdp('Runtime.enable');
  const email=`browser-${crypto.randomUUID()}@example.test`,username=`browser_${crypto.randomUUID().slice(0,8)}`;
  const register=await browserCall('/v1/auth/register',{method:'POST',body:JSON.stringify({email,username,password:'browser-test-password-123',turnstileToken:'local-test-token'})});assert.equal(register.status,200,JSON.stringify(register));
  const code=await until(()=>logs.match(new RegExp(`\\[LOCAL EMAIL ONLY\\] ${email}: (\\d{6})`))?.[1]);
  const verify=await browserCall('/v1/auth/verify-registration',{method:'POST',body:JSON.stringify({email,code})});assert.equal(verify.status,200,JSON.stringify(verify));
  const me=await browserCall('/v1/me');assert.equal(me.status,200,JSON.stringify(me));assert.equal(me.body.user.email,email);
  assert.equal(await evaluate('document.cookie.includes("rc_session")'),false);
  const usage=await browserCall('/v1/usage');assert.equal(usage.body.quota.totalRemaining,200);
  const csrf=await browserCall('/v1/auth/csrf');assert.equal(csrf.status,200);
  const device=await nodeCall('/v1/extension/device-code',{deviceId:crypto.randomUUID()});assert.equal(device.status,200);
  const approve=await browserCall('/v1/extension/approve',{method:'POST',headers:{'X-CSRF-Token':csrf.body.csrfToken,'X-Reply-Copilot-Action':'1'},body:JSON.stringify({deviceCode:device.body.deviceCode})});assert.equal(approve.status,200,JSON.stringify(approve));
  const exchange=await nodeCall('/v1/extension/exchange',{deviceToken:device.body.deviceToken});assert.equal(exchange.status,200);assert.ok(exchange.body.accessToken);
  const resetRequest=await browserCall('/v1/auth/request-password-reset',{method:'POST',body:JSON.stringify({email})});assert.equal(resetRequest.status,200);
  const resetCode=await until(()=>{const matches=[...logs.matchAll(new RegExp(`\\[LOCAL EMAIL ONLY\\] ${email}: (\\d{6})`,'g'))];return matches.length>=2?matches.at(-1)?.[1]:null;});
  const reset=await browserCall('/v1/auth/reset-password',{method:'POST',body:JSON.stringify({email,code:resetCode,password:'browser-new-password-456'})});assert.equal(reset.status,200,JSON.stringify(reset));
  assert.equal((await browserCall('/v1/me')).status,401);
  const login=await browserCall('/v1/auth/login',{method:'POST',body:JSON.stringify({identity:email,password:'browser-new-password-456'})});assert.equal(login.status,200,JSON.stringify(login));
  assert.equal((await browserCall('/v1/me')).status,200);
  console.log(JSON.stringify({ok:true,realChrome:true,registration:true,httpOnlyCookie:true,balance:200,deviceApproval:true,passwordResetRevokesCookie:true,login:true}));
}finally{try{socket?.close();}catch{}for(const child of processes)child.kill('SIGTERM');webServer?.close();await wait(500);rmSync(temp,{recursive:true,force:true});}
