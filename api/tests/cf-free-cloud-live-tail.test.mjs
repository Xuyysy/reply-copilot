import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeTailEvent,summarizeTail,openPilotTail} from '../scripts/cf-free-cloud-live-tail.mjs';
const NAME='xrh-cf-free-cpu-pilot-20261120',ID='307563e1fa86940ac46ca4dd78f1f12a',TOKEN='synthetic-secret-token-not-real-2026';
test('only exact pilot and fixed marker are eligible for CPU evidence',()=>{
  const raw={scriptName:NAME,logs:[{message:['XRH_PILOT_CPU','do_rpc',210000]}],cpuTime:815.25,wallTime:920,outcome:'ok',entrypoint:'PasswordVerifierDO',event:{headers:{Authorization:TOKEN}}};
  const row=sanitizeTailEvent(raw);
  assert.deepEqual(row,{mode:'do_rpc',rounds:210000,cpuMs:815.25,wallMs:920,outcome:'ok',entrypoint:'PasswordVerifierDO'});
  assert.equal(sanitizeTailEvent({...raw,scriptName:'production'}),null);
  assert.equal(sanitizeTailEvent({...raw,logs:[{message:['XRH_PILOT_CPU','http',210001]}]}),null);
  assert.equal(sanitizeTailEvent({...raw,cpuTime:undefined}).cpuMs,null);
  assert.equal(JSON.stringify(summarizeTail([row])).includes(TOKEN),false);
  assert.equal(summarizeTail([row]).groups[0].maxCpuMs,815.25);
  assert.equal(summarizeTail([]).status,'NO_MATCHED_EVENTS');
});
test('tail refuses production account and only creates/deletes scoped session; websocket gets no API credential',async()=>{
  const calls=[];
  class Socket extends EventTarget{
    constructor(url,protocol){super();assert.equal(url,'wss://tail.example.test/session');assert.equal(protocol,'trace-v1');queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
    send(data){assert.deepEqual(JSON.parse(data),{debug:false});}
    close(){}
  }
  const fetchImpl=async(url,init)=>{calls.push({url,method:init.method});assert.equal(init.redirect,'error');return Response.json(init.method==='POST'?{success:true,result:{id:'a'.repeat(32),url:'wss://tail.example.test/session'}}:{success:true});};
  await assert.rejects(()=>openPilotTail({accountId:'c'.repeat(32),token:TOKEN,fetchImpl,WebSocketImpl:Socket}));
  const tail=await openPilotTail({accountId:ID,token:TOKEN,fetchImpl,WebSocketImpl:Socket});
  assert.equal(tail.report().status,'NO_MATCHED_EVENTS');await tail.close();
  assert.deepEqual(calls.map(x=>x.method),['POST','DELETE']);assert.ok(calls.every(x=>x.url.includes('/accounts/'+ID+'/workers/scripts/'+NAME+'/tails')));
});
