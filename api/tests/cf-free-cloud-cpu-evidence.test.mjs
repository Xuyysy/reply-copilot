import test from 'node:test';
import assert from 'node:assert/strict';
import {validAccount,validWindow,queries,summarize,collectCpuEvidence,parseCpuArgs}
  from '../scripts/cf-free-cloud-cpu-evidence.mjs';

const ID='307563e1fa86940ac46ca4dd78f1f12a',PROD='cb5fc919a9f05dcf39b3ca29c9538a1f';
const DO='c'.repeat(32),OTHER='d'.repeat(32);
const FROM='2026-11-20T09:01:00.000Z',TO='2026-11-20T09:05:00.000Z';
const TOKEN='fake-analytics-only-no-real-secret-2026';
const opts={accountId:ID,namespaceId:DO,from:FROM,to:TO};
const worker=rows=>({data:{viewer:{accounts:[{workersInvocationsAdaptive:rows}]}}});
const durable=(req,cpu)=>({data:{viewer:{accounts:[{
  durableObjectsInvocationsAdaptiveGroups:req,
  durableObjectsPeriodicGroups:cpu
}]}}});
const httpRow=(n=16)=>({dimensions:{scriptName:'xrh-cf-free-cpu-pilot-20261120',status:'success'},
  sum:{requests:n,errors:0},quantiles:{cpuTimeP50:2300,cpuTimeP99:11000}});
const doReq=(id=DO)=>({dimensions:{namespaceId:id},sum:{requests:8}});
const doCpu=(id=DO)=>({dimensions:{namespaceId:id},sum:{cpuTime:28000}});

