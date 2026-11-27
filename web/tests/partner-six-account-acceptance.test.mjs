import {createServer} from 'node:http';import {readFileSync} from 'node:fs';import {randomUUID,createHash,createHmac} from 'node:crypto';import {fixture,worker} from '../../api/tests/helpers/payment-v2.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {spawn,execFileSync}from 'node:child_process';import {mkdtempSync,writeFileSync,rmSync}from 'node:fs';import {tmpdir}from 'node:os';import path from 'node:path';import {pathToFileURL}from 'node:url';import {createRequire}from 'node:module';
const {build}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild'),web=new URL('..',import.meta.url).pathname;
test('six isolated accounts: Chromium and actual bundled Worker partner lifecycle',{timeout:60000},async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-partner-ui-')),pending=new Map();let chrome,buffer='',serial=0,session;
 const call=(method,params={},sid=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out'));},8000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description);return r.result.result.value;};
 const until=async expr=>{for(let i=0;i<240;i++){if(await evaluate(`Boolean(${expr})`))return;await new Promise(r=>setTimeout(r,20));}throw Error('Browser condition failed: '+expr+' '+JSON.stringify({browser:await evaluate('({text:document.body.innerText,forms:[...document.forms].map(f=>({valid:f.checkValidity(),inputs:[...f.querySelectorAll("input")].map(e=>({value:e.value,valid:e.validity.valid,message:e.validationMessage}))}))})'),requests:requests.slice(-12)}));};
 const click=async expr=>{const point=await evaluate(`(()=>{const e=${expr};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});};

 const f=fixture({released:false}),db=f.sql,tokens={},requests=[];let server,identity='owner',origin;
 const noExternal=globalThis.fetch;globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
 for(const name of ['0027_referral_rewards_v1.sql','partners_v1a_policy_proposal.sql','partners_manual_record_proposal.sql'])db.exec(readFileSync(new URL('../../api/sql-proposals/'+name,import.meta.url),'utf8'));
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',PAYMENTS_ENABLED:'0',XIAODOU_WEBHOOKS_ENABLED:'0'});
 for(const [id,role] of [['owner','admin'],['partner-a','user'],['partner-b','user'],['buyer-a','user'],['buyer-b','user'],['ordinary','user']]){
  const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');tokens[id]=token;
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture-hash',?)").run(id,id+'@example.test','fixture-'+id,role);
  db.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'web',1,?)").run('session-'+id,createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
 }
 db.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'owner',1)");
 db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('session-owner',?)").run(Date.now()+3600000);
 async function direct(id,url,body){
  const token=tokens[id],headers={Origin:f.env.WEB_ORIGIN,'Content-Type':'application/json','X-Reply-Copilot-Action':'1',Cookie:'rc_session='+token,'X-CSRF-Token':createHmac('sha256',f.env.AUTH_HASH_SECRET).update('csrf:'+token).digest('hex')};
  const r=await worker.fetch(new Request(f.env.API_ORIGIN+url,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);return {status:r.status,body:await r.json()};
 }
 const me='/v1/partners/manual-report',admin='/v1/admin/partners/manual-report';
 async function report(id){const r=await direct(id,me);assert.equal(r.status,200);return r.body;}
 function paidOrder(orderId,principal){
  const paid=db.prepare("SELECT effective_at FROM partner_policy_versions WHERE user_id='partner-a'").get().effective_at;
  // Same ordinary recharge fixture contract as the repository's existing
  // offline payment regression tests. No live order or callback is created.
  const tx='tx-'+orderId,out='out-'+orderId,trade='trade-'+orderId;
  db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,payment_method,provider_reference,created_at,paid_at,credited_at) VALUES(?,'buyer-a','starter','fixture',500,100,'USD','paid','mk99',?,?,?,?)").run(orderId,out,paid,paid,paid);
  db.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,base_amount_fen,service_fee_fen,fee_rate_bps,fee_snapshot_version,provider_fee_projection_status,status,provider_trade_id,created_at,updated_at,payment_protocol,payment_channel,settlement_mode,exchange_rate_micros,merchant_provider,merchant_account,notification_sign_type,amount_contract,provider_requested_fen,provider_payment_id,paid_at) VALUES(?,?,'xiaodou','CNY',?,?,0,0,'fee-v1','not_applicable','paid',?,?,?,'rsa2','ALIPAY_H5','fixed_cny',1000000,'mk99','fixture','MD5','CNY_EXACT_BUYER_TOTAL',?,?,?)").run(tx,orderId,principal,principal,out,paid,paid,principal,trade,paid);
  db.prepare("INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at,merchant_provider) VALUES(?,'xiaodou',?,?,'PAYMENT_SUCCEEDED',?,'CNY',?,?,'mk99')").run('event-'+orderId,'fixture-paid-'+orderId,tx,principal,'a'.repeat(64),paid);
  db.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES(?,'buyer-a','purchase_grant',0,500,?,'offline fixture',?)").run('ledger-'+orderId,orderId,paid);
  db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,source_order_id,grant_credits,remaining_credits,granted_at,paid_at,history_confidence,status) VALUES(?,'buyer-a','paid','purchase',?,500,500,?,?,'tracked','active')").run('batch-'+orderId,orderId,paid,paid);
  db.exec("UPDATE credit_accounts SET paid_balance=paid_balance+500 WHERE user_id='buyer-a'");
 }

 function subscription(){
  const paid=db.prepare("SELECT effective_at FROM partner_policy_versions WHERE user_id='partner-b'").get().effective_at;
  db.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES('sub-order','buyer-b','basic-v1','purchase',6990,'paid',?,?,?,?,?,?)").run(paid-1,paid+1000,paid,paid,paid,paid);
  db.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,provider_payment_id,payment_channel,amount_fen,notification_sign_type,status,created_at,updated_at,paid_at) VALUES('sub-tx','sub-order','mk99','fixture','sub-trade','sub-payment','ALIPAY_H5',6990,'MD5','paid',?,?,?)").run(paid,paid,paid);
  db.prepare("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at) VALUES('sub-event','sub-tx','mk99','sub-success','PAYMENT_SUCCEEDED',6990,?,?)").run('b'.repeat(64),paid);
  db.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('sub-period','buyer-b','sub-order','basic-v1',500,'active',?,?,?,?)").run(paid,paid+2592000000,paid,paid);
 }
 try{
 assert.deepEqual(await report('partner-a'),{enabled:false});
 db.exec("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled')");
 // HTTP transport runs only on a disposable loopback server. No mocked API
 // response: original browser api(), actual bundled Worker and SQLite.
 const {readdirSync}=await import('node:fs');const css=readdirSync(path.join(web,'dist/_astro')).find(x=>x.endsWith('.css'));
 const app=path.join(dir,'app.js');const html='<html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>';
 server=createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,origin);
   if(u.pathname==='/'){res.writeHead(200,{'content-type':'text/html','content-security-policy':"default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"});return res.end(html);}
   if(u.pathname==='/app.js'||u.pathname==='/style.css'){res.writeHead(200,{'content-type':u.pathname==='/app.js'?'application/javascript':'text/css'});return res.end(readFileSync(u.pathname==='/app.js'?app:path.join(web,'dist/_astro',css)));}
   if(!['/v1/auth/csrf','/v1/partners/me',me,admin,'/v1/admin/partners/policy'].includes(u.pathname)){res.writeHead(404);return res.end();}
   const who=identity,token=tokens[who],chunks=[];for await(const c of req)chunks.push(c);
   const body=Buffer.concat(chunks),headers={Origin:f.env.WEB_ORIGIN,'Content-Type':'application/json',Cookie:'rc_session='+token};
   for(const key of ['x-csrf-token','x-reply-copilot-action'])if(req.headers[key])headers[key]=req.headers[key];
   const r=await worker.fetch(new Request(f.env.API_ORIGIN+u.pathname+u.search,{method:req.method,headers,...(req.method==='POST'?{body}: {})}),f.env);
   const response=await r.text();requests.push({who,path:u.pathname,method:req.method,status:r.status,...(r.status>=400?{error:JSON.parse(response).code||'unknown'}:{})});
   res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'});res.end(response);
  }catch(e){requests.push({path:req.url,method:req.method,status:500,error:String(e)});res.writeHead(500);res.end(JSON.stringify({message:String(e)}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';
 import Membership from './src/components/account/PartnerMembershipCard';import Admin from './src/components/admin/PartnerAdminPanel';import {api} from './src/lib/api';
 const root=createRoot(document.getElementById('root'));
 window.showMember=(owner,language='zh')=>root.render(<Membership key={owner} owner={owner} language={language}/>);
 window.showAdmin=()=>root.render(<Admin key="admin" language="zh" write={(p,b)=>api(p,{method:'POST',body:JSON.stringify({...b,operationId:crypto.randomUUID()})})}/>);
 window.showAdmin();`,resolveDir:web,loader:'tsx'},bundle:true,platform:'browser',format:'iife',define:{'import.meta.env.PUBLIC_API_BASE_URL':JSON.stringify(origin),'import.meta.env.DEV':'false'},outfile:app});
 chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-pipe',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});chrome.stdio[4].on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\0'))>=0){const r=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);const p=pending.get(r.id);if(p){pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r);}}});
 const target=(await call('Target.createTarget',{url:'about:blank'},null)).result.targetId;session=(await call('Target.attachToTarget',{targetId:target,flatten:true},null)).result.sessionId;await call('Page.enable');await call('Page.navigate',{url:origin+'/'});

 const button=t=>`[...document.querySelectorAll("button")].find(b=>b.textContent.trim().startsWith(${JSON.stringify(t)}))`;
 const has=t=>'document.body.textContent.includes('+JSON.stringify(t)+')';
 const ready=t=>`Boolean((${button(t)})&&! (${button(t)}).disabled)`;
 const press=async t=>{await until(ready(t));await evaluate('('+button(t)+').click()');};
 const type=async(expr,value)=>{await until(expr);await evaluate('(()=>{const e='+expr+';e.focus();e.select();})()');await call('Input.insertText',{text:value});await until('('+expr+').value==='+JSON.stringify(value));};
 const member=async(id,lang='zh')=>{identity=id;await evaluate('showMember('+JSON.stringify(id)+','+JSON.stringify(lang)+')');};
 const asAdmin=async()=>{identity='owner';await evaluate('showAdmin()');};
 const authorize=async(id)=>{
  const field='document.querySelector("[aria-label=用户\\\\ ID\\\\ 或邮箱]")';
  // Use accessible-label equality without CSS escaping.
  const q='[...document.querySelectorAll("input")].find(e=>e.getAttribute("aria-label")==="用户 ID 或邮箱")';
  await until(q);await evaluate(q+'.focus()');await call('Input.dispatchKeyEvent',{type:'keyDown',modifiers:2,key:'a',code:'KeyA',windowsVirtualKeyCode:65});await call('Input.dispatchKeyEvent',{type:'keyUp',modifiers:2,key:'a',code:'KeyA',windowsVirtualKeyCode:65});
  await type(q,id);await press('查询');await until(has(id+'@example.test'));
  for(const [label,value] of [['约定佣金比例','20'],['约定合作期限','unlimited'],['操作原因','offline synthetic policy']]){
   const e=`[...document.querySelectorAll("label")].find(x=>x.textContent.startsWith(${JSON.stringify(label)}))?.querySelector("input")`;
   await type(e,value);
  }
  assert.equal(await evaluate('('+button('授权推广伙伴')+').form.checkValidity()'),true);await press('授权推广伙伴');await until(has('规则已保存，历史版本保留。'));
 };
 await until(has('资格与规则'));await authorize('partner-a');await authorize('partner-b');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_policy_versions').get().n,2);
 for(const [buyer,partner,code] of [['buyer-a','partner-a','0123456789abcdef'],['buyer-b','partner-b','fedcba9876543210']]){
  const paid=db.prepare("SELECT effective_at FROM partner_policy_versions WHERE user_id=?").get(partner).effective_at;
  db.prepare("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,registered_at) VALUES(?,?,?,?)").run(buyer,partner,code,paid);
 }
 db.exec("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('buyer-a',0,0,1,1)");
 paidOrder('under',4995);subscription();
 await member('partner-a');await until(has('推广伙伴'));await press('查看分成');await until(has('under'));assert.equal(await evaluate(ready('申请结算')),false);assert.equal((await report('partner-a')).summary.estimatedFen,999);
 paidOrder('boundary',5);await press('刷新');await until(ready('申请结算'));assert.equal((await report('partner-a')).requestableFen,1000);
 await evaluate('('+button('申请结算')+').click();('+button('申请结算')+').click()');await until(has('申请处理中'));assert.equal(requests.filter(x=>x.who==='partner-a'&&x.path===me&&x.method==='POST').length,1);
 await asAdmin();await press('查看申请');await until(has('partner-a@example.test'));await press('处理');
 const note='document.querySelector("[aria-label=处理备注]")';await type(note,'synthetic settlement completed');assert.equal(await evaluate(ready('标记已结算')),false);
 await evaluate('document.querySelector("input[type=checkbox]").click()');await press('标记已结算');await until(has('暂无待处理申请'));
 assert.equal((await report('partner-a')).summary.recordedFen,1000);assert.equal((await report('partner-a')).requestableFen,null);
 await member('partner-b');await until(has('推广伙伴'));await press('查看分成');await until(has('sub-order'));assert.equal((await report('partner-b')).requestableFen,1398);assert.equal(await evaluate(has('under')),false);await press('申请结算');await until(has('申请处理中'));
 await asAdmin();await press('查看申请');await until(has('partner-b@example.test'));await press('处理');await type(note,'synthetic rejection reason');await press('拒绝');await until(has('暂无待处理申请'));
 await member('partner-b','en');await until(has('Partner membership'));await press('View commission');await until(has('Rejected'));assert.equal(await evaluate(ready('Request settlement')),true);assert.equal((await report('partner-b')).requestableFen,1398);
 await call('Emulation.setDeviceMetricsOverride',{width:375,height:850,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 for(const id of ['buyer-a','buyer-b','ordinary']){
  const n=requests.length;await member(id);for(let i=0;i<100&&!requests.slice(n).some(x=>x.who===id&&x.path==='/v1/partners/me');i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(requests.slice(n).some(x=>x.who===id&&x.path==='/v1/partners/me'&&x.status===200));assert.deepEqual(await report(id),{enabled:false});assert.equal(await evaluate('Boolean(document.querySelector("[data-testid=partner-membership]"))'),false);assert.equal((await direct(id,admin)).status,403);
 }
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_manual_requests WHERE status='completed'").get().n,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_manual_requests WHERE status='rejected'").get().n,1);
 assert.equal(requests.filter(x=>x.status>=400).length,0);
 console.log('SIX_IDENTITY_ACCEPTANCE_OK: actual Worker, Chromium, local SQLite, recharge + subscription, no external network or funds');
 }finally{
  if(chrome&&chrome.exitCode===null){const closed=new Promise(r=>chrome.once('exit',r));void call('Browser.close',{},null).catch(()=>{});const killer=setTimeout(()=>chrome.kill(),1500);await closed;clearTimeout(killer);}
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  for(const p of pending.values())clearTimeout(p.timer);globalThis.fetch=noExternal;db.close();rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});
 }
});
