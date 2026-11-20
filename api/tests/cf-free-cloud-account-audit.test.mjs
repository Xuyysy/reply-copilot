import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPilotAccount,parseAccountAuditArgs} from '../scripts/cf-free-cloud-account-audit.mjs';

const ID='a'.repeat(32),TOKEN='synthetic-read-only-cloudflare-api-token-for-tests';
const API='https://api.cloudflare.com/client/v4';
const args=['--audit-read-only','--expected-account-id',ID];

function mockApi({accounts=[{id:ID}],scripts=[],subscriptions=[],failPath=null,extraPages=false}={}){
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,opts});
    if(!url.startsWith(API+'/')||opts.method!=='GET'||opts.redirect!=='error')
      throw Error('Unsafe method or hostname');
    if(!opts.headers.Authorization.endsWith(TOKEN))throw Error('Wrong token');
    const path=url.slice(API.length);
    if(failPath&&path.includes(failPath))return {ok:false,status:403,json:async()=>({success:false})};
    let result;
    if(path.startsWith('/accounts?'))result=accounts;
    else if(path==='/accounts/'+ID+'/workers/scripts')result=scripts;
    else if(path==='/accounts/'+ID+'/subscriptions')result=subscriptions;
    else throw Error('Unexpected Cloudflare endpoint');
    return {ok:true,json:async()=>({
      success:true,result,...(path.startsWith('/accounts?')?
        {result_info:{total_pages:extraPages?2:1,total_count:accounts.length}}:{})
    })};
  };
  return {fetchImpl,calls};
}

test('requires explicit audit flag, specific account ID and a scoped token',()=>{
  assert.equal(parseAccountAuditArgs(args,{CF_FREE_PILOT_READ_TOKEN:TOKEN}).expectedAccountId,ID);
  for(const a of [[],['--expected-account-id',ID],['--audit-read-only'],[
    '--audit-read-only','--expected-account-id','production'],[...args,'--deploy']]){
    assert.throws(()=>parseAccountAuditArgs(a,{CF_FREE_PILOT_READ_TOKEN:TOKEN}));
  }
  assert.throws(()=>parseAccountAuditArgs(args,{CF_FREE_PILOT_READ_TOKEN:'short'}));
});

test('current connected-account shape with production/staging Workers blocks, no mutation',async()=>{
  const api=mockApi({scripts:[{id:'reply-copilot-api-production'},
    {id:'reply-copilot-api-staging'},{id:'some-other-worker'}],
    failPath:'/subscriptions'});
  const r=await auditPilotAccount({expectedAccountId:ID,token:TOKEN,fetchImpl:api.fetchImpl});
  assert.equal(r.decision,'NO_GO');
  assert.equal(r.deploymentAuthorized,false);
  assert.equal(r.emptyWorkerAccount,false);
  assert.ok(r.blockers.includes('REPLY_HELPER_WORKER_PRESENT'));
  assert.ok(r.blockers.includes('ISOLATED_ACCOUNT_HAS_EXISTING_WORKERS'));
  assert.equal(r.billingReadStatus,'UNAVAILABLE');
  assert.ok(r.blockers.includes('BILLING_READ_UNAVAILABLE'));
  assert.equal(api.calls.length,3);
  assert.ok(api.calls.every(c=>c.opts.method==='GET'));
});

test('only one account may be accessible and its ID must exactly match',async()=>{
  for(const scenario of [{accounts:[{id:ID},{id:'b'.repeat(32)}]},
    {accounts:[{id:'b'.repeat(32)}]}, {accounts:[{id:ID}],extraPages:true}]){
    const api=mockApi(scenario);
    const r=await auditPilotAccount({expectedAccountId:ID,token:TOKEN,fetchImpl:api.fetchImpl});
    assert.equal(r.decision,'NO_GO');
    assert.equal(r.accountMatch,scenario.accounts.length===1&&scenario.accounts[0].id===ID&&!scenario.extraPages);
    assert.equal(api.calls.length,1);
  }
});

test('empty account and billing read success still never certify a Free plan',async()=>{
  const api=mockApi();
  const r=await auditPilotAccount({expectedAccountId:ID,token:TOKEN,fetchImpl:api.fetchImpl});
  assert.equal(r.accountMatch,true);
  assert.equal(r.emptyWorkerAccount,true);
  assert.equal(r.billingReadStatus,'READ_ONLY');
  assert.equal(r.freePlanVerified,false);
  assert.equal(r.deploymentAuthorized,false);
  assert.ok(r.blockers.includes('FREE_PLAN_NOT_INDEPENDENTLY_ATTESTED'));
});

test('active Workers Paid subscription blocks, even with no existing scripts',async()=>{
  const api=mockApi({subscriptions:[{status:'active',product:{name:'Workers Paid'},
    rate_plan:{id:'workers_paid'}}]});
  const r=await auditPilotAccount({expectedAccountId:ID,token:TOKEN,fetchImpl:api.fetchImpl});
  assert.equal(r.emptyWorkerAccount,true);
  assert.ok(r.blockers.includes('WORKERS_PAID_SUBSCRIPTION_SEEN'));
  assert.equal(r.decision,'NO_GO');
});

test('403 Billing Read is a documented missing permission, never Free evidence',async()=>{
  const api=mockApi({failPath:'/subscriptions'});
  const r=await auditPilotAccount({expectedAccountId:ID,token:TOKEN,fetchImpl:api.fetchImpl});
  assert.equal(r.billingReadStatus,'UNAVAILABLE');
  assert.ok(r.blockers.includes('BILLING_READ_UNAVAILABLE'));
  assert.equal(r.freePlanVerified,false);
});

test('inaccessible accounts or Workers inventory fail closed',async()=>{
  for(const failPath of ['/accounts?','/workers/scripts']){
    const api=mockApi({failPath});
    const r=await auditPilotAccount({expectedAccountId:ID,token:TOKEN,fetchImpl:api.fetchImpl});
    assert.equal(r.decision,'NO_GO');
    assert.equal(r.deploymentAuthorized,false);
    assert.ok(r.blockers.includes(failPath==='/accounts?'?
      'ACCOUNT_READ_ACCESS_UNAVAILABLE':'WORKER_INVENTORY_UNAVAILABLE'));
  }
});

test('audit result never emits account ID, token, subscription IDs or worker names',async()=>{
  const api=mockApi({scripts:[{id:'reply-copilot-api-production'}],
    subscriptions:[{status:'active',product:{name:'Workers Paid'},id:'secret-subscription-id'}]});
  const r=await auditPilotAccount({expectedAccountId:ID,token:TOKEN,fetchImpl:api.fetchImpl});
  const s=JSON.stringify(r);
  for(const value of [ID,TOKEN,'reply-copilot-api-production','secret-subscription-id'])
    assert.equal(s.includes(value),false);
  assert.equal(r.productionUnaffected,true);
});
