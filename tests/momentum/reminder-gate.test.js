import test from 'node:test';
import assert from 'node:assert/strict';
import {createMomentumView} from '../../services/momentum-view.js';
import {DEFAULT_MOMENTUM_CONFIG} from '../../domain/creator-momentum.js';
import {momentumGateKey} from '../../services/creator-momentum.js';

function fixture(){
 let now=1000,requests=0,pending=null,confirmed=0,lastViewOptions=null;
 const token='test-token',owner='account-a',saved=new Map([[momentumGateKey(owner),true]]);
 const accountStates={cachedToken:token,peekState:()=>({user:{userId:owner},status:'credits_available'})};
 const client={token:async()=>token,request:async()=>{requests++;return {features:{interactionMomentum:{ownerId:owner,eligible:true,policy:{...DEFAULT_MOMENTUM_CONFIG,enabled:true,ranges:[[1,1],[2,2],[3,3]]}}}};}};
 const momentum={snapshot:async()=>({enabled:true}),drain:async()=>true,view:async(_owner,_policy,options)=>{
   lastViewOptions=options;
   if(options.dnd){pending=null;return {enabled:true,dnd:true,reminderPending:false};}
   if(options.arm&&!pending)pending={id:'2026-11-08:1',stage:1,lease:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',state:'pending'};
   if(options.gate&&pending)pending={...pending,state:'presenting'};
   return {enabled:true,dnd:false,reminderPending:Boolean(pending),...(options.gate?{reminder:pending}: {})};
  },confirmReminder:async()=>{confirmed++;pending={id:'2026-11-08:2',stage:2,lease:'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',state:'pending'};return {confirmed:true,pending:true};}};
 const storage={get:async key=>Object.fromEntries(key.map(k=>[k,saved.get(k)])),set:async value=>{for(const [k,v]of Object.entries(value))saved.set(k,v);},remove:async key=>saved.delete(key)};
 const view=createMomentumView({accountStates,client,momentum,storage,broadcast:async()=>{},clock:()=>now});
 return {view,saved,owner,requests:()=>requests,confirmed:()=>confirmed,lastViewOptions:()=>lastViewOptions,advance(ms){now+=ms;}};
}

test('ACK arms a durable reminder without displaying it; next reply gate is local and explicit confirmation advances one stage',async()=>{
 const f=fixture();
 await f.view({refresh:true});
 const armed=await f.view({arm:true});
 assert.equal(armed.reminder,undefined,'ACK must queue but not display the reminder');
 assert.equal(armed.enabled,true);
 assert.equal(f.saved.get(momentumGateKey(f.owner)),true);
 const before=f.requests();
 const gate=await f.view({gate:true});
 assert.equal(gate.reminder.stage,1);
 assert.equal(gate.reminder.state,'presenting');
 assert.equal(f.requests(),before,'gate check reuses the fresh account proof');
 const result=await f.view({presented:{id:gate.reminder.id,lease:gate.reminder.lease}});
 assert.equal(result.confirmed,true);
 assert.equal(result.pending,true);
 assert.equal(f.confirmed(),1);
 assert.equal(f.saved.get(momentumGateKey(f.owner)),true,'next eligible stage remains queued');
 const next=await f.view({gate:true});
 assert.equal(next.reminder.stage,2);
});

test('normal request without a pending candidate never requests the feature or claims a reminder',async()=>{
 const f=fixture();
 const result=await f.view({});
 assert.equal(result.reminder,undefined);
 assert.equal(f.requests(),0);
});

test('an exceptional gate refreshes an expired entitlement proof, while confirming the visible reminder uses its authorized snapshot',async()=>{
 const f=fixture();
 await f.view({refresh:true});
 await f.view({arm:true});
 f.advance(300_001);
 const gate=await f.view({gate:true});
 assert.equal(f.requests(),2,'only the pending-gate recovery path refreshes the expired proof');
 assert.equal(gate.reminder.stage,1);
 f.advance(600_001);
 const before=f.requests();
 const confirmed=await f.view({presented:{id:gate.reminder.id,lease:gate.reminder.lease}});
 assert.equal(confirmed.confirmed,true);
 assert.equal(f.requests(),before,'confirming a reminder already shown does not require a second entitlement round trip');
});

test('choosing today DND never turns the monitoring preference on as a side effect',async()=>{
 const f=fixture();
 await f.view({refresh:true});
 const gate=await f.view({arm:true});
 const shown=await f.view({gate:true});
 await f.view({presented:{id:shown.reminder.id,lease:shown.reminder.lease},dnd:true});
 assert.equal(f.lastViewOptions().enabled,undefined);
 assert.equal(f.lastViewOptions().dnd,true);
});
