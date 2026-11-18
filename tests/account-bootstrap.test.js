import test from "node:test";
import assert from "node:assert/strict";
import {AccountStateService} from "../services/account-state-service.js";
import {AccountClient} from "../services/account-client.js";
const stage={channel:"staging",hostedApiUrl:"https://api-staging.example.test",websiteUrl:"https://staging.example.test",allowedHttpHosts:[]};
const sample={user:{userId:"account-A",username:"tester",email:"test@example.test",status:"active"},status:"credits_available",
 entitlement:{entitlementStatus:"active"},quota:{freeRemaining:200,paidRemaining:0,totalRemaining:200},subscription:{status:"none",remainingToday:0}};
const legacy=()=>({user:sample.user,status:sample.status,entitlement:sample.entitlement,quota:sample.quota,subscription:sample.subscription});
test("Staging prepares a single authenticated bootstrap without three legacy GETs",async()=>{
 let bootstrap=0,old=0;
 const client={token:async()=> "a".repeat(64),fetchBootstrap:async()=>{bootstrap++;return sample;},
 fetchCurrentUser:async()=>{old++;return {user:sample.user};},fetchEntitlement:async()=>{old++;return {status:sample.status,entitlement:sample.entitlement};},
 fetchUsage:async()=>{old++;return {quota:sample.quota,subscription:sample.subscription};}};
 const cache=new AccountStateService({config:stage,client});
 const state=await cache.getState();
 assert.equal(state.status,"credits_available");assert.equal(state.user.userId,"account-A");
 assert.equal(bootstrap,1);assert.equal(old,0);
 assert.equal((await cache.getState()).status,"credits_available");assert.equal(bootstrap,1);
});
test("Only legacy 404/NOT_FOUND falls back to existing three parallel reads",async()=>{
 let boot=0,old=0;
 const client={token:async()=> "a".repeat(64),fetchBootstrap:async()=>{boot++;throw Object.assign(Error("not found"),{status:404,code:"NOT_FOUND"});},
 fetchCurrentUser:async()=>{old++;return {user:sample.user};},fetchEntitlement:async()=>{old++;return {status:sample.status,entitlement:sample.entitlement};},
 fetchUsage:async()=>{old++;return {quota:sample.quota,subscription:sample.subscription};}};
 assert.equal((await new AccountStateService({config:stage,client}).getState()).status,"credits_available");
 assert.equal(boot,1);assert.equal(old,3);
 const account=new AccountStateService({config:stage,client});
 await account.getState();account.invalidate();await account.getState();
 assert.equal(boot,2,"a single legacy miss is remembered for this Worker instance");
 assert.equal(old,9,"subsequent cache refresh uses legacy API directly");
});
test("Auth/network/malformed bootstrap never silently falls back",async()=>{
 let old=0;
 for(const [status,code,expected] of [[401,"AUTH_REQUIRED","auth_expired"],[503,"NETWORK_ERROR","auth_unavailable"],[200,"MALFORMED","auth_unavailable"]]){
 const client={token:async()=> "a".repeat(64),fetchBootstrap:async()=>{
   if(code==="MALFORMED")return {status:"credits_available",user:{userId:"account-A"}};
   throw Object.assign(Error(code),{status,code});},
 fetchCurrentUser:async()=>{old++;throw Error("unexpected legacy");},fetchEntitlement:async()=>{old++;throw Error("unexpected legacy");},
 fetchUsage:async()=>{old++;throw Error("unexpected legacy");}};
 const s=new AccountStateService({config:stage,client});
 assert.equal((await s.getState()).status,expected);
 }assert.equal(old,0);
});
test("Production now uses the single authenticated bootstrap and not legacy GETs",async()=>{
 let old=0,boot=0;
 const client={token:async()=> "a".repeat(64),fetchBootstrap:async()=>{boot++;return sample;},
 fetchCurrentUser:async()=>{old++;return {user:sample.user};},fetchEntitlement:async()=>{old++;return {status:sample.status,entitlement:sample.entitlement};},
 fetchUsage:async()=>{old++;return {quota:sample.quota,subscription:sample.subscription};}};
 assert.equal((await new AccountStateService({config:{...stage,channel:"production"},client}).getState()).status,"credits_available");
 assert.equal(boot,1);assert.equal(old,0);
});
test("Production legacy API 404 fails over once without repeated extra requests",async()=>{
 let boot=0,old=0;
 const client={token:async()=> "a".repeat(64),fetchBootstrap:async()=>{boot++;throw Object.assign(Error("legacy"),{status:404,code:"NOT_FOUND"});},
 fetchCurrentUser:async()=>{old++;return {user:sample.user};},fetchEntitlement:async()=>{old++;return {status:sample.status,entitlement:sample.entitlement};},
 fetchUsage:async()=>{old++;return {quota:sample.quota,subscription:sample.subscription};}};
 const store=new AccountStateService({config:{...stage,channel:"production"},client});
 assert.equal((await store.getState()).status,"credits_available");store.invalidate();
 assert.equal((await store.getState()).status,"credits_available");
 assert.equal(boot,1);assert.equal(old,6);
});
test("bootstrap client uses only fixed origin and bearer header, never URL token",async()=>{
 const calls=[],storage={get:async k=>({[k]:"a".repeat(64)})};
 const client=new AccountClient({config:stage,storage,fetchImpl:async(url,options)=>{
 calls.push({url,authorization:options.headers.Authorization});
 return {ok:true,json:async()=>sample};
 }});
 const result=await client.fetchBootstrap();
 assert.equal(result.user.userId,"account-A");
 assert.deepEqual(calls.map(x=>x.url),["https://api-staging.example.test/v1/extension/bootstrap"]);
 assert.equal(calls[0].authorization,"Bearer "+"a".repeat(64));
});
