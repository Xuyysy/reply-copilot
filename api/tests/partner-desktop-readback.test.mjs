import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withMomentumBrowser} from '../../tests/helpers/momentum-browser.js';
const workflow=readFileSync(new URL('../../.github/workflows/partners-hosted-browser.yml',import.meta.url),'utf8');
const body=workflow.split('          async function financeReadback(id){')[1].split('\n          try{\n            let port;')[0];
const fn='async function financeReadback(id){'+body;
const requestId='11111111-1111-4111-8111-111111111111';
test('desktop workflow readback checks real DOM amounts, masked request and paid admin controls',{timeout:30000},async()=>{
 await withMomentumBrowser('<div id="root"></div><script>window.momentumReady=true</script>',async({evaluate})=>{
  const execute=async({role='qa-partner-a',amount=20,button=false}={})=>{
   const cards=[['累计佣金',amount],['退款后佣金',0],['已结算',10],['结算预留',0],['待核对净额（含欠款）',-10]];
   const html=cards.map(([label,n])=>'<div><p>'+label+'</p><strong>¥'+n.toFixed(2)+'</strong></div>').join('')+
    '<section><h3>支付宝结算申请</h3><form><input aria-label="推广伙伴用户 ID"></form><p>'+requestId+'</p><p>已结算 q***@*** 测*</p>'+
    (button?'<button>模拟批准并预留</button>':'')+'</section>';
   return evaluate(`(async()=>{
    document.querySelector('#root').innerHTML=${JSON.stringify(html)};
    document.querySelector('form').onsubmit=e=>e.preventDefault();
    const process={env:{QA_EXPECTED_REQUEST_ID:${JSON.stringify(requestId)}}};
    const knownCookie='synthetic';
    const stage=()=>{};
    const check=(ok,label)=>{if(!ok)throw Error(label)};
    const ev=async text=>eval(text);
    const until=async(fn,label)=>check(await fn(),label);
    const visibleText=async labels=>check(labels.some(s=>document.body.innerText.includes(s)),'missing text');
    const fill=async(selector,value)=>{document.querySelector(selector).value=value};
    const click=async()=>{};
    const row={id:${JSON.stringify(requestId)},amount_fen:1000,recipient_version:1,settlement_status:'paid',account_mask:'q***@***',name_mask:'测*'};
    const req=async path=>{
     if(path.endsWith('/alipay-requests')&&${JSON.stringify(role)}==='qa-outsider-d')return {status:403};
     const value=path.endsWith('/me')
      ?(${JSON.stringify(role)}==='qa-outsider-d'?{enabled:true,policy:null}:{policy:{status:'active'},totals:{orders:1,gross_fen:2000,net_fen:0,paid_fen:1000,reserved_fen:0,outstanding_fen:-1000}})
      :{enabled:true,requests:[row]};
     return {status:200,json:async()=>value};
    };
    ${fn}
    try{await financeReadback(${JSON.stringify(role)});return 'pass'}catch{return 'denied'}
   })()`);
  };
  assert.equal(await execute(),'pass');
  assert.equal(await execute({amount:19}),'denied');
  assert.equal(await execute({role:'qa-admin'}),'pass');
  assert.equal(await execute({role:'qa-admin',button:true}),'denied');
  assert.equal(await execute({role:'qa-outsider-d'}),'pass');
 });
});
