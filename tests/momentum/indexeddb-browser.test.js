import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {withMomentumBrowser} from '../helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const js=buildSync({stdin:{contents:`import {MomentumStore,momentumReceiptPatch} from './services/creator-momentum.js';import {DEFAULT_MOMENTUM_CONFIG,localDayKey} from './domain/creator-momentum.js';import {diagnose} from './staging/momentum-background.js';window.M={diagnose,MomentumStore,momentumReceiptPatch,DEFAULT_MOMENTUM_CONFIG,localDayKey};window.momentumReady=true;`,resolveDir:process.cwd()},bundle:true,format:'iife',write:false}).outputFiles[0].text;
test('real IndexedDB: 1500 ACKs, concurrent replay, restart, accounts, OFF/free counting, stages, DND and cross-day',{timeout:60000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate,call})=>{
  const report=await evaluate(`(async()=>{
   const {MomentumStore,DEFAULT_MOMENTUM_CONFIG:base,localDayKey,momentumReceiptPatch}=M;window.clock=new Date(2026,10,6,10).getTime();
   window.config={...base,enabled:true};window.store=new MomentumStore({clock:()=>window.clock,random:()=>0});
   const event=(ownerId,requestId,policy=config)=>({ownerId,requestId,at:clock,day:localDayKey(clock),policy});
   await Promise.all(Array.from({length:1500},(_,i)=>store.ingest(event('A','request-'+i))));
   await Promise.all(Array.from({length:20},()=>store.ingest(event('A','request-0'))));
   const free=await store.view('A',config,{eligible:false,enabled:true,gate:true});
   await store.view('A',config,{eligible:true,enabled:true,arm:true});
   const on=await store.view('A',config,{eligible:true,gate:true});
   await store.confirmReminder('A',on.reminder);
   const replay=await store.view('A',config,{eligible:true,gate:true});await store.view('A',config,{eligible:true,dnd:true});
   window.store=new MomentumStore({clock:()=>window.clock,random:()=>0.99});const restart=await store.view('A',config,{eligible:true,gate:true});
   const b=await store.view('B',config,{eligible:true,gate:true});
   const data={...momentumReceiptPatch({ownerId:'B',input:{requestId:'recovered'},raw:'ack',completedAt:clock},config)};
   let failed=true;const storage={get:async()=>({...data}),remove:async k=>{if(failed){failed=false;throw Error('simulated interrupted delete');}delete data[k];}};
   try{await store.drain(storage);}catch{}await store.drain(storage);
   const recovered=await store.view('B',config,{eligible:true});
   const realTransaction=store.transaction.bind(store);store.transaction=(names,action)=>realTransaction(names,async tx=>{const value=await action(tx);tx.abort();return value;});
   let aborted=false;try{await store.ingest(event('atomic','retry'));}catch{aborted=true;}store.transaction=realTransaction;await store.ingest(event('atomic','retry'));const atomic=await store.view('atomic',config,{eligible:false});
   localStorage.setItem('restart-outbox',JSON.stringify(momentumReceiptPatch({ownerId:'restart',input:{requestId:'before-crash'},raw:'ack',completedAt:clock},config)));

   const small={...config,ranges:[[1,1],[2,2],[3,3]],version:'small-test-only'};
   await store.ingest(event('C','one',small));await store.view('C',small,{eligible:true,enabled:true,arm:true});const first=await store.view('C',small,{eligible:true,gate:true});
   await store.confirmReminder('C',first.reminder);
   await store.ingest(event('C','two',small));clock+=1000;const second=await store.view('C',small,{eligible:true,gate:true});
   await store.confirmReminder('C',second.reminder);
   await store.ingest(event('C','three',small));clock+=1000;const highest=await store.view('C',small,{eligible:true,gate:true});
   await store.confirmReminder('C',highest.reminder);
   clock+=1000;const rollback=await store.view('C',small,{eligible:true,gate:true});
   clock=new Date(2026,10,7,10).getTime();const tomorrow=await store.view('A',config,{eligible:true,gate:true});
   return {free,on,replay,restart,b,recovered,first,second,highest,rollback,tomorrow,aborted,atomic};
  })()`);
  assert.equal(report.free.count,1500);assert.equal(report.free.reminder,null);assert.equal(report.on.reminder.stage,1);assert.equal(report.replay.reminder.stage,2);assert.equal(report.restart.count,1500);assert.equal(report.restart.reminder,null);assert.equal(report.b.count,0);assert.equal(report.recovered.count,1);assert.equal(report.first.reminder.stage,1);assert.equal(report.second.reminder.stage,2);assert.equal(report.highest.reminder.stage,3);assert.equal(report.rollback.reminder,null);assert.equal(report.tomorrow.count,0);assert.equal(report.tomorrow.enabled,true);
  assert.equal(report.aborted,true);assert.equal(report.atomic.count,1,'aborted count and dedup roll back together');
  await call('Page.reload');for(let i=0;i<100;i++){if(await evaluate('Boolean(window.momentumReady&&window.M)'))break;await new Promise(r=>setTimeout(r,10));}
  const after=await evaluate(`(async()=>{const s=new M.MomentumStore({clock:()=>new Date(2026,10,6,12).getTime()});return s.view('A',{...M.DEFAULT_MOMENTUM_CONFIG,enabled:true},{eligible:true,gate:true});})()`);assert.equal(after.count,1500);assert.equal(after.reminder,null,'page reload keeps DND and consumed phase');
  const resumed=await evaluate(`(async()=>{const s=new M.MomentumStore({clock:()=>new Date(2026,10,6,12).getTime()}),data=JSON.parse(localStorage.getItem('restart-outbox'));await s.drain({get:async()=>data,remove:async k=>delete data[k]});return s.view('restart',M.DEFAULT_MOMENTUM_CONFIG,{eligible:false});})()`);assert.equal(resumed.count,1,'persisted ACK outbox survives page/worker restart before counting');
 });
});

