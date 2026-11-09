import test from "node:test";
import assert from "node:assert/strict";
import {matchesBindingSender} from "../services/binding-bridge.js";
import {AccountClient, ACCOUNT_PENDING_DEVICE_KEY, ACCOUNT_TOKEN_KEY, ACCOUNT_BINDING_RECEIPT_KEY} from "../services/account-client.js";

const websiteUrl = "https://app.x-reply-helper.top";
const deviceCode = "AB12CD34";
const proof = "975984bd-b962-4814-8a11-8d842f163890";
const record = {deviceCode, proof, tabId:7, expiresAt:new Date(Date.now()+60_000).toISOString()};
const sender = {frameId:0, tab:{id:7}, url:`${websiteUrl}/account?device_code=${deviceCode}`};
const message = {deviceCode, proof};
test("automatic binding requires the exact origin, top-level tab, pending code and local proof", () => {
  const valid = {sender,message,record,websiteUrl};
  assert.equal(matchesBindingSender(valid),true);
  for (const patch of [
    {sender:{...sender,frameId:1}},
    {sender:{...sender,tab:{id:8}}},
    {sender:{...sender,url:sender.url.replace("app.","staging.")}},
    {sender:{...sender,url:sender.url.replace("/account","/other")}},
    {sender:{...sender,url:sender.url.replace(deviceCode,"00000000")}},
    {message:{deviceCode}},
    {message:{...message,proof:"wrong"}},
    {record:{...record,expiresAt:"invalid"}},
    {record:{...record,expiresAt:new Date(0).toISOString()}},
  ]) assert.equal(matchesBindingSender({...valid,...patch}),false);
});

test("simultaneous poll and manual check exchange once and persist a restart-safe receipt", async () => {
  const data = {[ACCOUNT_PENDING_DEVICE_KEY]:{...record,deviceToken:"a".repeat(64)}};
  const storage = {get:async key=>({[key]:data[key]}),set:async patch=>Object.assign(data,patch)};
  let calls=0;
  const client=new AccountClient({config:{websiteUrl,hostedApiUrl:"https://api.x-reply-helper.top"},storage,fetchImpl:async()=>{
    calls++;
    return Response.json({status:"approved",accessToken:"b".repeat(64)});
  }});
  const first=client.pollDeviceAuthorization();
  const second=client.pollDeviceAuthorization();
  assert.equal(first,second);
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(calls,1);
  assert.equal(data[ACCOUNT_TOKEN_KEY],"b".repeat(64));
  assert.equal(data[ACCOUNT_PENDING_DEVICE_KEY],null);
  assert.equal(matchesBindingSender({sender,message,websiteUrl,record:data[ACCOUNT_BINDING_RECEIPT_KEY]}),true);
  assert.equal(await client.pollDeviceAuthorization(),false);
});
