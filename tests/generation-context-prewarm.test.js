import test from "node:test";
import assert from "node:assert/strict";
import {createGenerationContextPrewarmer} from "../services/generation-context-prewarm.js";
test("concurrent callers share one prepared input and obey TTL/invalidation",async()=>{
 let time=10,calls=0;
 const cache=createGenerationContextPrewarmer({now:()=>time,ttlMs:60_000,read:async()=>({version:++calls})});
 const [a,b]=await Promise.all([cache.get(),cache.get()]);
 assert.equal(a.version,1);assert.equal(b.version,1);assert.equal(calls,1);
 time+=59_999;assert.equal((await cache.get()).version,1);
 time+=2;assert.equal((await cache.get()).version,2);
 cache.invalidate();assert.equal((await cache.get()).version,3);
});
test("invalidated in-flight read cannot repopulate cache",async()=>{
 let release,calls=0;
 const old=new Promise(resolve=>{release=resolve;});
 const cache=createGenerationContextPrewarmer({read:async()=>{calls++;return calls===1?old:{version:calls};}});
 const pending=cache.get();await Promise.resolve();
 cache.invalidate();
 const fresh=await cache.get();
 assert.equal(fresh.version,2);
 release({version:1});assert.equal((await pending).version,1);
 assert.equal((await cache.get()).version,2);
 assert.equal(calls,2);
});
test("reader error is retryable and never stores failed input",async()=>{
 let n=0;
 const c=createGenerationContextPrewarmer({read:()=>{if(++n===1)throw Error("temporary");return ["fresh"];}});
 await assert.rejects(c.get(),/temporary/);
 assert.deepEqual(await c.get(),["fresh"]);assert.equal(n,2);
});
