import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {withMomentumBrowser} from '../helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const js=buildSync({stdin:{contents:`import {MomentumStore,momentumReceiptPatch} from './services/creator-momentum.js';import {DEFAULT_MOMENTUM_CONFIG,localDayKey} from './domain/creator-momentum.js';window.M={MomentumStore,momentumReceiptPatch,DEFAULT_MOMENTUM_CONFIG,localDayKey};window.momentumReady=true;`,resolveDir:process.cwd()},bundle:true,format:'iife',write:false}).outputFiles[0].text;
test('real IndexedDB: 1500 ACKs, concurrent replay, restart, accounts, OFF/free counting, stages, DND and cross-day',{timeout:60000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate,call})=>{
  const report=await evaluate(`(async()=>{
   const {MomentumStore,DEFAULT_MOMENTUM_CONFIG:base,localDayKey,momentumReceiptPatch}=M;window.clock=new Date(2026,10,6,10).getTime();
   window.config={...base,enabled:true};window.store=new MomentumStore({clock:()=>window.clock,random:()=>0});
   const event=(ownerId,requestId,policy=config)=>({ownerId,requestId,at:clock,day:localDayKey(clock),policy});
   await Promise.all(Array.from({length:1500},(_,i)=>store.ingest(event('A','request-'+i))));
   await Promise.all(Array.from({length:20},()=>store.ingest(event('A','request-0'))));
   const free=await store.view('A',config,{eligible:false,enabled:true,claim:true});
   const on=await store.view('A',config,{eligible:true,enabled:true,claim:true});
   const replay=await store.view('A',config,{eligible:true,claim:true});await store.view('A',config,{eligible:true,dnd:true});
   window.store=new MomentumStore({clock:()=>window.clock,random:()=>0.99});const restart=await store.view('A',config,{eligible:true,claim:true});
   const b=await store.view('B',config,{eligible:true,claim:true});
   const data={...momentumReceiptPatch({ownerId:'B',input:{requestId:'recovered'},raw:'ack',completedAt:clock},config)};
   let failed=true;const storage={get:async()=>({...data}),remove:async k=>{if(failed){failed=false;throw Error('simulated interrupted delete');}delete data[k];}};
   try{await store.drain(storage);}catch{}await store.drain(storage);
   const recovered=await store.view('B',config,{eligible:true});
   const realTransaction=store.transaction.bind(store);store.transaction=(names,action)=>realTransaction(names,async tx=>{const value=await action(tx);tx.abort();return value;});
   let aborted=false;try{await store.ingest(event('atomic','retry'));}catch{aborted=true;}store.transaction=realTransaction;await store.ingest(event('atomic','retry'));const atomic=await store.view('atomic',config,{eligible:false});
   localStorage.setItem('restart-outbox',JSON.stringify(momentumReceiptPatch({ownerId:'restart',input:{requestId:'before-crash'},raw:'ack',completedAt:clock},config)));

   const small={...config,ranges:[[1,1],[2,2],[3,3]],version:'small-test-only'};
   await store.ingest(event('C','one',small));const first=await store.view('C',small,{eligible:true,enabled:true,claim:true});
   await store.ingest(event('C','two',small));clock+=89*60000;const cooling=await store.view('C',small,{eligible:true,claim:true});
   await store.ingest(event('C','three',small));clock+=60000;const highest=await store.view('C',small,{eligible:true,claim:true});
   clock-=1000;const rollback=await store.view('C',small,{eligible:true,claim:true});
   clock=new Date(2026,10,7,10).getTime();const tomorrow=await store.view('A',config,{eligible:true,claim:true});
   return {free,on,replay,restart,b,recovered,first,cooling,highest,rollback,tomorrow,aborted,atomic};
  })()`);
  assert.equal(report.free.count,1500);assert.equal(report.free.reminder,null);assert.equal(report.on.reminder.stage,3);assert.equal(report.replay.reminder,null);assert.equal(report.restart.count,1500);assert.equal(report.restart.reminder,null);assert.equal(report.b.count,0);assert.equal(report.recovered.count,1);assert.equal(report.first.reminder.stage,1);assert.equal(report.cooling.reminder,null);assert.equal(report.highest.reminder.stage,3);assert.equal(report.rollback.reminder,null);assert.equal(report.tomorrow.count,0);assert.equal(report.tomorrow.enabled,true);
  assert.equal(report.aborted,true);assert.equal(report.atomic.count,1,'aborted count and dedup roll back together');
  await call('Page.reload');for(let i=0;i<100;i++){if(await evaluate('Boolean(window.momentumReady&&window.M)'))break;await new Promise(r=>setTimeout(r,10));}
  const after=await evaluate(`(async()=>{const s=new M.MomentumStore({clock:()=>new Date(2026,10,6,12).getTime()});return s.view('A',{...M.DEFAULT_MOMENTUM_CONFIG,enabled:true},{eligible:true,claim:true});})()`);assert.equal(after.count,1500);assert.equal(after.reminder,null,'page reload keeps DND and consumed phase');
  const resumed=await evaluate(`(async()=>{const s=new M.MomentumStore({clock:()=>new Date(2026,10,6,12).getTime()}),data=JSON.parse(localStorage.getItem('restart-outbox'));await s.drain({get:async()=>data,remove:async k=>delete data[k]});return s.view('restart',M.DEFAULT_MOMENTUM_CONFIG,{eligible:false});})()`);assert.equal(resumed.count,1,'persisted ACK outbox survives page/worker restart before counting');
 });
});