test('account pinned to standalone isolated Free account; rejects Production and arbitrary account',()=>{
  assert.equal(validAccount(ID),true);
  assert.equal(validAccount(PROD),false);
  assert.equal(validAccount('a'.repeat(32)),false);
  assert.throws(()=>queries({...opts,accountId:PROD}));
});
test('requires an exact, same-UTC-day UTC window under 15 minutes',()=>{
  assert.equal(validWindow(FROM,TO),true);
  for(const pair of [[FROM,FROM],['2026-11-20T09:01:00+00:00',TO],
    [FROM,'2026-11-20T09:17:00.000Z'],['2026-11-20T23:59:00.000Z','2026-11-21T00:00:00.000Z'],
    ['bad-time',TO],['2026-11-20T09:01:60.000Z',TO]])
    assert.equal(validWindow(...pair),false,pair.join(' '));
});
test('GraphQL queries are read-only and fixed to script and namespace account',()=>{
  const q=queries(opts);
  assert.ok(q.worker.startsWith('query'));
  assert.ok(q.durable.startsWith('query'));
  assert.ok(q.worker.includes('workersInvocationsAdaptive'));
  assert.ok(q.durable.includes('durableObjectsInvocationsAdaptiveGroups'));
  assert.ok(q.durable.includes('durableObjectsPeriodicGroups'));
  assert.ok(q.worker.includes(ID));
  assert.ok(q.worker.includes(FROM));
  assert.ok(q.durable.includes('2026-11-20'));
  assert.ok(!q.worker.includes(PROD));
  assert.ok(!q.durable.includes('mutation'));
  assert.throws(()=>queries({...opts,namespaceId:'unknown'}));
});
test('CPU observations keep HTTP quantiles separate from DO periodic totals, never Free-certified',()=>{
  const report=summarize({
    worker:worker([httpRow(),{...httpRow(1),quantiles:{cpuTimeP50:4700,cpuTimeP99:16000}}]),
    durable:durable([doReq(OTHER),doReq(DO)],[doCpu(OTHER),doCpu(DO)]),
    namespaceId:DO
  });
  assert.equal(report.status,'BOTH_COMPONENTS_OBSERVED_NOT_CERTIFIED');
  assert.equal(report.http.observedRequests,17);
  assert.equal(report.http.highestGroupP99Raw,16000);
  assert.equal(report.durable.observedRequests,8);
  assert.equal(report.durable.aggregateCpuTimeRaw,28000);
  assert.equal(report.perInvocationDoCpu,false);
  assert.equal(report.freeCertified,false);
  assert.equal(report.safeToDowngradeProduction,false);
  const json=JSON.stringify(report);
  assert.equal(json.includes(ID),false);
  assert.equal(json.includes(DO),false);
});
test('missing DO periodic data or missing HTTP metrics is INSUFFICIENT, never zero',()=>{
  for(const [w,d] of [[worker([httpRow()]),durable([doReq()],[])],
    [worker([]),durable([doReq()],[doCpu()])],
    [worker([httpRow()]),durable([doReq(OTHER)],[doCpu(OTHER)])]]){
    const r=summarize({worker:w,durable:d,namespaceId:DO});
    assert.equal(r.status,'INSUFFICIENT');
    assert.equal(r.freeCertified,false);
  }
});
test('invalid, mismatched, truncated or tainted GraphQL rows fail closed',()=>{
  const good=durable([doReq()],[doCpu()]);
  for(const w of [{errors:[{message:'denied'}],data:worker([httpRow()]).data},
    worker([{...httpRow(),dimensions:{scriptName:'reply-copilot-api-production'}}]),
    worker([{...httpRow(),sum:{requests:-1,errors:0}}]),
    worker([{...httpRow(),quantiles:{cpuTimeP50:NaN,cpuTimeP99:22}}]),
    worker(Array.from({length:1000},()=>httpRow()))])
    assert.throws(()=>summarize({worker:w,durable:good,namespaceId:DO}));
  assert.throws(()=>summarize({worker:worker([httpRow()]),durable:durable([doReq()],[{
    dimensions:{namespaceId:DO},sum:{cpuTime:-2}}]),namespaceId:DO}));
});
test('scoped GraphQL fetch performs only two read-only POST queries; no token in output',async()=>{
  const calls=[];
  const results=[worker([httpRow()]),durable([doReq()],[doCpu()])];
  const fetchImpl=async(url,config)=>{
    calls.push({url,config});
    assert.equal(config.method,'POST');
    assert.equal(config.redirect,'error');
    assert.equal(config.headers.Authorization,'Bearer '+TOKEN);
    assert.ok(JSON.parse(config.body).query.startsWith('query'));
    return {ok:true,json:async()=>results[calls.length-1]};
  };
  const result=await collectCpuEvidence({...opts,token:TOKEN,fetchImpl});
  assert.equal(result.status,'BOTH_COMPONENTS_OBSERVED_NOT_CERTIFIED');
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.url==='https://api.cloudflare.com/client/v4/graphql'));
  assert.equal(JSON.stringify(result).includes(TOKEN),false);
});
test('GraphQL 403, network errors, truncated results, missing token all reject',async()=>{
  await assert.rejects(()=>collectCpuEvidence({...opts,token:'short',fetchImpl:async()=>null}));
  await assert.rejects(()=>collectCpuEvidence({...opts,token:TOKEN,fetchImpl:async()=>{throw Error('secret-no-echo')}}),
    {message:'ANALYTICS_NETWORK_UNAVAILABLE'});
  await assert.rejects(()=>collectCpuEvidence({...opts,token:TOKEN,fetchImpl:async()=>({ok:false,status:403})}),
    {message:'ANALYTICS_HTTP_UNAVAILABLE'});
  await assert.rejects(()=>collectCpuEvidence({...opts,token:TOKEN,fetchImpl:async()=>({ok:true,json:async()=>({errors:[{message:'private'}]})})}),
    {message:'ANALYTICS_DATA_UNAVAILABLE'});
});
test('read-only CLI requires explicit flag, isolated ID, DO namespace and scoped token',()=>{
  const args=['--read-only','--expected-account-id',ID,'--expected-namespace-id',DO,
    '--from',FROM,'--to',TO];
  assert.equal(parseCpuArgs(args,{CF_FREE_PILOT_API_TOKEN:TOKEN}).namespaceId,DO);
  for(const bad of [[],args.slice(1),[...args,'--deploy'],args.map(x=>x===ID?PROD:x),
    args.filter(x=>x!=='--read-only')])
    assert.throws(()=>parseCpuArgs(bad,{CF_FREE_PILOT_API_TOKEN:TOKEN}));
});
