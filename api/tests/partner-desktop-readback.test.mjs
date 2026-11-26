import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {withMomentumBrowser} from '../../tests/helpers/momentum-browser.js';
const require=createRequire(new URL('../package.json',import.meta.url));
const {build}=require('esbuild');
const workflow=readFileSync(new URL('../../.github/workflows/partners-hosted-browser.yml',import.meta.url),'utf8');
const body=workflow.split('          async function financeReadback(id){')[1].split('\n          try{\n            let port;')[0];
const fn='async function financeReadback(id){'+body;
const requestId='11111111-1111-4111-8111-111111111111';
test('desktop workflow opens actual collapsed React views, verifies amounts and outsider denial without writes',{timeout:30000},async()=>{
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import Earnings from './src/components/account/PartnerEarningsCard';import Requests from './src/components/admin/PartnerRequestsPanel';let root;window.mount=(role,language)=>{if(root)flushSync(()=>root.unmount());root=createRoot(document.querySelector('#root'));flushSync(()=>root.render(role==='qa-admin'?<Requests language={language} write={()=>{throw Error('Financial write forbidden')}}/>:<Earnings language={language} owner={role}/>));};window.momentumReady=true;`,resolveDir:fileURLToPath(new URL('../../web/',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfig:fileURLToPath(new URL('../../web/tsconfig.json',import.meta.url)),define:{'import.meta.env.PUBLIC_API_BASE_URL':'"https://isolated.invalid"','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'}});
 await withMomentumBrowser('<div id="root"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>',async({evaluate})=>{
  const execute=async({role='qa-partner-a',amount=2000,button=false,language='zh',enabled=true,noClick=false,leak=false}={})=>evaluate(`(async()=>{
    const role=${JSON.stringify(role)},enabled=${enabled};
    const row={id:${JSON.stringify(requestId)},amount_fen:1000,recipient_version:1,settlement_status:'paid',created_at:1,account_mask:'q***@***',name_mask:'测*'};
    const calls=[];
    const data=path=>path.endsWith('/me')?(role==='qa-outsider-d'||!enabled?{enabled,policy:null}:{enabled:true,policy:{status:'active',level:'fixture',rate_bps:2000},totals:{orders:1,buyers:1,gross_fen:${amount},net_fen:0,held_fen:0,paid_fen:1000,reserved_fen:0,outstanding_fen:-1000}}):{enabled,accepting:false,pilotReview:true,pilotReconcile:true,requests:[row]};
    window.fetch=async(url,options={})=>{const path=new URL(url).pathname;calls.push(path);if(options.method&&options.method!=='GET')throw Error('Writes forbidden');return {ok:true,status:200,json:async()=>data(path)}};
    window.mount(role,${JSON.stringify(language)});
    const initiallyCollapsed=role==='qa-admin'||(!document.querySelector('strong')&&[...document.querySelectorAll('button')].some(e=>['查询推广伙伴资格','Check partner eligibility'].includes(e.textContent.trim()))&&calls.length===0);
    const process={env:{QA_EXPECTED_REQUEST_ID:${JSON.stringify(requestId)}}};
    const knownCookie='synthetic',stage=()=>{};
    const check=(ok,label)=>{if(!ok)throw Error(label)};
    const ev=async text=>{const result=eval(text);if(${button}&&role==='qa-admin'&&text.includes('f.requestSubmit()')){await new Promise(r=>setTimeout(r,20));document.querySelector('[data-slot=card]').insertAdjacentHTML('beforeend','<button>模拟批准并预留</button>')}return result};
    const until=async(fn,label)=>{for(let i=0;i<60;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10))}throw Error(label)};
    const visibleText=async labels=>until(()=>labels.some(s=>document.body.innerText.includes(s)),'missing text');
    const fill=async(selector,value)=>{const e=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0))};
    const click=async labels=>{if(${noClick})return;const e=[...document.querySelectorAll('button')].find(e=>labels.includes(e.textContent.trim())&&!e.disabled);check(e,'missing control');e.click();await new Promise(r=>setTimeout(r,20));
      if(${button}&&role==='qa-admin')document.querySelector('[data-slot=card]').insertAdjacentHTML('beforeend','<button>模拟批准并预留</button>');
      if(${leak})document.querySelector('[data-slot=card]').insertAdjacentHTML('beforeend','<strong>20.00</strong>');};
    const req=async path=>path.endsWith('/alipay-requests')&&role==='qa-outsider-d'?{status:403}:{status:200,json:async()=>data(path.split('?')[0])};
    ${fn}
    let outcome='pass';try{await financeReadback(role)}catch{outcome='denied'}
    return {outcome,initiallyCollapsed,calls};
   })()`);
  for(const language of ['zh','en']){
   const owner=await execute({language});assert.equal(owner.outcome,'pass');assert.equal(owner.initiallyCollapsed,true);assert.deepEqual(owner.calls,['/v1/partners/me','/v1/partners/alipay-requests']);
   const admin=await execute({role:'qa-admin',language});assert.equal(admin.outcome,'pass');assert.deepEqual(admin.calls,['/v1/admin/partners/alipay-requests']);
   const outsider=await execute({role:'qa-outsider-d',language});assert.equal(outsider.outcome,'pass');assert.equal(outsider.initiallyCollapsed,true);assert.deepEqual(outsider.calls,['/v1/partners/me']);
  }
  for(const options of [{amount:1900},{role:'qa-admin',button:true},{enabled:false},{noClick:true},{role:'qa-outsider-d',leak:true}])assert.equal((await execute(options)).outcome,'denied',JSON.stringify(options));
 });
});
