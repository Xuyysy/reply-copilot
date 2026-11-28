import test from 'node:test';import assert from 'node:assert/strict';import {spawn,execFileSync}from 'node:child_process';import {mkdtempSync,writeFileSync,rmSync}from 'node:fs';import {tmpdir}from 'node:os';import path from 'node:path';import {pathToFileURL}from 'node:url';import {createRequire}from 'node:module';
const {build}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild'),web=new URL('..',import.meta.url).pathname;
test('partner UI: eligibility, settlement request and administrator queue',{timeout:30000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-partner-ui-')),pending=new Map();let chrome,buffer='',serial=0,session;
 const call=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out'));},8000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description);return r.result.result.value;};
 const until=async expr=>{for(let i=0;i<240;i++){if(await evaluate(`Boolean(${expr})`))return;await new Promise(r=>setTimeout(r,20));}throw Error('Browser condition failed: '+expr+' '+JSON.stringify(await evaluate('({notice:document.querySelector("[data-payment-notice]")?.textContent,reads:window.__reads,id:window.__id,status:window.__status})')));};
 const click=async expr=>{const point=await evaluate(`(()=>{const e=${expr};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});};
 try{
 await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';
 import Membership from './src/components/account/PartnerMembershipCard';
 import ReferralAndPartner from './src/components/account/ReferralAndPartnerCards';
 import Admin from './src/components/admin/PartnerAdminPanel';
 import {api} from './src/lib/api';
 const root=createRoot(document.getElementById('root'));
 const policy={version:1,status:'active',level:'standard',rate_bps:2000,term_months:null,effective_at:1700000000000,reason:'synthetic policy'};
 window.fixture={owner:'partner',enabled:true,earned:999,settled:0,pending:null,records:[],posts:[],hold:false};
 const f=window.fixture,member='/v1/partners/manual-report',admin='/v1/admin/partners/manual-report',policyPath='/v1/admin/partners/policy';
 const report=()=>({enabled:true,summary:{verifiedOrders:1,reviewCount:0,estimatedFen:f.earned,recordedFen:f.settled,differenceFen:f.earned-f.settled,complete:true},minRequestFen:1000,requestableFen:!f.pending&&f.earned-f.settled>=1000?f.earned-f.settled:null,pendingId:f.pending?.id??null,orders:[],records:f.records});
 window.fetch=async(url,init={})=>{
  const u=new URL(url);if(u.origin!=='https://account.fixture.invalid')throw Error('External forbidden');
  if(u.pathname==='/v1/auth/csrf')return Response.json({csrfToken:'fixture-csrf'});
  if(u.pathname==='/v1/partners/me')return Response.json({enabled:f.enabled,policy:f.owner==='partner'?policy:null});
  if(u.pathname==='/v1/referrals/me')return Response.json({enabled:true,canInvite:true,link:f.link??null});
  if(init.method==='POST'){
   if(init.headers['X-CSRF-Token']!=='fixture-csrf')throw Error('Missing CSRF');
   const b=JSON.parse(init.body);f.posts.push({path:u.pathname,body:b});
   if(u.pathname===member){
    if(f.hold)await new Promise(resolve=>window.releaseRequest=resolve);
    if(b.expectedAmountFen!==report().requestableFen||f.pending)return Response.json({code:'PARTNER_REQUEST_CONFLICT',message:'conflict'},{status:409});
    f.pending={id:'request-'+f.posts.length,partner_user_id:'partner',email:'partner@example.test',amount_fen:b.expectedAmountFen,created_at:1700000000000,status:'pending',resolved_at:null};
    f.records.unshift(f.pending);return Response.json({ok:true});
   }
   if(u.pathname===admin){
    if(!f.pending||b.requestId!==f.pending.id||!b.operationId||b.reason.length<8)throw Error('Invalid admin request');
    f.pending.status=b.action;if(b.action==='completed')f.settled+=f.pending.amount_fen;f.pending=null;return Response.json({ok:true});
   }
  }
  if(u.pathname===member)return Response.json(f.enabled?report():{enabled:false});
  if(u.pathname===admin)return Response.json(u.searchParams.has('userId')?report():{enabled:true,queue:f.pending?[f.pending]:[]});
  if(u.pathname===policyPath)return Response.json({enabled:true,user:{id:'partner',email:'partner@example.test',eligible:true},history:[policy]});
  throw Error('Unexpected API '+u.pathname);
 };
 window.showMember=(owner='partner',language='zh')=>{f.owner=owner;root.render(<Membership key={owner} owner={owner} language={language}/>);};
 window.showReferral=(owner,link,enabled=true)=>{f.owner=owner;f.link=link;f.enabled=enabled;root.render(<ReferralAndPartner key={owner+':'+link+':'+enabled} owner={owner} language="zh"/>);};
 window.showAdmin=()=>root.render(<Admin language="zh" write={(p,b)=>api(p,{method:'POST',body:JSON.stringify({...b,operationId:'fixture-operation'})})}/>);
 window.showMember();`,resolveDir:web,loader:'tsx'},bundle:true,platform:'browser',format:'iife',define:{'import.meta.env.PUBLIC_API_BASE_URL':'"https://account.fixture.invalid"','import.meta.env.DEV':'false'},outfile:path.join(dir,'app.js')});
 const {readdirSync}=await import('node:fs');const css=readdirSync(path.join(web,'dist/_astro')).find(x=>x.endsWith('.css'));
 writeFileSync(path.join(dir,'index.html'),`<html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${pathToFileURL(path.join(web,'dist/_astro',css)).href}"><div id="root"></div><script src="app.js"></script></html>`);
 chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-pipe',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});chrome.stdio[4].on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\0'))>=0){const r=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);const p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r);}}});
 const target=(await call('Target.createTarget',{url:'about:blank'},null)).result.targetId;session=(await call('Target.attachToTarget',{targetId:target,flatten:true},null)).result.sessionId;await call('Page.enable');await call('Page.navigate',{url:pathToFileURL(path.join(dir,'index.html')).href});
 const button=t=>`[...document.querySelectorAll("button")].find(b=>b.textContent.trim().startsWith(${JSON.stringify(t)}))`;
 const press=async t=>{await until(button(t));await evaluate('('+button(t)+').click()');};
 const has=t=>'document.body.textContent.includes('+JSON.stringify(t)+')';
 const disabled=t=>'Boolean(('+button(t)+')?.disabled)';
 await until(has('推广伙伴'));await press('查看分成');await until(has('累计核实分成'));assert.equal(await evaluate(disabled('申请结算')),true);
 assert.deepEqual(await evaluate('fixture.posts'),[]);
 await evaluate('fixture.earned=1000');await press('刷新');await until('!'+disabled('申请结算'));await evaluate('fixture.hold=true');
 await evaluate('('+button('申请结算')+').click();('+button('申请结算')+').click()');
 await until('Boolean(window.releaseRequest)');assert.equal(await evaluate('fixture.posts.length'),1);assert.deepEqual(await evaluate('fixture.posts[0].body'),{expectedAmountFen:1000});await evaluate('fixture.hold=false;releaseRequest()');
 await until(has('申请处理中'));assert.equal(await evaluate(disabled('申请处理中')),true);
 await evaluate('showAdmin()');await press('查看申请');await until(has('partner@example.test'));await press('处理');
 assert.equal(await evaluate(disabled('标记已结算')),true);assert.equal(await evaluate(disabled('拒绝')),true);
 const note='document.querySelector("[aria-label=处理备注]")';await until(note);await evaluate(note+'.focus()');await call('Input.insertText',{text:'synthetic transfer verification'});
 await until('!'+disabled('拒绝'));assert.equal(await evaluate(disabled('标记已结算')),true);
 await evaluate('document.querySelector("input[type=checkbox]").click()');await until('!'+disabled('标记已结算'));await press('标记已结算');await until(has('暂无待处理申请'));
 assert.equal(await evaluate('fixture.settled'),1000);assert.equal(await evaluate('fixture.posts[1].body.action'),'completed');
 await evaluate('showMember()');await press('查看分成');await until(has('已结算'));assert.equal(await evaluate(disabled('申请结算')),true);
 await evaluate('fixture.earned=2000');await press('刷新');await until('!'+disabled('申请结算'));await press('申请结算');await until(has('申请处理中'));
 await evaluate('showAdmin()');await press('查看申请');await press('处理');await until(note);await evaluate(note+'.focus()');await call('Input.insertText',{text:'synthetic rejection reason'});await until('!'+disabled('拒绝'));await press('拒绝');await until(has('暂无待处理申请'));assert.equal(await evaluate('fixture.posts.at(-1).body.action'),'rejected');
 await evaluate('showMember()');await press('查看分成');await until(has('已拒绝'));assert.equal(await evaluate(disabled('申请结算')),false);
 await call('Emulation.setDeviceMetricsOverride',{width:375,height:850,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await evaluate('showMember("ordinary")');await until('!document.querySelector("[data-testid=partner-membership]")');assert.equal(await evaluate('fixture.posts.length'),4);
 await evaluate('showReferral("ordinary","https://account.fixture.invalid/login/?mode=register&ref=0123456789abcdef")');await until(has('想让流量变现'));assert.equal(await evaluate('Boolean(document.querySelector("[aria-label=我的邀请链接]"))'),true);assert.equal(await evaluate(has('审核开通后，继续使用已有邀请链接')),true);assert.equal(await evaluate('Boolean('+button('生成我的邀请链接')+')'),false);
 await evaluate('showReferral("ordinary",null)');await until(has('想让流量变现'));assert.equal(await evaluate('Boolean('+button('生成我的邀请链接')+')'),true);
 await evaluate('showReferral("partner","https://account.fixture.invalid/login/?mode=register&ref=0123456789abcdef")');await until(has('推广伙伴'));assert.equal(await evaluate(has('想让流量变现')),false);
 await evaluate('showReferral("ordinary","https://account.fixture.invalid/login/?mode=register&ref=0123456789abcdef",false)');await until('Boolean(document.querySelector("[aria-label=我的邀请链接]"))');assert.equal(await evaluate(has('想让流量变现')),false);assert.equal(await evaluate('fixture.posts.length'),4);
 }finally{if(chrome&&chrome.exitCode===null){const closed=new Promise(r=>chrome.once('exit',r));void call('Browser.close',{},null).catch(()=>{});const killer=setTimeout(()=>chrome.kill(),1500);await closed;clearTimeout(killer);}for(const p of pending.values())clearTimeout(p.timer);rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
