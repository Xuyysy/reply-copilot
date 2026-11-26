import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';

const workflow=readFileSync(new URL('../../.github/workflows/partners-hosted-finance.yml',import.meta.url),'utf8');
const script=workflow.split("node --input-type=module <<'JS'\n")[1].split('\n          JS')[0]
 .split('\n').map(line=>line.slice(10)).join('\n').replace("import {randomUUID} from 'node:crypto';",'');
const id='11111111-1111-4111-8111-111111111111';
async function resume({wrongId=false,wrongAmount=false,unknown=false,failStart=false,previewEnabled=true}={}){
 const calls=[],logs=[],errors=[];
 let state=unknown?'reconciling':'pending';
 const totals=()=>({orders:1,gross_fen:2000,net_fen:2000,held_fen:0,paid_fen:state==='paid'?1000:0,reserved_fen:['reserved','reconciling'].includes(state)?1000:0,outstanding_fen:state==='pending'?2000:1000});
 const row=()=>({id:wrongId?randomUUID():id,amount_fen:wrongAmount?999:1000,recipient_version:1,status:state==='pending'?'pending':'approved',settlement_status:state,reviewed_at:state==='pending'?null:1,account_mask:'q***@***',name_mask:'测*'});
 const process={env:{QA_PHASE:'ledger-resume',QA_EXPECTED_REQUEST_ID:id,PARTNERS_QA_CREDENTIALS:JSON.stringify({access:'a'.repeat(64),accounts:['qa-admin','qa-partner-a','qa-buyer-b','qa-buyer-c','qa-outsider-d','qa-excluded-e','qa-partner-f'].map((id,i)=>({id,email:id+'@example.test',password:String(i+1).repeat(64)}))})},exitCode:0};
 const revoked=new Set();
 const fetch=async(url,options)=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;
  const cookie=options.headers.Cookie??'';
  calls.push({path,body});
  let status=200,value={},headers={};
  if(!options.headers.Authorization)status=401;
  else if(path==='/v1/orders'||path==='/v1/subscriptions/orders')status=403;
  else if(path==='/v1/auth/login'){headers={'set-cookie':'rc_session='+body.identity.split('@')[0]};}
  else if(path==='/v1/auth/csrf')value={csrfToken:'fixture-csrf-token-long-enough'};
  else if(path==='/v1/me'){if(revoked.has(cookie))status=401;else{const userId=cookie.slice(11);value={user:{userId,role:userId==='qa-admin'?'admin':'user'}};}}
  else if(path==='/v1/auth/logout')revoked.add(cookie);
  else if(path==='/v1/admin/reauth'){}
  else if(path==='/v1/partners/me')value={policy:{version:1,status:'active',rate_bps:2000},totals:totals(),orders:[{order_domain:'recharge',principal_fen:10000,commission_fen:2000,net_fen:2000}]};
  else if(path.endsWith('/alipay-requests')){
   if(body)status=409;
   else value={enabled:true,accepting:true,minFen:1000,pilotReview:true,recipient:{version:1,account_mask:'q***@***',name_mask:'测*'},requests:[row()]};
  }else if(path.endsWith('/order-preview'))value=previewEnabled?{enabled:true,evidence:{eligible:true,principalFen:10000,refundedPrincipalFen:0},policyEligible:true,candidateFen:2000,policyVersion:1}:{enabled:false};
  else if(path.endsWith('/payout-review')){
   if(cookie.includes('outsider'))status=403;
   else if(body.action==='approve'&&state==='pending'){state='reserved';value={state};}
   else if(body.action==='start'&&state==='reserved'){
    if(failStart)status=503;
    else{state='reconciling';value={state,amountFen:1000,recipient:{account:'qa-fixture@example.test',name:'测试账户'}};headers={'cache-control':'no-store'};}
   }else if(body.action==='paid'&&state==='reconciling'){state='paid';value={state};}
   else status=409;
  }else throw Error('Unexpected local route '+path);
  return {status,headers:new Headers(headers),json:async()=>value};
 };
 await runInNewContext('(async()=>{'+script+'})()',{
  process,fetch,Buffer,Headers,AbortSignal,randomUUID,console:{log:x=>logs.push(x),error:x=>errors.push(x)}
 });
 return {calls,logs,errors,code:process.exitCode,state,revoked};
}
test('hosted continuation executes existing pending request with no discovery, accrual or replacement',async()=>{
 const result=await resume();
 assert.equal(result.code,0);
 assert.equal(result.state,'paid');
 assert.equal(result.revoked.size,3);
 assert.equal(result.calls.some(c=>/discovery|accrual-review|alipay-recipient/.test(c.path)),false);
 assert.deepEqual(result.calls.filter(c=>c.path.endsWith('/payout-review')&& !c.path.includes('unused')).map(c=>c.body.action),['approve','approve','start','start','paid','paid']);
 assert.ok(result.logs.includes('QA_FINANCE_LEDGER_RESUME_PASS'));
});
test('mismatched ID, amount or nonpending state stops before any financial mutation',async()=>{
 for(const options of [{wrongId:true},{wrongAmount:true},{unknown:true}]){
  const result=await resume(options);
  assert.equal(result.code,1);
  assert.equal(result.calls.some(c=>c.body&&/payout-review|alipay-requests/.test(c.path)),false);
  assert.equal(result.revoked.size,3);
 }
});
test('ambiguous start failure stops without an outcome or blind retry and logs out',async()=>{
 const result=await resume({failStart:true});
 assert.equal(result.code,1);
 assert.equal(result.calls.filter(c=>c.body?.action==='start').length,1);
 assert.equal(result.calls.some(c=>c.body?.action==='paid'),false);
 assert.equal(result.revoked.size,3);
});

test('disabled order preview fails closed before financial writes, preserving history and revoking sessions',async()=>{
 const result=await resume({previewEnabled:false});
 assert.equal(result.code,1);
 assert.equal(result.state,'pending');
 assert.equal(result.calls.some(c=>c.body&&/payout-review|alipay-requests/.test(c.path)),false);
 assert.equal(result.revoked.size,3);
 assert.ok(result.errors.some(s=>s==='QA_FINANCE_FAIL ledger-resume resume-order-preview'));
});
