import test from 'node:test';
import assert from 'node:assert/strict';
import {routeCategory,parseArgs,cpuQuery,summarize,run} from '../scripts/cf-free-route-cpu.mjs';
const VERSION='ad1095da-90cd-4d93-ba22-ce760cdf5967';
const ACCOUNT='cb5fc919a9f05dcf39b3ca29c9538a1f';
const row=(alias,paths)=>({alias,calculation:alias,series:[],aggregates:paths.map(([path,value,interval=1])=>
  ({groups:[{key:'$workers.event.request.path',value:path}],value,count:1,interval,sampleInterval:interval}))});
const p1='/v1/orders/11111111-1111-4111-8111-111111111111';
const p2='/v1/orders/22222222-2222-4222-8222-222222222222';
const p3='/v1/auth/login?username=sensitive';
const cpu={run:{status:'COMPLETED'},calculations:[
  row('overLimit',[[p1,10,10],[p2,3,3],[p3,1]]),
  row('maxMs',[[p1,24],[p2,30],[p3,58]]),
  row('p95OverLimitMs',[[p1,19],[p2,27],[p3,48]])]};
test('private route IDs are always converted into fixed labels',()=>{
  for(const [path,expected] of [
    ['/health','health'],['/v1/site','public_site'],['/v1/auth/login?pwd=x','auth'],
    ['/v1/ai/generate','ai_generate'],['/v1/ai/requests/private','ai_request_status'],
    ['/v1/orders/private','credit_orders'],['/v1/subscriptions/orders/private','subscriptions'],
    ['/v1/admin/users/private','admin'],['/v1/boltutil/orders/private','boltutil'],
    ['/v1/extension/private','extension'],['/secret/username','other']
  ])assert.equal(routeCategory(path),expected);
});
test('read-only telemetry query is path aggregated, version pinned and over 10ms',()=>{
  const x=cpuQuery({from:1000,to:61000,script:'reply-copilot-api-production',version:VERSION});
  assert.equal(x.dry,true);assert.equal(x.view,'calculations');
  assert.deepEqual(x.parameters.groupBys,[{type:'string',value:'$workers.event.request.path'}]);
  assert.deepEqual(x.parameters.filters.map(y=>[y.key,y.value]),[
    ['$workers.scriptName','reply-copilot-api-production'],['$workers.eventType','fetch'],
    ['$workers.cpuTimeMs',10],['$workers.scriptVersion.id',VERSION]]);
});
test('CPU results merge paths into categories without falsely computing category P95',()=>{
  const x=summarize(cpu);
  assert.equal(x.status,'HOTSPOTS_OBSERVED');
  assert.deepEqual(x.groups.map(y=>y.category),['auth','credit_orders']);
  assert.equal(x.groups[1].estimatedAbove10,13);
  assert.equal(x.groups[1].maxMs,30);
  assert.equal(x.groups[1].worstPathP95Above10,27);
  assert.equal(x.groups[1].sampled,true);
});
test('no or invalid input telemetry must never certify Free',()=>{
  assert.equal(summarize({run:{status:'COMPLETED'},calculations:cpu.calculations.map(x=>({...x,aggregates:[]}))}).status,'INSUFFICIENT');
  assert.throws(()=>summarize({run:{status:'PENDING'},calculations:cpu.calculations}));
  assert.throws(()=>summarize({run:{status:'COMPLETED'},calculations:[cpu.calculations[0]]}));
});
test('production logs disabled produces explicit blocker and no query request',async()=>{
  let calls=0;
  const fetchImpl=async(url,options)=>{
    calls++;assert.ok(url.endsWith('/keys'));assert.equal(options.method,'POST');
    return {ok:true,json:async()=>({success:true,result:[{key:'$metadata.service'}]})};
  };
  const output=await run({args:['--expected-version',VERSION],env:{CLOUDFLARE_ACCOUNT_ID:ACCOUNT,CLOUDFLARE_API_TOKEN:'secret'},fetchImpl,now:100000000000});
  assert.equal(calls,1);
  assert.match(output,/INVOCATION_LOGS_UNAVAILABLE/);
  assert.doesNotMatch(output,/secret|cb5fc919|username/);
});
test('raw paths, query strings and credentials are not included in report',async()=>{
  let calls=0;
  const keys=['$workers.scriptName','$workers.cpuTimeMs','$workers.event.request.path','$workers.eventType','$workers.scriptVersion.id'];
  const fetchImpl=async(url)=>{calls++;return {ok:true,json:async()=>({success:true,result:url.endsWith('/keys')?keys.map(key=>({key})):cpu})};};
  const out=await run({args:['--expected-version',VERSION],env:{CLOUDFLARE_ACCOUNT_ID:ACCOUNT,CLOUDFLARE_API_TOKEN:'secret'},fetchImpl,now:100000000000});
  assert.equal(calls,2);assert.match(out,/credit_orders/);assert.match(out,/auth/);
  for(const privateText of ['11111111','22222222','username=sensitive','/v1/orders/','secret','cb5fc919'])
    assert.ok(!out.includes(privateText));
});
test('invalid inputs are rejected',()=>{
  for(const args of [['--minutes','1441'],['--minutes','0'],['--script','x;DROP'],['--expected-version','bad'],['--other','x']])
    assert.throws(()=>parseArgs(args));
  assert.throws(()=>cpuQuery({from:0,to:86400001,script:'x'}));
});