test('visible-but-unconfirmed reminder survives beyond the former 10s lease, confirms once, and next stage is immediate',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
  const result=await evaluate(`(async()=>{
   const {MomentumStore,DEFAULT_MOMENTUM_CONFIG,localDayKey}=M;
   let now=new Date(2026,10,6,10).getTime();
   const policy={...DEFAULT_MOMENTUM_CONFIG,enabled:true,ranges:[[1,1],[2,2],[3,3]]};
   let store=new MomentumStore({clock:()=>now});
   await store.ingest({ownerId:'test',requestId:'one',day:localDayKey(now),at:now,policy});
   await store.view('test',policy,{eligible:true,enabled:true,arm:true});
   const first=(await store.view('test',policy,{eligible:true,gate:true})).reminder;
   const competing=(await store.view('test',policy,{eligible:true,gate:true})).reminder;
   now+=11000;
   store=new MomentumStore({clock:()=>now});
   const recovered=(await store.view('test',policy,{eligible:true,gate:true})).reminder;
   const beforeConfirm=await store.transaction(['days'],tx=>new Promise(resolve=>{const request=tx.objectStore('days').get(JSON.stringify(['test',localDayKey(now)]));request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);}), 'readonly');
   const ack=await store.confirmReminder('test',recovered);
   const repeatAck=await store.confirmReminder('test',recovered);
   await store.ingest({ownerId:'test',requestId:'two',day:localDayKey(now),at:now,policy});
   const second=(await store.view('test',policy,{eligible:true,gate:true})).reminder;
   await store.view('test',policy,{eligible:true,dnd:true});
   const secondAck=await store.confirmReminder('test',second);
   const lateDuplicate=await store.confirmReminder('test',recovered);
   return {first,competing,recovered,beforeConfirm,ack,repeatAck,second,secondAck,lateDuplicate,dndAck:await store.confirmReminder('test',second)};
  })()`);
  assert.equal(result.first.stage,1);
  assert.equal(result.competing?.lease,result.first.lease);
  assert.equal(result.recovered?.stage,1);
  assert.equal(result.first.lease,result.recovered.lease);
  assert.equal(result.beforeConfirm.shownThrough,0,'visibility alone must not complete a stage');
  assert.equal(result.beforeConfirm.reminderCount,0,'visibility alone must not consume the daily cap');
  assert.equal(result.beforeConfirm.pendingReminder.stage,1,'the stage remains queued until explicit user confirmation');
  assert.equal(result.ack.confirmed,true);
  assert.equal(result.repeatAck.confirmed,true);
  assert.equal(result.second.stage,2);
  assert.equal(result.secondAck.confirmed,false,'DND removes the currently queued second stage');
  assert.equal(result.lateDuplicate.confirmed,true,'a slow duplicate tab may acknowledge an already delivered earlier stage without consuming another stage');
  assert.equal(result.lateDuplicate.pending,false);
  assert.equal(result.dndAck.confirmed,false);
 });
});

test('diagnostics expose frozen daily strategy and next-day adoption without mutating records', {timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
  const out=await evaluate(`(async()=>{
   let now=new Date(2026,10,7,12).getTime();
   const {MomentumStore,localDayKey,DEFAULT_MOMENTUM_CONFIG,diagnose}=M;
   const old={...DEFAULT_MOMENTUM_CONFIG,enabled:true,version:'old'};
   const fresh={...old,version:'new',ranges:[[3,7],[8,10],[11,13]]};
   const store=new MomentumStore({clock:()=>now,random:()=>0});
   const add=async n=>{for(let i=0;i<n;i++)await store.ingest({ownerId:'A',requestId:'ack-'+localDayKey(now)+'-'+i,day:localDayKey(now),at:now,policy:old});};
   await add(7);await store.view('A',fresh,{eligible:true,enabled:true,claim:true});
   const state={eligible:true,available:true,policy:fresh};
   const storage={get:async()=>({'creatorMomentumDelivery:A:queued':true,'creatorMomentumDelivery:B:other':true})};
   const inspect=()=>diagnose(store,storage,'A',state,now);
   const today=await inspect();
   const todayAgain=await inspect();
   now=new Date(2026,10,8,12).getTime();
   await store.view('A',fresh,{eligible:true,claim:true});
   const tomorrow=await inspect();
   return {today,todayAgain,tomorrow};
  })()`);
  assert.equal(out.today.oldPolicy,true);
  assert.equal(out.today.ackCount,7);
  assert.equal(out.today.queuedAcks,1);
  assert.equal(out.today.thresholds[0],500);
  assert.equal(out.today.reason,'尚未达到阶段');
  assert.deepEqual(out.today,out.todayAgain);
  assert.equal(out.tomorrow.date,out.today.nextLocalDate);
  assert.equal(out.tomorrow.dayVersion,'new');
  assert.equal(out.tomorrow.thresholds[0],3);
 });
});
