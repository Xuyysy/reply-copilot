import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatCompletionRequest,
  classifyProviderFailure,
  validateModelOutput,
  validateProviderEndpoint,
  providerRequestUrl,
  requestConfiguredModel,
} from "../src/ai-model-provider.js";

const canonical = JSON.stringify({
  recommendation: "reply", defaultStyle: "natural", language: "zh",
  replies: { natural: "谢谢分享这个细节。", light_humor: "这让我今天的待办都显得不那么重要了。", thoughtful: "持续记录这些小事，往往更能留下真实的变化。" },
  reason: "围绕帖子里的具体细节回应。", quoteCandidate: null,
});
const base = { provider: "deepseek", protocol: "openai_chat", baseUrl: "https://api.deepseek.com", modelId: "deepseek-flash", maxOutputTokens: 1200, options: {} };

test("DeepSeek, Qwen, Gemini and custom adapters use only their documented compatible options", () => {
  const deepseek = buildChatCompletionRequest({ ...base, provider: "deepseek" }, "sys", "user");
  assert.deepEqual(deepseek.response_format, { type: "json_object" });
  assert.deepEqual(deepseek.thinking, { type: "disabled" });
  const qwen = buildChatCompletionRequest({ ...base, provider: "qwen", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", modelId: "qwen-plus" }, "sys", "user");
  assert.deepEqual(qwen.response_format, { type: "json_object" });
  assert.equal("thinking" in qwen, false);
  assert.equal("enable_thinking" in qwen, false);
  const gemini = buildChatCompletionRequest({ ...base, provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", modelId: "gemini-3-flash" }, "sys", "user");
  assert.equal("response_format" in gemini, false);
  assert.equal("thinking" in gemini, false);
  const custom = buildChatCompletionRequest({ ...base, provider: "openai_compatible", baseUrl: "https://llm.example.com/v1", modelId: "model-x" }, "sys", "user");
  assert.equal("response_format" in custom, false);
  assert.equal("thinking" in custom, false);
});

test("dedicated SiliconFlow preset sends only supported chat options and fixes the API host", async () => {
  const sf={...base,provider:"siliconflow",baseUrl:"https://api.siliconflow.cn/v1",modelId:"deepseek-ai/DeepSeek-V4-Flash",options:{thinkingMode:"disabled",jsonMode:true}};
  const body=buildChatCompletionRequest(sf,"sys","user");
  assert.deepEqual(body.response_format,{type:"json_object"});
  assert.equal(body.enable_thinking,false);
  assert.equal(body.model,"deepseek-ai/DeepSeek-V4-Flash");
  assert.equal(body.max_tokens,1200);
  assert.equal(providerRequestUrl(sf),"https://api.siliconflow.cn/v1/chat/completions");
  const switched=buildChatCompletionRequest({...sf,options:{thinkingMode:"enabled",jsonMode:false}},"sys","user");
  assert.equal(switched.enable_thinking,true);
  assert.equal("response_format" in switched,false);
  const modelDefault=buildChatCompletionRequest({...sf,options:{jsonMode:true}},"sys","user");
  assert.equal("enable_thinking" in modelDefault,false);
  assert.deepEqual(await validateProviderEndpoint(sf,async()=>["93.184.216.34"]),["93.184.216.34"]);
  for(const baseUrl of ["https://api.siliconflow.cn.evil.test/v1","https://fake.siliconflow.cn/v1","https://api.siliconflow.cn/other","http://api.siliconflow.cn/v1"]){
    await assert.rejects(validateProviderEndpoint({...sf,baseUrl},async()=>["93.184.216.34"]),e=>["provider_endpoint_mismatch","unsafe_endpoint"].includes(e.code),baseUrl);
  }
  await assert.rejects(validateProviderEndpoint(sf,async()=>["127.0.0.1"]),e=>e.code==="unsafe_endpoint");
});

test("all model output is normalized through the existing plugin response contract", () => {
  const value = validateModelOutput(canonical);
  assert.equal(value.replies.natural, "谢谢分享这个细节。");
  assert.equal(value.quoteCandidate, null);
  assert.equal(value.score, null);
  assert.deepEqual(validateModelOutput(JSON.stringify(value)), value);
  for (const score of [null, 0, 100]) assert.equal(validateModelOutput(JSON.stringify({ ...JSON.parse(canonical), score })).score, score);
  for (const score of ["90", false, {}, [], -1, 101, 0.5]) assert.throws(() => validateModelOutput(JSON.stringify({ ...JSON.parse(canonical), score })));
  for (const invalid of ["```json\n" + canonical + "\n```", canonical.slice(0, -10), "{}", "{} trailing"]) assert.throws(() => validateModelOutput(invalid));
  const duplicate = JSON.parse(canonical); duplicate.replies.thoughtful = duplicate.replies.natural;
  assert.throws(() => validateModelOutput(JSON.stringify(duplicate)));
  const wrongEnum = JSON.parse(canonical); wrongEnum.recommendation = "like";
  assert.throws(() => validateModelOutput(JSON.stringify(wrongEnum)));
});

test("provider endpoints reject unsafe schemes, credentials, ports, local names and private resolved addresses", async () => {
  for (const baseUrl of ["http://example.com/v1", "https://user:pass@example.com/v1", "https://example.com:8443/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://169.254.169.254/latest"]) {
    await assert.rejects(validateProviderEndpoint({ ...base, provider: "openai_compatible", baseUrl }, async () => ["93.184.216.34"]));
  }
  await assert.rejects(validateProviderEndpoint({ ...base, provider: "openai_compatible", baseUrl: "https://public.example/v1" }, async () => ["10.20.0.1"]));
  await assert.rejects(validateProviderEndpoint({ ...base, provider: "openai_compatible", baseUrl: "https://public.example/v1" }, async () => ["93.184.216.34", "::1"]));
});

test("connection failures expose safe categories only and redirects are not followed", async () => {
  assert.equal(classifyProviderFailure({ status: 401 }), "authentication_error");
  assert.equal(classifyProviderFailure({ status: 429 }), "rate_limited");
  assert.equal(classifyProviderFailure({ status: 302 }), "redirect_blocked");
  let request;
  await assert.rejects(requestConfiguredModel({
    config: { ...base, provider: "openai_compatible", baseUrl: "https://api.example.com/v1", modelId: "m" },
    apiKey: "super-secret", system: "s", user: "u", inputRateMicroUsdPerMillion: 300000, outputRateMicroUsdPerMillion: 1000000,
    validateEndpoint: async () => {},
    fetchImpl: async (_url, init) => { request = init; return new Response("secret upstream response", { status: 302, headers: { location: "https://evil.example" } }); },
  }), (error) => { assert.equal(error.code, "redirect_blocked"); assert.equal(error.message.includes("secret upstream"), false); return true; });
  assert.equal(request.redirect, "manual");
  assert.equal(new Headers(request.headers).get("authorization"), "Bearer super-secret");
});

test("missing token usage fails closed and carries the conservative reservation for cost settlement", async () => {
  await assert.rejects(requestConfiguredModel({
    config: { ...base, provider: "openai_compatible", baseUrl: "https://api.example.com/v1", modelId: "m" }, apiKey: "test-key",
    system: "s", user: "u", inputRateMicroUsdPerMillion: 300000, outputRateMicroUsdPerMillion: 1000000, reservedCostMicroUsd: 5000,
    validateEndpoint: async () => {}, fetchImpl: async () => new Response(JSON.stringify({ model: "m", choices: [{ finish_reason: "stop", message: { content: canonical } }] }), { status: 200 }),
  }), error => { assert.equal(error.code, "usage_unavailable"); assert.equal(error.estimatedCostMicroUsd, 5000); return true; });
});

test("successful usage is costed in integer micro-USD without trusting provider model labels", async () => {
  const result = await requestConfiguredModel({
    config: { ...base, provider: "openai_compatible", baseUrl: "https://api.example.com/v1", modelId: "configured-model" }, apiKey: "test-key",
    system: "s", user: "u", inputRateMicroUsdPerMillion: 300000, outputRateMicroUsdPerMillion: 1000000, reservedCostMicroUsd: 100,
    validateEndpoint: async () => {}, fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.example.com/v1/chat/completions");
      assert.equal(JSON.parse(init.body).model, "configured-model");
      return new Response(JSON.stringify({ model: "spoofed-label", choices: [{ finish_reason: "stop", message: { content: canonical } }], usage: { prompt_tokens: 10, completion_tokens: 4 } }), { status: 200 });
    },
  });
  assert.equal(result.usage.model, "configured-model");
  assert.equal(result.usage.costMicroUsd, 7);
  assert.equal(JSON.parse(result.raw).replies.natural, "谢谢分享这个细节。");
  assert.equal(JSON.parse(result.raw).defaultStyle, "natural");
});

test('SiliconFlow rejects unsafe targets before resolving DNS or forwarding credentials',async()=>{
 const sf={...base,provider:'siliconflow',baseUrl:'https://api.siliconflow.cn/v1'};
 for(const baseUrl of ['https://api.siliconflow.cn@evil.example/v1','https://user:pass@api.siliconflow.cn/v1','https://api.siliconflow.cn:8443/v1','https://api.siliconflow.cn/v1?redirect=evil','https://api.siliconflow.cn/v1#fragment','https://127.0.0.1/v1','https://169.254.169.254/v1']){
  let resolved=false;await assert.rejects(validateProviderEndpoint({...sf,baseUrl},async()=>{resolved=true;return['8.8.8.8'];}));assert.equal(resolved,false);
 }
 await assert.rejects(validateProviderEndpoint(sf,async()=>['8.8.8.8','::1']),e=>e.code==='unsafe_endpoint');
 let calls=0;await assert.rejects(requestConfiguredModel({config:{...sf,timeoutMs:3000},apiKey:'synthetic-key',system:'JSON',user:'JSON',inputRateMicroUsdPerMillion:300000,outputRateMicroUsdPerMillion:1000000,validateEndpoint:async()=>{},fetchImpl:async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response('',{status:307,headers:{location:'https://evil.example/v1'}});}}),e=>e.code==='redirect_blocked');assert.equal(calls,1);
});

for(const host of ['api.siliconflow.cn','api.siliconflow.com']) for(const jsonMode of [true,false]) for(const thinkingMode of [undefined,'enabled','disabled']) test(`SiliconFlow ${host} JSON=${jsonMode} thinking=${thinkingMode} parameter matrix`,async()=>{
 const config={...base,provider:'siliconflow',baseUrl:`https://${host}/v1`,modelId:'Qwen/Any-Model',options:{jsonMode,...(thinkingMode?{thinkingMode}:{})}};
 const body=buildChatCompletionRequest(config,'JSON','中文 English');
 assert.equal(providerRequestUrl(config),`https://${host}/v1/chat/completions`);
 assert.equal('response_format' in body,jsonMode);
 assert.equal('enable_thinking' in body,thinkingMode!==undefined);
 if(thinkingMode)assert.equal(body.enable_thinking,thinkingMode==='enabled');
 assert.equal('thinking' in body,false);
 await validateProviderEndpoint(config,async()=>['8.8.8.8']);
 for(const baseUrl of [`https://${host}.evil.test/v1`,`https://${host}/v1/extra`,`https://user:secret@${host}/v1`,`https://${host}:8443/v1`])await assert.rejects(validateProviderEndpoint({...config,baseUrl},async()=>['8.8.8.8']));
});
