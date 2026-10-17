import assert from "node:assert/strict";
import test from "node:test";
import { requestDeepSeek, validateDeepSeekResult, validateReplyOutput } from "../src/deepseek-client.js";

const jsonReply = JSON.stringify({
  recommendation: "reply",
  defaultStyle: "natural",
  language: "en",
  replies: {
    natural: "That sounds like a lovely moment.",
    light_humor: "My calendar could never be this organized.",
    thoughtful: "Small routines can make a day feel grounded.",
  },
  reason: "A warm response fits the post.",
  quoteCandidate: null,
});

function upstream({ status = 200, body, content = jsonReply, finishReason = "stop", usage } = {}) {
  return async (url, init) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-key-never-logged");
    const request = JSON.parse(init.body);
    assert.equal(request.model, "deepseek-flash");
    assert.deepEqual(request.response_format, { type: "json_object" });
    assert.match(`${request.messages[0].content}\n${request.messages[1].content}`, /JSON/i);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body ?? {
      model: "deepseek-flash",
      choices: [{ finish_reason: finishReason, message: { content } }],
      usage: usage ?? { prompt_tokens: 100, completion_tokens: 60, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 },
    }), { status, headers: { "content-type": "application/json" } });
  };
}

const options = (fetchImpl, extra = {}) => ({
  apiKey: "test-key-never-logged",
  system: "Return JSON with three reply candidates.",
  user: "Reply to this post as JSON.",
  inputRateUsdPerMillion: 0.3,
  outputRateUsdPerMillion: 1.32,
  fetchImpl,
  ...extra,
});

test("DeepSeek success returns model, finish reason, usage, and conservative peak cost", async () => {
  const result = await requestDeepSeek(options(upstream()));
  assert.equal(result.usage.model, "deepseek-flash");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.raw, jsonReply);
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.usage.outputTokens, 60);
  assert.equal(result.usage.costMicroUsd, 110);
  assert.deepEqual(Object.keys(validateDeepSeekResult(result).replies), ["natural", "light_humor", "thoughtful"]);
});

test("reply output requires three non-empty distinct candidate strings", () => {
  const duplicate = JSON.parse(jsonReply);
  duplicate.replies.light_humor = duplicate.replies.natural;
  assert.throws(() => validateReplyOutput(JSON.stringify(duplicate)), /candidate/i);
  const missing = JSON.parse(jsonReply);
  delete missing.replies.thoughtful;
  assert.throws(() => validateReplyOutput(JSON.stringify(missing)), /candidate/i);
  assert.throws(() => validateReplyOutput("not-json"), /JSON/i);
});

test("length finish reason is returned for the handler to reject while preserving usage", async () => {
  const result = await requestDeepSeek(options(upstream({ finishReason: "length" })));
  assert.equal(result.finishReason, "length");
  assert.equal(result.usage.inputTokens, 100);
  assert.throws(() => validateDeepSeekResult(result), /completed/i);
});

for (const status of [429, 500]) {
  test(`HTTP ${status} is classified without exposing upstream response text`, async () => {
    const fetchImpl = async () => new Response("private upstream error body", { status });
    await assert.rejects(requestDeepSeek(options(fetchImpl)), (error) => {
      assert.equal(error.code, status === 429 ? "rate_limited" : "http_error");
      assert.equal(error.message.includes("private upstream"), false);
      return true;
    });
  });
}

test("network timeout aborts and produces a sanitized error category", async () => {
  const fetchImpl = (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  await assert.rejects(requestDeepSeek(options(fetchImpl, { timeoutMs: 5 })), (error) => error.code === "timeout");
});

test("empty content and invalid upstream JSON are rejected", async () => {
  const empty = await requestDeepSeek(options(upstream({ content: "  " })));
  assert.equal(empty.raw, "  ");
  assert.throws(() => validateDeepSeekResult(empty), /empty/i);
  const malformed = await requestDeepSeek(options(upstream({ content: "{" })));
  assert.throws(() => validateReplyOutput(malformed.raw), /JSON/i);
  await assert.rejects(requestDeepSeek(options(async () => new Response("{", { headers: { "content-type": "application/json" } }))), (error) => error.code === "invalid_response");
});

test("invalid usage and missing completion choice are rejected", async () => {
  await assert.rejects(requestDeepSeek(options(upstream({ body: { choices: [], usage: {} } }))), (error) => error.code === "invalid_response");
  await assert.rejects(requestDeepSeek(options(upstream({ usage: { prompt_tokens: -1, completion_tokens: 1 } }))), (error) => error.code === "invalid_usage");
});

test("missing or invalid rates and API key fail closed before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response(); };
  await assert.rejects(requestDeepSeek(options(fetchImpl, { apiKey: "" })), (error) => error.code === "not_configured");
  await assert.rejects(requestDeepSeek(options(fetchImpl, { inputRateUsdPerMillion: 0 })), (error) => error.code === "not_configured");
  assert.equal(calls, 0);
});
