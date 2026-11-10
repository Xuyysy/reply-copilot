import test from "node:test";
import assert from "node:assert/strict";
import {isTransientAccountReadError, retryAccountRead, loadAccountSnapshot} from "../src/lib/account-load.mjs";

const error = (code,status) => Object.assign(new Error(code),{code,status});
const sleep = async () => {};

test("transient account requests retry and restore an authenticated dashboard", async () => {
  const called = {"/v1/me":0,"/v1/usage":0,"/v1/activity":0};
  const result = await loadAccountSnapshot(async path => {
    called[path]++;
    if(path==="/v1/me")return {user:{userId:"account-a"}};
    if(path==="/v1/usage"){
      if(called[path]===1)throw error("API_NETWORK_ERROR",0);
      return {quota:{totalRemaining:25}};
    }
    return {ledger:[],orders:[]};
  },{sleep,delays:[0]});
  assert.equal(result.account.user.userId,"account-a");
  assert.equal(result.usage.quota.totalRemaining,25);
  assert.equal(result.activity.orders.length,0);
  assert.deepEqual(called,{"/v1/me":1,"/v1/usage":2,"/v1/activity":1});
});
test("optional order history errors do not replace the signed-in account with a red error", async () => {
  const snapshot=await loadAccountSnapshot(async path=>{
    if(path==="/v1/me")return {user:{userId:"owner"}};
    if(path==="/v1/usage")return {quota:{totalRemaining:8}};
    throw error("SERVER_UNAVAILABLE",503);
  },{sleep,delays:[0]});
  assert.equal(snapshot.account.user.userId,"owner");
  assert.equal(snapshot.activity,null);
});
test("authorization failures never silently promote a logged-out account", async () => {
  for(const status of [401,403]){
    let calls=0;
    await assert.rejects(()=>retryAccountRead(async()=>{calls++;throw error("AUTH_REQUIRED",status)},{sleep,delays:[0,0]}),e=>e.status===status);
    assert.equal(calls,1);
  }
});
test("bounded retry stops on persistent errors and never retries cancelled requests", async () => {
  let calls=0;
  await assert.rejects(()=>retryAccountRead(async()=>{calls++;throw error("API_TIMEOUT",504)},{sleep,delays:[0,0]}),e=>e.status===504);
  assert.equal(calls,3);
  assert.equal(isTransientAccountReadError(error("API_CANCELLED",0)),false);
  assert.equal(isTransientAccountReadError(error("INVALID_CODE",400)),false);
  assert.equal(isTransientAccountReadError(error("SERVER_UNAVAILABLE",503)),true);
  assert.equal(isTransientAccountReadError(error("RATE_LIMITED",429)),true);
});
