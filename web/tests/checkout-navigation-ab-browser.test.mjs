import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {transformSync}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const root=new URL('../..',import.meta.url);
function handler(source){const a=source.indexOf('    byId("cashier-link").addEventListener("click",');return source.slice(a,source.indexOf('    byId("epay-submit").addEventListener',a));}
test('real browser compares old, regressed and restored native cashier navigation using exact checkout handlers',{timeout:40000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-native-cashier-ab-'));let chrome,session,mainTarget,buffer='',serial=0,error;const pending=new Map(),observations=[],queries=[],popups=new Map(),popupOpener=new Map();
 const call=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},7000);pending.set(id,{resolve,reject,timer,method,sid});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.text);return r.result.result.value;};
 const wait=async fn=>{for(let n=0;n<300;n++){if(error)throw error;if(await fn())return;await new Promise(r=>setTimeout(r,15));}throw Error('condition timeout '+JSON.stringify({observations,queries,popups:[...popups.keys()]}));};
 const sourceUrl='https://website.fixture.invalid/checkout/';const cashier='https://cashier.fixture.invalid/process/next?trade_no=synthetic-only';
 const revisions=[execFileSync('git',['show','79e79845b470c0d0915875f18979b87b9a6c5d5c:web/src/pages/checkout.astro'],{cwd:root,encoding:'utf8'}),execFileSync('git',['show','f7ee65ecbeea1234fe22c9767ce984881fd895b6:web/src/pages/checkout.astro'],{cwd:root,encoding:'utf8'}),readFileSync(new URL('../src/pages/checkout.astro',import.meta.url),'utf8')];
 const pages=revisions.map(s=>{
 const setup=`let order={id:'synthetic',paymentProtocol:'mk99',status:'pending',paymentUrl:${JSON.stringify(cashier)}};let busy=false,confirmedMk99OrderId=order.id;const byId=id=>document.getElementById(id),api=()=>{},safeMk99Cashier=o=>o.paymentUrl,show=()=>{},setStatus=()=>{},rememberPayment=()=>{},mergeCheckoutRead=(_,n)=>n;function showOrder(n){order=n;byId('cashier-link').href=n.paymentUrl;}async function loadOrderCheckout(){console.log('SYNTHETIC_QUERY_GET_POST_GET');return {verified:true,order:{...order}};}`;
 const js=transformSync(setup+handler(s),{loader:'ts',format:'iife'}).code;
 return `<!doctype html><link rel="icon" href="data:,"><a id="cashier-link" href="${cashier}" target="_blank" rel="noopener noreferrer">Open</a><script>${js}</script>`;
 });
 const serve=async e=>{
 const req=e.params.request;
 if(req.url.startsWith(sourceUrl)){const mode=Number(new URL(req.url).searchParams.get('variant'));await call('Fetch.fulfillRequest',{requestId:e.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'},{name:'Referrer-Policy',value:'strict-origin-when-cross-origin'}],body:Buffer.from(pages[mode]).toString('base64')},e.sessionId);return;}
 assert.equal(req.url,cashier,'no real merchant request permitted');
 await call('Fetch.fulfillRequest',{requestId:e.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<!doctype html><link rel="icon" href="data:,">Synthetic cashier').toString('base64')},e.sessionId);
 observations.push({url:req.url,referer:Object.entries(req.headers).find(([k])=>k.toLowerCase()==='referer')?.[1]||null,newTab:e.sessionId!==session,openerNull:e.sessionId===session?true:popupOpener.get(e.sessionId)});
 };
 try{
 chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-pipe',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
 chrome.stdio[4].on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\0'))>=0){const e=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);if(process.env.AB_DEBUG&&['Target.attachedToTarget','Page.windowOpen','Fetch.requestPaused'].includes(e.method))console.log(e.method,e.params.targetInfo||e.params.url||e.params.request?.url);if(e.method==='Target.attachedToTarget'){const sid=e.params.sessionId;if(e.params.targetInfo.targetId===mainTarget){void call('Runtime.runIfWaitingForDebugger',{},sid).catch(x=>error=x);continue;}popups.set(sid,e.params.targetInfo.targetId);popupOpener.set(sid,e.params.targetInfo.canAccessOpener===false);void(async()=>{await call('Fetch.enable',{patterns:[{urlPattern:'https://cashier.fixture.invalid/*'}]},sid);await call('Runtime.runIfWaitingForDebugger',{},sid);await call('Runtime.enable',{},sid);})().catch(x=>error=x);continue;}if(e.method==='Fetch.requestPaused'){void serve(e).catch(x=>error=x);continue;}if(e.method==='Runtime.consoleAPICalled'&&e.params.args?.some(a=>a.value==='SYNTHETIC_QUERY_GET_POST_GET'))queries.push('GET,POST query,GET');const p=pending.get(e.id);if(p){pending.delete(e.id);clearTimeout(p.timer);e.error?p.reject(Error(p.method+' ('+(p.sid?'target session':'browser session')+'): '+e.error.message)):p.resolve(e);}}});
 const target=(await call('Target.createTarget',{url:'about:blank'},null)).result.targetId;mainTarget=target;session=(await call('Target.attachToTarget',{targetId:target,flatten:true},null)).result.sessionId;
 await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'https://website.fixture.invalid/*'},{urlPattern:'https://cashier.fixture.invalid/*'}]});await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter:[{type:'page',exclude:false},{exclude:true}]},null);
 // A same-tab cross-origin navigation can replace Chrome's renderer/CDP
 // session. Exercise that regression LAST so a detached session is never
 // reused for a later fixture navigation; still assert every variant.
 // Keep synthetic popups alive until browser teardown: closing them right
 // after Fetch.fulfillRequest races queued Fetch/Runtime CDP events.
 for(const [caseIndex,n] of [0,2,1].entries()){
 const before=queries.length;await call('Page.navigate',{url:sourceUrl+'?variant='+n});await wait(()=>evaluate('Boolean(document.getElementById("cashier-link"))'));
 const pos=await evaluate('(()=>{const r=document.getElementById("cashier-link").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await call('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...pos,button:'left',clickCount:1});await wait(()=>observations.length===caseIndex+1);
 const result=observations[caseIndex];assert.equal(result.newTab,n!==1);assert.equal(result.referer,n===1?'https://website.fixture.invalid/':null);assert.equal(queries.length-before,n===1?1:0);assert.equal(result.openerNull,true);assert.equal(result.url,cashier);
 }
 assert.equal(observations.length,3,'All three browser A/B variants must be observed');
 if(error)throw error;
 console.log('Mock browser A/B: old/restored = new tab, no Referer, no click-time query; regressed = same tab, source Referer, GET/query/GET. No MK99 request sent.');
 }finally{if(chrome&&chrome.exitCode===null){const done=new Promise(r=>chrome.once('exit',r));void call('Browser.close',{},null).catch(()=>{});const timer=setTimeout(()=>chrome.kill(),1500);await done;clearTimeout(timer);}for(const p of pending.values())clearTimeout(p.timer);rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
