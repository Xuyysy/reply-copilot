import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountWorkbenchController} from '../staging/account-workbench-background.js';
const root='chrome-extension://fixture/';
function fixture(){
 const data={},tabs=new Map([[1,{id:1}]]),created=[],sent=[];let serial=10,owner='111',handle='alice';
 const c={runtime:{id:'fixture',getURL:p=>root+p},storage:{session:{get:async k=>({[k]:data[k]}),set:async v=>Object.assign(data,v)}},tabs:{query:async()=>[{id:1}],sendMessage:async(id,m)=>{sent.push(m.type);assert.equal(id,1);return {ok:true,value:{ownerUserId:owner,handle}};},get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id)},create:async o=>{const t={id:++serial,...o};created.push(t);tabs.set(t.id,t);return t;},update:async()=>({})}};
 const controller=createAccountWorkbenchController({chromeApi:c,openDB:()=>{throw Error('no DB access expected');}});
 const dispatch=(feature,action,sender,extra={})=>controller.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature,action,...extra},sender);
 const side={id:'fixture',url:root+'sidepanel/sidepanel.html'};
 const page=(feature,id)=>({id:'fixture',tab:{id},url:root+'staging/'+feature+'-workbench.html'});
 return {dispatch,side,page,created,sent,c,change:()=>{owner='222';handle='bob';},data};
}
test('independent entry pages reuse matching account, never open X or request data',async()=>{
 const f=fixture();
 await f.dispatch('interaction','open',f.side);await f.dispatch('follow','open',f.side);await f.dispatch('interaction','open',f.side);
 assert.deepEqual(f.created.map(t=>t.url),[root+'staging/interaction-workbench.html',root+'staging/follow-workbench.html']);
 const i=await f.dispatch('interaction','identity',f.page('interaction',11));assert.equal(i.ownerUserId,'111');
 await assert.rejects(f.dispatch('interaction','sync',f.page('interaction',11),{authorized:true}),/source_unavailable/);
 assert.ok(f.sent.every(t=>t==='XRH_STAGING_WORKBENCH_IDENTITY'));
 await assert.rejects(f.dispatch('interaction','identity',f.page('interaction',12)),/invalid_context/);
 await assert.rejects(f.dispatch('follow','open',{id:'external',url:'https://x.com/'}),/invalid_context/);
 f.change();
 await assert.rejects(f.dispatch('interaction','identity',f.page('interaction',11)),/identity_changed/);
 await f.dispatch('interaction','open',f.side);
 assert.equal(f.created.length,3);
 await assert.rejects(f.dispatch('interaction','identity',f.page('interaction',11)),/invalid_context/);
});

test('background unavailable source is fail-closed, repeated worker creation keeps the tab binding',async()=>{
 const f=fixture();await f.dispatch('interaction','open',f.side);
 const c=createAccountWorkbenchController({chromeApi:f.c,openDB:()=>{throw Error('no database');}});
 const page=f.page('interaction',11);
 const i=await c.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action:'identity'},page);
 assert.equal(i.ownerUserId,'111');
 await assert.rejects(c.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action:'sync',authorized:true},page),/source_unavailable/);
 assert.equal(f.created.length,1);
});

test('schedule interval is owner-scoped preference only; never enables live work',async()=>{
 const f=fixture();await f.dispatch('interaction','open',f.side);const page=f.page('interaction',11);
 const read=()=>f.dispatch('interaction','schedule-preferences',page);
 assert.deepEqual(await read(),{intervalMinutes:60,enabled:false,reason:'source_unverified'});
 await f.dispatch('interaction','schedule-interval',page,{intervalMinutes:30,enabled:true});
 assert.deepEqual(await read(),{intervalMinutes:30,enabled:false,reason:'source_unverified'});
 await assert.rejects(f.dispatch('interaction','schedule-interval',page,{intervalMinutes:1}),/invalid_context/);
 await assert.rejects(f.dispatch('interaction','schedule-enable',page,{authorized:true}),/invalid_context/);
 f.change();await assert.rejects(read(),/identity_changed/);await f.dispatch('interaction','open',f.side);
 assert.equal((await f.dispatch('interaction','schedule-preferences',f.page('interaction',12))).intervalMinutes,60);
 assert.ok(f.sent.every(t=>t==='XRH_STAGING_WORKBENCH_IDENTITY'));
});

test('a view requested for the old binding cannot proceed after same-owner rebinding while reading task state',async()=>{
 const f=fixture();await f.dispatch('interaction','open',f.side);
 const original=f.c.storage.session.get;let reached,release;
 const ready=new Promise(r=>reached=r);
 f.c.storage.session.get=async key=>{if(key==='xrh-interaction-task-111'){reached();await new Promise(r=>release=r);}return original(key);};
 const view=f.dispatch('interaction','view',f.page('interaction',11));const rejected=assert.rejects(view,/identity_changed/);
 await ready;
 const b=f.data['xrh-workbench-interaction'];f.data['xrh-workbench-interaction']={...b,bindingId:'new-binding'};
 release();await rejected;
});
