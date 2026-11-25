import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {worker} from './helpers/payment-v2.mjs';
import {setup,seedPaid} from './helpers/partner-browser-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const temp=mkdtempSync(path.join(tmpdir(),'partners-browser-'));
const dist=path.join(temp,'dist'),cleanups=[];
const {f,db,reauth,enable,tokens}=setup({after:fn=>cleanups.push(fn)});
const chrome=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const nativeFetch=globalThis.fetch;
let server,child,socket,next=0,origin;const pending=new Map();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(100);}throw Error('Browser QA timed out: '+label);}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function ev(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error('Browser evaluation failed');return r.result.result.value;}
const visible="e=>e.getClientRects().length>0";
async function text(s){await until(()=>ev('document.body.innerText.includes('+JSON.stringify(s)+')'),s);}
// Radix tabs activate on pointer down/focus, not synthetic HTMLElement.click().
async function click(s,scope='body'){
 const selector='(()=>{const root=document.querySelector('+JSON.stringify(scope)+');const e=[...root.querySelectorAll("button,[role=tab]")].find(e=>e.textContent.trim()==='+JSON.stringify(s)+'&&('+visible+')(e)&&!e.disabled);if(!e)return false;e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()';
 let point;await until(async()=>{point=await ev(selector);return !!point;},s);
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function fill(label,value,scope='body'){
 const expr='(()=>{const root=document.querySelector('+JSON.stringify(scope)+');if(!root)return false;const l=[...root.querySelectorAll("label")].find(e=>e.textContent.trim().startsWith('+JSON.stringify(label)+'));const e=l?.querySelector("input")||[...root.querySelectorAll("input")].find(e=>e.getAttribute("aria-label")==='+JSON.stringify(label)+');if(!e||e.disabled)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));return true})()';
 await until(()=>ev(expr),label);
}
async function check(label){await until(()=>ev('(()=>{const l=[...document.querySelectorAll("label")].find(e=>e.textContent.includes('+JSON.stringify(label)+'));const e=l?.querySelector("input[type=checkbox]");if(!e||e.disabled)return false;if(!e.checked)e.click();return true})()'),label);}
async function as(id,url){
 await cdp('Network.clearBrowserCookies');await cdp('Network.setCookie',{name:'rc_session',value:tokens[id],url:origin,httpOnly:true,sameSite:'Lax'});
 await cdp('Page.navigate',{url:origin+url});await until(()=>ev('location.href==='+JSON.stringify(origin+url)+'&&document.readyState==="complete"&&[...document.querySelectorAll("astro-island")].every(e=>!e.hasAttribute("ssr"))'),'navigation '+url);
}
try{
 assert.ok(existsSync(chrome));
 server=createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,origin);
   if(u.pathname.startsWith('/v1/')||u.pathname==='/health'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);
    const response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),f.env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   const rel=decodeURIComponent(u.pathname),file=path.resolve(dist,'.'+(rel.endsWith('/')?rel+'index.html':path.extname(rel)?rel:rel+'/index.html'));
   if(!file.startsWith(dist+path.sep)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]||'text/html');res.end(readFileSync(file));
  }catch{res.writeHead(500);res.end('fixture failure');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 // Local-only actual Worker and Astro pages; no remote DB, email, or payment.
 Object.assign(f.env,{ENVIRONMENT:'development',WEB_ORIGIN:origin,API_ORIGIN:origin});
 globalThis.fetch=(url,opts)=>{const u=new URL(typeof url==='string'||url instanceof URL?url:url.url);if(u.hostname!=='127.0.0.1')throw Error('EXTERNAL_NETWORK_FORBIDDEN');return nativeFetch(url,opts);};
 execFileSync(path.join(root,'web/node_modules/.bin/astro'),['build','--outDir',dist],{cwd:path.join(root,'web'),env:{...process.env,PUBLIC_API_BASE_URL:origin,ASTRO_TELEMETRY_DISABLED:'1'},stdio:'pipe'});
 enable();reauth();
 child=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--window-size=1440,1000','--user-data-dir='+path.join(temp,'profile'),'about:blank'],{stdio:'ignore'});
 let port;
 await until(()=>{try{port=Number(readFileSync(path.join(temp,'profile','DevToolsActivePort'),'utf8').split('\n')[0]);return port>0;}catch{return false;}},'Chrome startup');
 const tabs=await (await nativeFetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m);}if(m.method==='Page.javascriptDialogOpening')void cdp('Page.handleJavaScriptDialog',{accept:true});});
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Network.enable');
 await cdp('Network.setBlockedURLs',{urls:['https://*']});
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await as('a','/admin/');await click('推广管理');await text('推广伙伴 · 资格与规则');
 await fill('用户 ID 或邮箱','p');
 // Scope the first search to the policy card's form, not the queue.
 await ev('document.querySelector("input[aria-label=\\\"用户 ID 或邮箱\\\"]").closest("form").requestSubmit()');
 await text('p@example.test');
 await fill('比例（%）','20');await fill('有效期（月）','12');await fill('操作原因','isolated browser review');
 await click('保存新版本');await text('规则已保存，历史版本保留。');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_policy_versions WHERE user_id='p'").get().n,1);
 const {applied}=seedPaid(db);
 db.exec("INSERT INTO partner_discovery_cursors VALUES('recharge',0,'',0),('subscription',0,'',0)");
 await worker.scheduled({},f.env);
 // Exercise the actual browser controls, including approval confirmation.
 const queueScope='[data-slot=card]';
 const queueIndex=await ev('[...document.querySelectorAll('+JSON.stringify(queueScope)+')].findIndex(e=>e.textContent.includes("计佣审核队列（测试）"))');
 assert.ok(queueIndex>=0);
 await ev('document.querySelectorAll('+JSON.stringify(queueScope)+')['+queueIndex+'].querySelector("button").click()');
 await text('discovered');await click('核对');await text('净候选佣金');
 await fill('审核原因','isolated browser review');await check('我已人工核对风险与证据');await click('批准后台模拟入账');
 await until(()=>db.prepare("SELECT COUNT(*) n FROM partner_accrual_approvals").get().n===1,'browser approval');
 await worker.scheduled({},f.env);
 assert.equal(db.prepare("SELECT commission_fen FROM partner_commissions").get().commission_fen,2000);
 if(Date.now()<=applied+1)await delay(2);
 await as('p','/account/');await click('查询推广伙伴资格');await text('推广伙伴 · 收益记录');await text('已授权');
 await click('查看或设置收款信息');await fill('支付宝账号','fixture@example.test');await fill('收款人真实姓名','测试账户');await click('加密保存收款信息');await text('收款信息已保存。');await text('f***@***');
 assert.equal(await ev('[...document.querySelectorAll("input")].some(e=>e.value==="fixture@example.test"||e.value==="测试账户")'),false);
 await click('查询申请记录');await text('最低申请金额');await fill('金额（人民币元）','9.99');
 assert.equal(await ev('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="提交审核申请").disabled'),true);
 await fill('金额（人民币元）','10');await click('提交审核申请');await text('申请已提交，等待人工审核。');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_alipay_requests").get().n,1);
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await text('待审核');
 assert.equal(await ev('document.body.innerText.includes("fixture@example.test")'),false);
 await as('q','/account/');await click('查询推广伙伴资格');await text('目前未开放推广伙伴资格或尚未获得授权。');
 assert.equal(await ev('document.body.innerText.includes("f***@***")'),false);
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await as('a','/admin/');await click('推广管理');await fill('推广伙伴用户 ID','p');
 await ev('document.querySelector("input[aria-label=\\\"推广伙伴用户 ID\\\"]").closest("form").requestSubmit()');
 await text('待审核');await fill('审核原因','isolated browser payout');await check('已人工核对相应订单与转账证据');await click('模拟批准并预留');await text('已预留');
 await fill('审核原因','isolated browser payout');await check('已人工核对相应订单与转账证据');await click('锁定转账并查看账号');await text('fixture@example.test');await click('隐藏');
 assert.equal(await ev('document.body.innerText.includes("fixture@example.test")'),false);
 await fill('审核原因','isolated browser payout');await check('已人工核对相应订单与转账证据');await fill('确认金额','10');await fill('模拟转账流水号','browser-synthetic-transfer');await click('确认模拟付款');await text('已结算');
 assert.equal(db.prepare("SELECT status FROM partner_payouts").get().status,'paid');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log('PARTNER_BROWSER_QA_PASS: actual Astro account/admin pages; real Worker; synthetic authorization, approval, recipient, request, reserve, reveal, outcome and ownership');
}catch(error){
 // Safe diagnostics only: never dump DOM, cookies, or raw financial data.
 if(socket)try{console.error('QA diagnostic',await ev('JSON.stringify({path:location.pathname,tabs:[...document.querySelectorAll("[role=tab][data-state=active]")].map(e=>e.textContent.trim()),cards:[...document.querySelectorAll("[data-slot=card-title]")].map(e=>e.textContent.trim()),islands:[...document.querySelectorAll("astro-island")].map(e=>e.hasAttribute("ssr"))})'));}catch{}
 throw error;
}finally{
 globalThis.fetch=nativeFetch;try{socket?.close();}catch{}for(const p of pending.values())clearTimeout(p.timer);child?.kill('SIGTERM');server?.close();for(const fn of cleanups.reverse())fn();await delay(300);rmSync(temp,{recursive:true,force:true});
}
