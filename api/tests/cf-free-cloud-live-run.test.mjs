import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedAccount,parseLiveRunArgs,runIsolatedFreePilot,makeCloudClient}
  from '../scripts/cf-free-cloud-live-run.mjs';
const ID='307563e1fa86940ac46ca4dd78f1f12a';
const PROD='cb5fc919a9f05dcf39b3ca29c9538a1f';
const COMMIT='b'.repeat(40),TOKEN='fake-scoped-Cloudflare-token-not-real-2026';
const NAME='xrh-cf-free-cpu-pilot-20261120';
const argumentsForRun=['--execute-isolated-free-pilot','--confirm-workers-free',
  '--confirm-delete-test-resources','--expected-account-id',ID,'--expected-commit',COMMIT];
function fake({workers=[],objects=[],scope=true,subdomain='x-reply-helper-isolated-workers-free-cpu-pilot',
  deployFails=false,deleteFails=false}={}){
  const actions=[];
  let w=[...workers],d=[...objects];
  const cloud=async(method,path)=>{
    actions.push({method,path});
    if(path==='/accounts?page=1&per_page=50')return [{id:scope?ID:PROD,name:'X Reply Helper - Isolated Workers Free CPU Pilot'}];
    if(path==='/accounts/'+ID+'/workers/scripts'&&method==='GET')return w.map(id=>({id}));
    if(path==='/accounts/'+ID+'/workers/durable_objects/namespaces'&&method==='GET')return d.map(name=>({name,id:'c'.repeat(32)}));
    if(path==='/accounts/'+ID+'/workers/subdomain')return {subdomain};
    if(method==='DELETE'&&path==='/accounts/'+ID+'/workers/scripts/'+NAME+'?force=false'){
      if(deleteFails)throw Error('CLOUD_API_HTTP_500');
      w=[];d=[];return null;
    }
    throw Error('UNEXPECTED_ACTION');
  };
  const wrangler=async(action)=>{
    actions.push({method:'WRANGLER_'+action,path:'synthetic'});
    if(action==='deploy'){
      w=[NAME];d=['xrh-cf-free-cpu-pilot-20261120_PasswordVerifierDO'];
      if(deployFails)throw Error('WRANGLER_ISOLATED_DEPLOY_FAILED');
    }
  };
  return {actions,cloud,wrangler};
}
const smoke=async()=>({kind:'SYNTHETIC_CF_FREE_ACCOUNT_PILOT',
  outcome:'SYNTHETIC_SMOKE_PASS',syntheticRequests:16,freeCertified:false});
