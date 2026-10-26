import assert from "node:assert/strict";
import test from "node:test";
import { HostedAIClient } from "../services/hosted-ai-client.js";

const valid = JSON.stringify({ recommendation:"reply",defaultStyle:"natural",language:"en",reason:"Fits the post.",quoteCandidate:null,replies:{natural:"One.",light_humor:"Two.",thoughtful:"Three."} });
const input={sourceText:"Post",sourceUrl:"https://x.com/a/status/1",requestId:"12345678-1234-4234-8234-123456789abc"};

test("hosted client validates three candidates and confirms delivery before exposing output",async()=>{
  const calls=[];
  const accountClient={request:async(path,options)=>{calls.push({path,options});return path==="/v1/ai/generate"?{raw:valid,quota:{totalRemaining:19}}:{ok:true};}};
  const client=new HostedAIClient({config:{hostedApiUrl:"https://api.example.test"},accountClient});
  assert.equal(await client.generateReplies(input),valid);
  assert.deepEqual(calls.map(({path})=>path),["/v1/ai/generate",`/v1/ai/requests/${input.requestId}/delivered`]);
  assert.equal(client.lastQuota.totalRemaining,19);
});

test("invalid reply payload never acknowledges or reaches the caller",async()=>{
  let acknowledgements=0;
  const accountClient={request:async(path)=>{if(path.endsWith("/delivered")){acknowledgements++;return {ok:true};}return {raw:JSON.stringify({replies:{natural:"Only one."}})};}};
  const client=new HostedAIClient({config:{hostedApiUrl:"https://api.example.test"},accountClient});
  await assert.rejects(client.generateReplies(input));
  assert.equal(acknowledgements,0);
});

test("lost acknowledgement response can be retried with the same request id",async()=>{
  let ackAttempts=0;
  const accountClient={request:async(path)=>{if(path==="/v1/ai/generate")return {raw:valid};ackAttempts++;if(ackAttempts===1)throw new Error("response lost");return {ok:true,alreadyConfirmed:true};}};
  const client=new HostedAIClient({config:{hostedApiUrl:"https://api.example.test"},accountClient});
  await assert.rejects(client.generateReplies(input));
  await assert.doesNotReject(client.generateReplies(input));
  assert.equal(ackAttempts,2);
});

test("delivery confirmation failure is retryable with the same id and uses confirmed quota",async()=>{
  const calls=[];let acknowledged=false;
  const accountClient={request:async(path,options)=>{
    calls.push({path,options});
    if(path==="/v1/ai/generate")return {raw:valid,quota:{totalRemaining:199}};
    if(!acknowledged){const error=Object.assign(new Error("confirmation unavailable"),{code:"DELIVERY_CONFIRMATION_CONFLICT",status:409});throw error;}
    return {ok:true,quota:{totalRemaining:198}};
  }};
  const client=new HostedAIClient({config:{hostedApiUrl:"https://api.example.test"},accountClient});
  await assert.rejects(client.generateReplies(input),error=>error.code==="DELIVERY_CONFIRMATION_PENDING");
  acknowledged=true;
  assert.equal(await client.generateReplies(input),valid);
  assert.equal(calls.filter(call=>call.path==="/v1/ai/generate").length,2,"retry must replay the same idempotent generation");
  assert.ok(calls.every(call=>!call.options?.body || call.options.body.requestId===input.requestId));
  assert.equal(client.lastQuota.totalRemaining,198,"use quota returned by delivery confirmation");
});
