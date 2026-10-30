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
 const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await wait(25);}throw new Error('UI did not settle: '+expression);};
 const click=async expression=>{
  await until(`(()=>{const el=${expression};if(!el)return false;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>0&&r.height>0&&(hit===el||el.contains(hit));})()`);
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
      else if(p==='/v1/admin/ledger')data={ledger:users().map((u,i)=>({id:'l'+i,email:u.email,kind:'generation_debit',free_delta:-1,paid_delta:0,reason:'Generation debit / 正常生成',created_at:1793318400000}))};
      else if(p==='/v1/admin/packages')data={packages:[{id:'starter',name_zh:'入门包',name_en:'Starter',credits:400,price_cents:149,price_cny_fen:990,active:1}]};
      else if(p==='/v1/admin/settings')data={settings:[]};else if(p==='/v1/admin/audits')data={audits:[]};else if(p==='/v1/admin/content')data={content:{}};
      else if(p==='/v1/auth/csrf')data={csrfToken:'mock-only'};
      else if(p==='/v1/admin/export')return new Response('id,email\\nu0,person0@example.test',{headers:{'content-type':'text/csv'}});
      else if(p==='/v1/admin/users/bulk-status'){for(const id of body.userIds)window.__states[id]=body.status;data={ok:true};}
      else if(/^\\/v1\\/admin\\/users\\/u\\d+\\/status$/.test(p)){window.__states[p.split('/')[4]]=body.status;data={ok:true};}
      else if(/^\\/v1\\/admin\\/users\\/u\\d+$/.test(p)){const user=users().find(u=>u.id===p.split('/')[4]);data={user,quota:{freeRemaining:200,paidRemaining:400},orders:[],ledger:[],usage:[]};}
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
  await click(`${panel}.querySelector('tbody input[type="checkbox"]')`);
  // Wait for the controlled React checkbox commit, not just mouse dispatch.
  await until(`${panel}.querySelector('tbody input[type="checkbox"]').checked===true`);
  assert.equal(await evaluate(`${panel}.querySelector('tbody input[type="checkbox"]').checked`),true);
  await click(`[...${panel}.querySelectorAll('button')].find(el=>el.textContent.includes('CSV'))`);await until('window.__downloads.length===1');
  await click(`${panel}.querySelector('tbody button')`);await until('!!document.querySelector(\'[role="dialog"]\')');assert.ok((await evaluate('document.querySelector(\'[role="dialog"]\').textContent')).includes('person0@example.test'));
  await click(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]')`);
  await click(`${panel}.querySelectorAll('tbody button')[1]`);await until('!!document.querySelector(\'[role="alertdialog"]\')');
  await evaluate(`(()=>{const input=document.querySelector('[role="alertdialog"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Isolated layout test reason');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await until(`![...document.querySelectorAll('[role="alertdialog"] button')].find(el=>el.textContent==='Confirm').disabled`);
  await click(`[...document.querySelectorAll('[role="alertdialog"] button')].find(el=>el.textContent==='Confirm')`);
  await until(`window.__calls.some(c=>c.path==='/v1/admin/users/u0/status'&&c.body.status==='frozen')&&document.querySelector('[role="tabpanel"][data-state="active"] tbody tr')?.textContent.includes('Frozen')`);
  await click(`${panel}.querySelector('tbody input[type="checkbox"]')`);
  await click(`${panel}.querySelectorAll('tbody input[type="checkbox"]')[1]`);
  await click(`${panel}.querySelectorAll('tbody input[type="checkbox"]')[2]`);
  await click(`[...${panel}.querySelectorAll('button')].find(el=>el.textContent==='Freeze selected')`);await until('!!document.querySelector(\'[role="alertdialog"]\')');
  await click(`[...document.querySelectorAll('[role="alertdialog"] button')].find(el=>el.textContent==='Confirm')`);
  await until(`window.__calls.some(c=>c.path==='/v1/admin/users/bulk-status')&&document.querySelectorAll('[role="tabpanel"][data-state="active"] tbody tr')[1]?.textContent.includes('Frozen')`);
  assert.deepEqual(await evaluate(`window.__calls.find(c=>c.path==='/v1/admin/users/bulk-status').body.userIds`),['u1','u2']);
  await tab('orders');await click(`${panel}.querySelector('tbody a,tbody button')`);await until('!!document.querySelector(\'[role="dialog"]\')');assert.ok((await evaluate('document.querySelector(\'[role="dialog"]\').textContent')).includes('o0'));
  await click(`document.querySelector('[role="dialog"] [data-slot="dialog-close"]')`);
  await tab('packages');assert.equal(await evaluate(`${panel}.querySelectorAll('.admin-list-scroll').length`),0);
  console.log(`PASS: ${scenarios} table/layout scenarios; user selection, CSV, freeze, bulk status, user/order details and unaffected package tab`);
 }finally{if(chrome)chrome.kill();for(const item of pending.values()){clearTimeout(item.timer);}await wait(120);rmSync(dir,{recursive:true,force:true});}
});
