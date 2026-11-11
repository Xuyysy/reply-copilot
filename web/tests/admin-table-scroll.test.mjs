import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const {buildSync}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const webRoot=new URL('..',import.meta.url).pathname;

test('real admin tables scroll independently with sticky headers; controls, dialogs, selection and exports remain usable', {timeout:60000}, async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-admin-scroll-')),pending=new Map();let chrome,buffer='',seq=0;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Chrome timeout '+method));},10000);pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});
 let session;
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);if(r.result.exceptionDetails)throw new Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result.result.value;};
 const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await wait(25);}throw new Error('UI did not settle: '+expression+'; '+JSON.stringify(await evaluate(`({trace:window.__clickTrace,checkboxes:[...document.querySelectorAll('input[type=checkbox]')].slice(0,3).map(e=>({checked:e.checked,rect:e.getBoundingClientRect().toJSON()}))})`)));};
 const click=async expression=>{
  await until(`(()=>{const el=${expression};if(!el)return false;el.scrollIntoView({behavior:'instant',block:'center',inline:'center'});const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>0&&r.height>0&&(hit===el||el.contains(hit));})()`);
  const point=await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1},session);
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1},session);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 };
 const tab=async value=>{await click(`document.querySelector('[role="tab"][id$="-trigger-${value}"]')`);await until(`!!document.querySelector('[role="tabpanel"][data-state="active"] table')`);};
 const panel='document.querySelector(\'[role="tabpanel"][data-state="active"]\')';
 try{
  const css=readdirSync(path.join(webRoot,'dist/_astro')).filter(p=>p.endsWith('.css')).map(p=>readFileSync(path.join(webRoot,'dist/_astro',p),'utf8')).join('\n');
  buildSync({stdin:{contents:`
    import React from 'react';import {flushSync} from 'react-dom';import {createRoot} from 'react-dom/client';import Dashboard from './src/components/admin/AdminDashboard';
    let serial=0;const root=createRoot(document.getElementById('root'));window.__calls=[];window.__downloads=[];window.__states={};
    const users=()=>Array.from({length:window.__rows},(_,i)=>({id:'u'+i,email:'person'+i+'@example.test',username:'Person '+i,status:window.__states['u'+i]||'active',free_balance:200,paid_balance:400,generations:i,created_at:1793318400000}));
    const orders=()=>users().map((u,i)=>({id:'o'+i,email:u.email,package_name:'400 credits',credits:400,amount_cents:149,amount_fen:1043,payment_currency:'CNY',provider:'mk99',status:'paid',credited_at:1793318400000,created_at:1793318400000}));
    window.fetch=async(url,init={})=>{const u=new URL(String(url));if(u.hostname!=='api.layout.invalid')throw new Error('External request forbidden');const p=u.pathname,body=init.body?JSON.parse(init.body):{};window.__calls.push({path:p,search:u.search,method:init.method||'GET',body});let data={};
      if(p==='/v1/admin/dashboard')data={users:window.__rows,aiService:{enabled:true,provider:'Qwen',model:'qwen3.7-flash',keyConfigured:true}};
      else if(p==='/v1/admin/users')data={users:users()};
      else if(p==='/v1/admin/orders')data={orders:orders()};
      else if(p==='/v1/admin/usage-ledger')data={items:users().map((u,i)=>({request_id:'req-'+i,user_id:u.id,email:u.email,created_at:1793318400000,source:i%2?'subscription':'free',source_evidence:'credit_allocation',period_plan:'pro',model:'model-1',input_tokens:10,output_tokens:8,estimated_cost_micro_usd:4})),nextCursor:null,hasMore:false};
      else if(p==='/v1/admin/ops-insights')data={time:{from:1793000000000,to:1793318400000,timezone:'UTC',generatedAt:1793318400000},alerts:[],aiUsage:{rowsSampled:0,moreThanSample:false,limit:1000,subscription:0,free:0,paid:0,unattributed:0,plans:[]},aiBudget:{dayUtc:'2026-11-11',limitMicroUsd:1000000,committedMicroUsd:0,percent:0},aiFailures24h:0};
      else if(p==='/v1/admin/commerce/summary')data={verifiedCredit:{orders:0,buyers:0,gross_fen:0},verifiedSubscription:[],verifiedGrossFen:0,creditConfirmedRefunds:{refunds:0,amount_fen:0},currency:'CNY'};
      else if(p==='/v1/admin/commerce/orders')data={items:users().map((u,i)=>({id:'combined-'+i,user_id:u.id,email:u.email,created_at:1793318400000,paid_at:1793318400000,product_type:i%2?'subscription':'credit',product_name:'Business',order_kind:'purchase',order_status:'paid',payment_status:'paid',merchant_provider:'mk99',amount_fen:6990,currency:'CNY',credits:i%2?null:400,entitlement_status:'applied',payment_evidence:'verified_event'})),hasMore:false,nextCursor:null};
      else if(p.startsWith('/v1/admin/commerce/users/'))data={user:{id:p.split('/')[5],email:'person@example.test'},creditBalances:{free_balance:200,paid_balance:400},subscriptionPeriods:[],subscriptionOrders:[],asOf:1793318400000};
      else if(p==='/v1/admin/ledger')data={ledger:users().map((u,i)=>({id:'l'+i,email:u.email,kind:'generation_debit',free_delta:-1,paid_delta:0,reason:'Generation debit / 正常生成',created_at:1793318400000}))};
      else if(p==='/v1/admin/packages')data={packages:[{id:'starter',name_zh:'入门包',name_en:'Starter',credits:400,price_cents:149,price_cny_fen:990,active:1}]};
      else if(p==='/v1/admin/settings')data={settings:[]};else if(p==='/v1/admin/audits')data={audits:[]};else if(p==='/v1/admin/content')data={content:{}};
      else if(p==='/v1/auth/csrf')data={csrfToken:'mock-only'};
      else if(p==='/v1/admin/export')return new Response('id,email\\nu0,person0@example.test',{headers:{'content-type':'text/csv'}});
      else if(p==='/v1/admin/users/bulk-status'){for(const id of body.userIds)window.__states[id]=body.status;data={ok:true};}
      else if(/^\\/v1\\/admin\\/users\\/u\\d+\\/status$/.test(p)){window.__states[p.split('/')[4]]=body.status;data={ok:true};}
      else if(/^\\/v1\\/admin\\/users\\/u\\d+$/.test(p)){const original=users().find(u=>u.id===p.split('/')[4]),user={...original,email:window.__longEmail?'long-email-local-part-'.repeat(12)+'@example.test':original.email},n=Array.from({length:window.__detailRows??40},(_,i)=>i);data={user,quota:{freeRemaining:200,paidRemaining:400,totalRemaining:600},orders:n.slice(0,18).map(i=>({id:'order-'+i,package_name:'Starter / 标准包',credits:400,status:'paid',created_at:1793318400000})),ledger:n.map(i=>({id:'ledger-'+i,kind:'generation_debit',free_delta:0,paid_delta:-1,reason:'A recorded AI generation / 额度已经扣除',created_at:1793318400000})),usage:n.map(i=>({id:'usage-'+i,status:'succeeded',created_at:1793318400000}))};}
      else if(/^\\/v1\\/admin\\/users\\/u\\d+\\/(test-account|archive|note)$/.test(p))data={ok:true};
      else if(/^\\/v1\\/admin\\/orders\\/o\\d+$/.test(p))data={order:orders().find(o=>o.id===p.split('/')[4]),events:[],attempts:[],refunds:[]};
      else throw new Error('Unexpected mock route '+p);
      return Response.json(data);
    };
    const nativeClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__downloads.push(this.download);return;}nativeClick.call(this);};
    window.__mount=(n,language)=>{window.__rows=n;window.__calls=[];window.__states={};document.documentElement.lang=language;flushSync(()=>root.render(React.createElement(Dashboard,{key:++serial})));};
  `,resolveDir:webRoot,loader:'tsx'},bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':JSON.stringify({PUBLIC_API_BASE_URL:'https://api.layout.invalid',DEV:false})},tsconfig:path.join(webRoot,'tsconfig.json'),outfile:path.join(dir,'app.js')});
  writeFileSync(path.join(dir,'test.html'),`<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main style="max-width:1160px;margin:auto;padding:20px"><div id="root"></div></main><script src="app.js"></script></body></html>`);
  chrome=spawn(process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-pipe',`--user-data-dir=${path.join(dir,'profile')}`,'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  chrome.stdio[4].on('data',chunk=>{buffer+=chunk.toString();let index;while((index=buffer.indexOf('\0'))>=0){const s=buffer.slice(0,index);buffer=buffer.slice(index+1);const r=JSON.parse(s);const item=pending.get(r.id);if(item){pending.delete(r.id);clearTimeout(item.timer);r.error?item.reject(new Error(r.error.message)):item.resolve(r);}}});
  const target=(await call('Target.createTarget',{url:'about:blank'})).result.targetId;session=(await call('Target.attachToTarget',{targetId:target,flatten:true})).result.sessionId;
  await call('Page.enable',{},session);await call('Runtime.enable',{},session);await call('Page.navigate',{url:pathToFileURL(path.join(dir,'test.html')).href},session);await until('typeof window.__mount === "function"');
  await evaluate(`window.__clickTrace=[];for(const type of ['click','change'])document.addEventListener(type,e=>{window.__clickTrace.push({type,tag:e.target.tagName,inputType:e.target.type,checked:e.target.checked,x:e.clientX,y:e.clientY});window.__clickTrace=window.__clickTrace.slice(-8)},true)`);
  let scenarios=0;
  for(const [width,height] of [[1440,1000],[375,700]])for(const language of ['zh','en'])for(const count of [0,1,5,100]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
    await evaluate(`window.__mount(${count},${JSON.stringify(language)})`);await until('!!document.querySelector(\'[role="tablist"]\')');
    for(const value of ['users','ledger','orders']){
      await tab(value);await until(`${panel}.querySelector('tbody').children.length===${count}`);
      const info=await evaluate(`(async()=>{const p=${panel},wrap=p.querySelector('.data-table-wrap'),s=wrap.querySelector('[data-slot="table-container"]'),head=s.querySelector('thead');const before=head.getBoundingClientRect().top;const controls=[...p.querySelectorAll('form,button')].filter(el=>!wrap.contains(el));const top=controls.map(el=>el.getBoundingClientRect().top);s.scrollTop=200;s.scrollLeft=150;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {h:s.clientHeight,sh:s.scrollHeight,w:s.clientWidth,sw:s.scrollWidth,outerOverflow:getComputedStyle(wrap).overflow,sticky:getComputedStyle(head).position,headDelta:Math.abs(head.getBoundingClientRect().top-before),controlsStayed:controls.every((el,i)=>Math.abs(el.getBoundingClientRect().top-top[i])<1),aligned:Math.abs(s.querySelector('th').getBoundingClientRect().left-(s.querySelector('td')?.getBoundingClientRect().left??s.querySelector('th').getBoundingClientRect().left))<1,pageWidth:document.documentElement.scrollWidth};})()`);
      assert.ok(info.h<=501,JSON.stringify({value,width,language,count,...info}));assert.ok(info.controlsStayed);assert.ok(info.aligned);assert.ok(info.pageWidth<=width+1,'page must not overflow horizontally');
      assert.equal(info.outerOverflow,'visible','only the Table inner container owns scrolling');
      if(count===100){assert.ok(info.sh>info.h);assert.equal(info.sticky,'sticky');assert.ok(info.headDelta<2,'header must stay fixed during scroll');if(width===375)assert.ok(info.sw>info.w);}
      if(count<=1)assert.ok(info.h<200,'few rows should shrink naturally');
      if(width===375)assert.ok(info.h<=height*.65+1);
      scenarios++;
    }
  }
  await evaluate('window.__mount(20,"en")');await until('!!document.querySelector(\'[role="tablist"]\')');await tab('users');
  await click(`${panel}?.querySelector('tbody input[type="checkbox"]')`);
  // Wait for the controlled React checkbox commit, not just mouse dispatch.
  await until(`${panel}?.querySelector('tbody input[type="checkbox"]').checked===true`);
  assert.equal(await evaluate(`${panel}?.querySelector('tbody input[type="checkbox"]').checked`),true);
  await click(`[...${panel}.querySelectorAll('button')].find(el=>el.textContent.includes('CSV'))`);await until('window.__downloads.length===1');
  await click(`${panel}.querySelector('tbody button')`);await until('!!document.querySelector(\'[role="dialog"]\')');assert.ok((await evaluate('document.querySelector(\'[role="dialog"]\').textContent')).includes('person0@example.test'));
  await click(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]')`);
  let detailScenarios=0;
  for(const [width,height] of [[1440,1000],[375,700]])for(const language of ['zh','en']) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
    await evaluate(`window.__longEmail=true;window.__detailRows=40;window.__mount(20,${JSON.stringify(language)})`);
    await until('!!document.querySelector(\'[role="tablist"]\')');await tab('users');
    await click(`${panel}.querySelector('tbody button')`);await until('!!document.querySelector(\'[role="dialog"]\')');
  // The user detail itself must be viewport-bounded. Its history sections,
  // not the document or the dialog shell, own vertical/horizontal scrolling.
  const userLayout=await evaluate(`(async()=>{
    const dialog=document.querySelector('[role="dialog"]'),header=dialog.querySelector('[data-slot="dialog-header"]'),body=dialog.querySelector('[data-testid="user-detail-body-scroll"]');
    const beforeTop=header.getBoundingClientRect().top;
    const regions=['orders','ledger','usage'].map(name=>{
      const el=dialog.querySelector('[data-testid="user-detail-'+name+'-scroll"]');
      const result={name,height:el.clientHeight,scrollHeight:el.scrollHeight,width:el.clientWidth,scrollWidth:el.scrollWidth};
      el.scrollTop=120;el.scrollLeft=80;return result;
    });
    body.scrollTop=100;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {dialogWidth:dialog.getBoundingClientRect().width,viewportWidth:innerWidth,headerDelta:Math.abs(header.getBoundingClientRect().top-beforeTop),
      titleSize:parseFloat(getComputedStyle(dialog.querySelector('[data-slot="dialog-title"]')).fontSize),
      bodyScrollHeight:body.scrollHeight,bodyHeight:body.clientHeight,bodyOverflow:getComputedStyle(body).overflowY,
      documentScrollWidth:document.documentElement.scrollWidth,regions};
  })()`);
  assert.ok(userLayout.dialogWidth<=userLayout.viewportWidth-16,JSON.stringify(userLayout));
  assert.ok(userLayout.documentScrollWidth<=userLayout.viewportWidth+1,'user detail must not cause page-wide horizontal scrolling');
  assert.ok(userLayout.titleSize<=24,'user detail title must not inherit the site-wide oversized h2 rule');
  assert.equal(userLayout.bodyOverflow,'auto');
  assert.ok(userLayout.bodyScrollHeight>userLayout.bodyHeight,'user details must scroll within their own body');
  assert.ok(userLayout.headerDelta<2,'dialog header should stay fixed when the body scrolls');
  for(const r of userLayout.regions){assert.ok(r.scrollHeight>r.height,'history list should scroll vertically: '+r.name);}
  if(width===375)for(const r of userLayout.regions.filter(r=>r.name!=='usage')){assert.ok(r.scrollWidth>r.width,'history table should scroll horizontally on mobile: '+r.name);}


    const longHeader=await evaluate(`(()=>{const d=document.querySelector('[role="dialog"]'),h=d.querySelector('[data-slot="dialog-header"]'),close=d.querySelector('[data-slot="dialog-close"]'),r=close.getBoundingClientRect();return {headerWidth:h.clientWidth,headerScrollWidth:h.scrollWidth,closeVisible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};})()`);
    assert.ok(longHeader.headerScrollWidth<=longHeader.headerWidth+1,'long email must wrap inside the fixed header');
    assert.ok(longHeader.closeVisible,'close button must remain in the viewport');
    await click(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]')`);
    await until('!document.querySelector(\'[role="dialog"]\')');
    detailScenarios++;
    for(const rows of [0,1]) {
      await evaluate(`window.__detailRows=${rows}`);
      await click(`${panel}.querySelector('tbody button')`);await until('!!document.querySelector(\'[role="dialog"]\')');
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
      assert.equal(await evaluate(`document.querySelectorAll('[data-testid="user-detail-orders-scroll"]').length`),rows?1:0);
      if(rows)assert.ok(await evaluate(`document.querySelector('[data-testid="user-detail-orders-scroll"]').clientHeight<160`),'one order should shrink naturally');
      await click(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]')`);
      await until('!document.querySelector(\'[role="dialog"]\')');
      detailScenarios++;
    }
  }
  // Exercise the unchanged confirmation and mutation handlers using mock-only
  // accounts. No network or real administrator mutation is possible here.
  await evaluate('window.__longEmail=false;window.__detailRows=0;window.__mount(20,"en")');
  await until('!!document.querySelector(\'[role="tablist"]\')');await tab('users');
  const openDetails=async()=>{await click(`${panel}?.querySelector('tbody button')`);await until('!!document.querySelector(\'[role="dialog"]\')');};
  const confirmAction=async()=>{
    await until('!!document.querySelector(\'[role="alertdialog"]\')');
    await evaluate(`(()=>{const input=document.querySelector('[role="alertdialog"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Isolated UI regression reason');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(`![...document.querySelectorAll('[role="alertdialog"] button')].find(el=>el.textContent==='Confirm').disabled`);
    await click(`[...document.querySelectorAll('[role="alertdialog"] button')].find(el=>el.textContent==='Confirm')`);
  };
  await openDetails();
  await click(`[...document.querySelectorAll('[role="dialog"] button')].find(el=>el.textContent==='Mark test account')`);await confirmAction();
  await until(`window.__calls.some(c=>c.path==='/v1/admin/users/u0/test-account'&&c.body.isTestAccount===true)`);
  await openDetails();
  await evaluate(`(()=>{const input=document.querySelector('[role="dialog"] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Private mock note');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click(`[...document.querySelectorAll('[role="dialog"] button')].find(el=>el.textContent==='Save note'||el.textContent==='保存备注')`);await confirmAction();
  await until(`window.__calls.some(c=>c.path==='/v1/admin/users/u0/note'&&c.body.note==='Private mock note')`);
  await click(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]')`);
  await openDetails();await click(`[...document.querySelectorAll('[role="dialog"] button')].find(el=>el.textContent==='Archive account')`);await confirmAction();
  await until(`window.__calls.some(c=>c.path==='/v1/admin/users/u0/archive')`);
  await click(`${panel}?.querySelector('tbody input[type="checkbox"]')`);
  await click(`${panel}.querySelectorAll('tbody button')[1]`);await until('!!document.querySelector(\'[role="alertdialog"]\')');
  await evaluate(`(()=>{const input=document.querySelector('[role="alertdialog"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Isolated layout test reason');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(`![...document.querySelectorAll('[role="alertdialog"] button')].find(el=>el.textContent==='Confirm').disabled`);
  await click(`[...document.querySelectorAll('[role="alertdialog"] button')].find(el=>el.textContent==='Confirm')`);
  await until(`window.__calls.some(c=>c.path==='/v1/admin/users/u0/status'&&c.body.status==='frozen')&&document.querySelector('[role="tabpanel"][data-state="active"] tbody tr')?.textContent.includes('Frozen')`);
  await click(`${panel}?.querySelector('tbody input[type="checkbox"]')`);
  await click(`${panel}.querySelectorAll('tbody input[type="checkbox"]')[1]`);
  await click(`${panel}.querySelectorAll('tbody input[type="checkbox"]')[2]`);
  await click(`[...${panel}.querySelectorAll('button')].find(el=>el.textContent==='Freeze selected')`);await until('!!document.querySelector(\'[role="alertdialog"]\')');
  await click(`[...document.querySelectorAll('[role="alertdialog"] button')].find(el=>el.textContent==='Confirm')`);
  await until(`window.__calls.some(c=>c.path==='/v1/admin/users/bulk-status')&&document.querySelectorAll('[role="tabpanel"][data-state="active"] tbody tr')[1]?.textContent.includes('Frozen')`);
  assert.deepEqual(await evaluate(`window.__calls.find(c=>c.path==='/v1/admin/users/bulk-status').body.userIds`),['u1','u2']);
   await tab('orders');
   await click(`${panel}.querySelector('[data-testid="admin-unified-orders"] tbody button')`);
   await until(`${panel}.textContent.includes('Order review summary')`);
   await click(`${panel}.querySelector('details > summary')`);
   await click(`${panel}.querySelector('details tbody button')`);
   await until('!!document.querySelector(\'[role="dialog"]\')');
   assert.ok((await evaluate('document.querySelector(\'[role="dialog"]\').textContent')).includes('o0'));
  await click(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]')`);
  await tab('packages');assert.equal(await evaluate(`${panel}.querySelectorAll('.admin-list-scroll').length`),0);
  console.log(`PASS: ${scenarios} table/layout scenarios; ${detailScenarios} user-detail viewport/language/row scenarios; mark-test, archive, notes; user selection, CSV, freeze, bulk status, user/order details and unaffected package tab`);
 }finally{if(chrome)chrome.kill();for(const item of pending.values()){clearTimeout(item.timer);}await wait(120);rmSync(dir,{recursive:true,force:true});}
});
