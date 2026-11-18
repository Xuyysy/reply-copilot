import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {createAccountPrewarmer} from "../services/account-prewarm.js";

test("account prewarm coalesces concurrent foreground tabs and respects the cooldown", async () => {
  let time = 1000, accountCalls = 0, prefCalls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const w = createAccountPrewarmer({
    now: () => time,
    readAccount: async () => { accountCalls++; await gate; return {source:"server"}; },
    readPreferences: async () => { prefCalls++; return {showFloatingWindow:true}; },
  });
  const first=w.prime(),same=w.prime();
  assert.equal(first,same,"concurrent tab events share a single Promise");
  await Promise.resolve();
  assert.equal(accountCalls,1);
  release();
  assert.equal((await first).kind,"prepared");
  assert.equal((await same).kind,"prepared");
  assert.equal(prefCalls,1);
  assert.equal((await w.prime()).kind,"cooldown");
  time+=30_001;
  assert.equal((await w.prime()).kind,"prepared");
  assert.equal(accountCalls,2);
  w.reset();
  assert.equal((await w.prime()).kind,"prepared");
  assert.equal(accountCalls,3);
});

test("account prewarm safely handles errors without extra attempts during cooldown",async()=>{
  let calls=0,clock=0;
  const w=createAccountPrewarmer({now:()=>clock,readAccount:()=>{calls++;throw Error("offline");},readPreferences:()=>({})});
  assert.equal((await w.prime()).kind,"failed");
  assert.equal((await w.prime()).kind,"cooldown");
  assert.equal(calls,1);
  clock+=31_000;
  assert.equal((await w.prime()).kind,"failed");
  assert.equal(calls,2);
});

const script=readFileSync(new URL("../content/coldstart-prewarm.js",import.meta.url),"utf8");
function fakePage({staging=true,focused=true,officialProduction=false}={}) {
  const docEvents={},windowEvents={},sent=[],state={now:1000,focused,visible:true};
  const window={addEventListener:(name,fn)=>{windowEvents[name]=fn}};
  window.top=window;
  const doc={get visibilityState(){return state.visible?"visible":"hidden";},
    hasFocus:()=>state.focused,
    addEventListener:(name,fn)=>{docEvents[name]=fn}};
  const chrome={runtime:{id:officialProduction?"fgfjajofkapebgphfidblngcjomkbdaj":"mock-extension",getManifest:()=>({background:{service_worker:staging?"staging/service-worker.js":"background/service-worker.js"}}),
    sendMessage:async msg=>{sent.push(msg);return {ok:true,kind:"prepared",elapsedMs:6,workerUptimeMs:25}}}};
  const sandbox={window,document:doc,chrome,location:{href:"https://x.com/home"},Date:{now:()=>state.now},
    performance:{now:()=>state.now},queueMicrotask:fn=>Promise.resolve().then(fn),
    ZaneReplyCopilotContent:{replyDetector:{findReplyControl:target=>target?.isReply?{closest:s=>s==="article"?{}:null}:null}}};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(script,sandbox);
  return {sent,docEvents,windowEvents,state,sandbox,
    intent:(name="pointerover",trusted=true)=>docEvents[name]({isTrusted:trusted,target:{isReply:true}}),
    flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test("Staging X prewarms once on startup and only on trusted human Reply intent thereafter",async()=>{
  const f=fakePage();await f.flush();
  assert.equal(f.sent.length,1);
  assert.deepEqual(Object.keys(f.sent[0]),["type"]);
  assert.equal(f.sent[0].type,"REPLY_COPILOT_PREWARM_ACCOUNT");
  f.intent();f.intent("pointerdown");f.intent("focusin");await f.flush();
  assert.equal(f.sent.length,1,"rapid pointer events must not cause network floods");
  f.state.now+=31_000;
  f.intent("pointerover",false);await f.flush();
  assert.equal(f.sent.length,1,"synthetic pointer event cannot start a prewarm");
  f.intent();await f.flush();
  assert.equal(f.sent.length,2);
  assert.equal(f.sandbox.replyCopilotColdStartReport().prepared,2);
  assert.equal(f.sandbox.replyCopilotColdStartReport().lastWorkerUptimeMs,25);
});
test("staging hidden/unfocused tabs do not prewarm, foreground return does",async()=>{
  const f=fakePage({focused:false});await f.flush();
  assert.equal(f.sent.length,0);
  f.state.now+=31_000;f.state.focused=true;
  f.windowEvents.focus();await f.flush();assert.equal(f.sent.length,1);
  f.state.now+=31_000;f.state.visible=false;f.docEvents.visibilitychange();await f.flush();
  assert.equal(f.sent.length,1);
  f.state.visible=true;f.docEvents.visibilitychange();await f.flush();
  assert.equal(f.sent.length,2);
});
test("verified Production store identity enables only foreground read-only prewarm",async()=>{
  const f=fakePage({staging:false,officialProduction:true});await f.flush();
  assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].type,"REPLY_COPILOT_PREWARM_ACCOUNT");
  f.state.now+=31_000;f.intent("pointerdown",false);await f.flush();
  assert.equal(f.sent.length,1,"untrusted clicks cannot trigger prewarm");
  f.intent("pointerdown");await f.flush();assert.equal(f.sent.length,2);
});
test("unknown unpacked/developer identities must never enable Production prewarm",async()=>{
  const f=fakePage({staging:false});await f.flush();
  assert.equal(f.sent.length,0);
  assert.equal(f.docEvents.pointerover,undefined);
});