async function run(f,options={}){
  return runIsolatedFreePilot({accountId:ID,commit:COMMIT,repeats:1,token:TOKEN},{
    cloud:f.cloud,wrangler:f.wrangler,probe:options.probe||smoke,source:()=>{},
    dryRun:()=>({status:'ISOLATED_WRANGLER_DRY_RUN_PASS',deployed:false}),
    cpu:async()=>({kind:'XRH_CLOUDFLARE_CPU_EVIDENCE',status:'BOTH_COMPONENTS_OBSERVED_NOT_CERTIFIED',freeCertified:false}),
    clock:()=>Date.parse('2026-11-20T09:02:00.000Z'),
    secret:()=>('s'.repeat(96))
  });
}
test('rejects production ID and requires explicit approval flags and token',()=>{
  assert.equal(approvedAccount(ID),true);
  assert.equal(approvedAccount(PROD),false);
  assert.equal(parseLiveRunArgs(argumentsForRun,{CF_FREE_PILOT_API_TOKEN:TOKEN}).accountId,ID);
  for(const x of [[],argumentsForRun.slice(1),
    argumentsForRun.filter(a=>a!=='--confirm-workers-free'),
    argumentsForRun.filter(a=>a!=='--confirm-delete-test-resources'),
    [...argumentsForRun,'--repeats','3'],[...argumentsForRun,'--unexpected']])
    assert.throws(()=>parseLiveRunArgs(x,{CF_FREE_PILOT_API_TOKEN:TOKEN}));
  assert.throws(()=>parseLiveRunArgs(argumentsForRun,{CF_FREE_PILOT_API_TOKEN:'short'}));
});
test('allows only empty exact isolated account, never Production or existing DO',async()=>{
  for(const opt of [{workers:['reply-copilot-api-production']},
    {workers:['unrelated-worker']},{objects:['any-DO']},
    {scope:false},{subdomain:'production-subdomain'}]){
    const f=fake(opt),r=await run(f);
    assert.equal(r.uploaded,false);
    assert.ok(!f.actions.some(x=>x.method.startsWith('WRANGLER_')));
    assert.ok(!f.actions.some(x=>x.method==='DELETE'));
  }
});
test('one-shot experiment runs fixed smoke and deletes named Worker plus DO',async()=>{
  const f=fake(),r=await run(f);
  assert.equal(r.uploaded,true);
  assert.equal(r.smoke.outcome,'SYNTHETIC_SMOKE_PASS');
  assert.equal(r.cleanup.attempted,true);
  assert.equal(r.cleanup.workerAbsent,true);
  assert.equal(r.cleanup.doNamespaceAbsent,true);
  assert.deepEqual(r.errors,[]);
  assert.equal(r.safeToDowngradeProduction,false);
  assert.equal(r.cloudCpuMs,null);
  assert.equal(r.cpuAnalytics.status,'BOTH_COMPONENTS_OBSERVED_NOT_CERTIFIED');
  assert.equal(r.cpuNamespaceId,'c'.repeat(32));
  assert.equal(r.cpuAnalytics.freeCertified,false);
  assert.equal(f.actions.filter(x=>x.method==='DELETE').length,1);
  assert.equal(f.actions.filter(x=>x.method==='WRANGLER_deploy').length,1);
  assert.equal(f.actions.filter(x=>x.method==='WRANGLER_secret').length,1);
  const json=JSON.stringify(r);
  for(const secret of [TOKEN,ID,'s'.repeat(96)])assert.equal(json.includes(secret),false);
});
test('partial deploy failure triggers exactly scoped deletion and cleanup verification',async()=>{
  const f=fake({deployFails:true}),r=await run(f);
  assert.equal(r.uploaded,false);
  assert.equal(r.cleanup.attempted,true);
  assert.equal(r.cleanup.workerAbsent,true);
  assert.equal(r.cleanup.doNamespaceAbsent,true);
  assert.ok(r.errors.includes('WRANGLER_ISOLATED_DEPLOY_FAILED'));
});
test('identity check failure still deletes Worker and SQLite DO',async()=>{
  const f=fake(),r=await run(f,{probe:async()=>{throw Error('ISOLATED_IDENTITY_UNAVAILABLE')}});
  assert.equal(r.smoke,null);
  assert.equal(r.cleanup.workerAbsent,true);
  assert.equal(r.cleanup.doNamespaceAbsent,true);
  assert.ok(r.errors.includes('ISOLATED_IDENTITY_UNAVAILABLE'));
});
test('any cleanup failure cannot claim zero resources',async()=>{
  const f=fake({deleteFails:true}),r=await run(f);
  assert.equal(r.cleanup.attempted,true);
  assert.equal(r.cleanup.workerAbsent,false);
  assert.equal(r.cleanup.doNamespaceAbsent,false);
  assert.ok(r.errors.includes('ISOLATED_WORKER_DELETE_FAILED'));
  assert.ok(r.errors.includes('TEST_RESOURCES_NOT_CONFIRMED_REMOVED'));
});
test('Cloudflare read API refuses writes except scoped delete and never redirects',async()=>{
  let request;
  const client=makeCloudClient(TOKEN,async(url,opts)=>{
    request={url,opts};
    return {ok:true,status:200,json:async()=>({success:true,result:[]})};
  });
  await client('GET','/accounts?page=1&per_page=50');
  assert.equal(request.opts.method,'GET');
  assert.equal(request.opts.redirect,'error');
  await assert.rejects(()=>client('PUT','/accounts/test'));
  await assert.rejects(()=>client('GET','/evil'));
  await assert.rejects(()=>client('GET','/accounts/../../bad'));
});

test('missing analytics permission after successful synthetic smoke is clearly not Free-certified',async()=>{
  const f=fake();
  const r=await runIsolatedFreePilot({accountId:ID,commit:COMMIT,repeats:1,token:TOKEN},{
    cloud:f.cloud,wrangler:f.wrangler,probe:smoke,source:()=>{},
    dryRun:()=>({status:'ISOLATED_WRANGLER_DRY_RUN_PASS',deployed:false}),
    cpu:async()=>{throw Error('GRAPHQL_HTTP_UNAVAILABLE')},
    clock:()=>Date.parse('2026-11-20T09:02:00.000Z'),
    secret:()=>('s'.repeat(96))
  });
  assert.equal(r.smoke.outcome,'SYNTHETIC_SMOKE_PASS');
  assert.ok(r.errors.includes('CLOUD_CPU_ANALYTICS_UNAVAILABLE'));
  assert.equal(r.cpuAnalytics,null);
  assert.equal(r.freeCertified,false);
  assert.equal(r.cleanup.workerAbsent,true);
  assert.equal(r.cleanup.doNamespaceAbsent,true);
});
test('invalid namespace inventory fails closed and still deletes isolated Worker',async()=>{
  const f=fake();
  const cloud=async(method,path)=>{
    const v=await f.cloud(method,path);
    if(method==='GET'&&path===('/accounts/'+ID+'/workers/durable_objects/namespaces')&&
       f.actions.some(a=>a.method==='WRANGLER_deploy')&&
       !f.actions.some(a=>a.method==='DELETE')){
      return [{name:'unexpected_DurableObject',id:'f'.repeat(32)}];
    }
    return v;
  };
  const r=await runIsolatedFreePilot({accountId:ID,commit:COMMIT,repeats:1,token:TOKEN},{
    cloud,wrangler:f.wrangler,probe:smoke,source:()=>{},
    dryRun:()=>({status:'ISOLATED_WRANGLER_DRY_RUN_PASS',deployed:false}),
    cpu:async()=>{throw Error('SHOULD_NOT_QUERY')},
    clock:()=>Date.parse('2026-11-20T09:02:00.000Z'),
    secret:()=>('s'.repeat(96))
  });
  assert.ok(r.errors.includes('ISOLATED_SQLITE_NAMESPACE_NOT_VERIFIED'));
  assert.equal(r.cpuAnalytics,null);
  assert.equal(r.cleanup.workerAbsent,true);
  assert.equal(r.cleanup.doNamespaceAbsent,true);
});
