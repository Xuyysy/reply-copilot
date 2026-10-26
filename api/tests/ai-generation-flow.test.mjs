import assert from "node:assert/strict";
import test from "node:test";
import { executeAiGeneration } from "../src/ai-generation-flow.js";

const result = {
  raw: JSON.stringify({ replies: { natural: "Warm reply.", light_humor: "Light joke.", thoughtful: "Thoughtful reply." } }),
  finishReason: "stop",
  usage: { model: "deepseek-flash", inputTokens: 40, outputTokens: 25, costMicroUsd: 45 },
};

test("same request replay does not repeat the mocked upstream call or debit", async () => {
  let requestState = null;
  let balance = 1;
  let debits = 0;
  let upstreamCalls = 0;
  let costRows = 0;
  const dependencies = {
    reserve: async () => {
      if (requestState?.status === "succeeded") return { kind: "replay", raw: requestState.raw, quota: { totalRemaining: balance } };
      requestState = { status: "reserved" }; debits += 1; balance -= 1;
      return { kind: "new", quota: { totalRemaining: balance } };
    },
    provider: async () => { upstreamCalls += 1; return result; },
    validate: () => {},
    finish: async (raw, usage) => { requestState = { status: "succeeded", raw }; assert.equal(usage, result.usage); costRows += 1; },
  };

  assert.equal((await executeAiGeneration(dependencies)).kind, "generated");
  const replay = await executeAiGeneration(dependencies);
  assert.equal(replay.kind, "replay");
  assert.equal(upstreamCalls, 1);
  assert.equal(debits, 1);
  assert.equal(balance, 0);
  assert.equal(costRows, 1);
});

test("budget rejection happens before provider and does not reserve a credit", async () => {
  let upstreamCalls = 0;
  await assert.rejects(executeAiGeneration({
    reserve: async () => { throw new Error("budget exhausted"); },
    provider: async () => { upstreamCalls += 1; return result; },
    validate: () => {},
    finish: async () => {},
  }), /budget exhausted/);
  assert.equal(upstreamCalls, 0);
});

test("uncertain success settlement cannot trigger a second paid provider call", async () => {
  let requestState = "new";
  let upstreamCalls = 0;
  const dependencies = {
    reserve: async () => {
      if (requestState !== "new") throw new Error("request outcome is uncertain");
      requestState = "reserved";
      return { kind: "new" };
    },
    provider: async () => { upstreamCalls += 1; return result; },
    validate: () => {},
    finish: async () => { throw new Error("settlement outcome is uncertain"); },
  };

  await assert.rejects(executeAiGeneration(dependencies), /settlement outcome is uncertain/);
  await assert.rejects(executeAiGeneration(dependencies), /request outcome is uncertain/);
  assert.equal(upstreamCalls, 1);
});

test("invalid completion refunds once and retains usage cost for the failed model call", async () => {
  let refundCount = 0;
  let preservedCost = 0;
  const incomplete = { ...result, finishReason: "length" };
  const outcome = await executeAiGeneration({
    reserve: async () => ({ kind: "new", quota: { totalRemaining: 0 } }),
    provider: async () => incomplete,
    validate: () => { throw new Error("incomplete"); },
    finish: async (raw, usage) => {
      assert.equal(raw, null);
      refundCount += 1;
      preservedCost = usage.costMicroUsd;
    },
  });
  assert.equal(outcome.kind, "failed");
  assert.equal(refundCount, 1);
  assert.equal(preservedCost, result.usage.costMicroUsd);
});
