import test from 'node:test';
import assert from 'node:assert/strict';
import {registerMomentumTesting} from '../../staging/momentum-background.js';

test('preview routes to the originating window without reading restricted tab URLs', async()=>{
  const previous=globalThis.chrome;
  let handle, sent, query, answer={ok:true}, active={id:17};
  const panel='chrome-extension://fixture/sidepanel/sidepanel.html';
  globalThis.chrome={
    runtime:{id:'fixture',getURL:()=>panel,onMessage:{addListener(listener){handle=listener;}}},
    tabs:{
      async query(options){query=options;return active?[active]:[];},
      async sendMessage(id,message,options){sent={id,message,options};if(answer instanceof Error)throw answer;return answer;}
    }
  };
  try {
    registerMomentumTesting({accountClient:{token:async()=> 'token'},
      accountStates:{cachedToken:'token',peekState:()=>({user:{userId:'fixture'}})},
      momentumView:async()=>({available:true,policy:{titleZh:'标题',bodyZh:'正文'}})});
    const send=(windowId=4,sender={id:'fixture',url:panel})=>new Promise(resolve=>{
      if(!handle({type:'MOMENTUM_STAGING_PREVIEW',stage:2,windowId},sender,resolve))resolve(undefined);
    });
    assert.deepEqual(await send(),{ok:true});
    assert.deepEqual(query,{active:true,windowId:4});
    assert.deepEqual(sent,{id:17,message:{type:'MOMENTUM_STAGING_SHOW',sample:{stage:2,titleZh:'标题',bodyZh:'正文'}},options:{frameId:0}});
    assert.match((await send(3,{id:'fixture',url:panel,tab:{windowId:4}})).error,/无法确定/);
    assert.equal(await send(4,{id:'fixture',url:'https://x.com/'}),undefined);
    active={id:22,url:'https://example.test/'};
    assert.match((await send()).error,/不是 X/);
    active={id:22};answer=Error('no receiver');
    assert.match((await send()).error,/未响应/);
    answer={ok:false,error:'请先打开回复框'};
    assert.match((await send()).error,/回复框/);
    active=null;
    assert.match((await send()).error,/无法确定/);
  } finally {globalThis.chrome=previous;}
});

test('next-reply gate simulation is routed to active X tab without touching momentum data',async()=>{
 const previous=globalThis.chrome;let handle,sent;
 const panel='chrome-extension://fixture/sidepanel/sidepanel.html';
 globalThis.chrome={runtime:{id:'fixture',getURL:()=>panel,onMessage:{addListener(listener){handle=listener;}}},tabs:{async query(){return [{id:8}]},async sendMessage(id,message,options){sent={id,message,options};return {ok:true,armed:true};}}};
 try{
  let dataReads=0;
  registerMomentumTesting({accountClient:{token:async()=>'token'},accountStates:{cachedToken:'token',peekState:()=>({user:{userId:'fixture'}})},momentumView:async()=>{dataReads++;return {available:true,policy:{titleZh:'后台标题',bodyZh:'后台正文'}};},momentum:{transaction(){throw Error('diagnostic must not be read');}},});
  const result=await new Promise(resolve=>handle({type:'MOMENTUM_STAGING_ARM_NEXT_REPLY',stage:3,windowId:4},{id:'fixture',url:panel},resolve));
  assert.deepEqual(result,{ok:true,armed:true});
  assert.deepEqual(sent,{id:8,message:{type:'MOMENTUM_STAGING_ARM_NEXT_REPLY',sample:{stage:3,titleZh:'后台标题',bodyZh:'后台正文'}},options:{frameId:0}});
  assert.equal(dataReads,1,'only saved admin copy and entitlement context are read');
 }finally{globalThis.chrome=previous;}
});
