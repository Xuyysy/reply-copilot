import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("Staging prepares peak rates while keeping real AI disabled and invocation logs off", () => {
  const staging = config.env.staging;
  assert.equal(staging.vars.AI_MODE, "mock");
  assert.equal(staging.vars.REAL_DEEPSEEK_TEST_ENABLED, "0");
  assert.equal(staging.vars.REAL_DEEPSEEK_TEST_DAILY_BUDGET_MICRO_USD, "50000");
  assert.equal(staging.vars.DEEPSEEK_INPUT_USD_PER_MILLION, "0.30");
  assert.equal(staging.vars.DEEPSEEK_OUTPUT_USD_PER_MILLION, "1.32");
  assert.equal(staging.observability.logs.invocation_logs, false);
  assert.equal(config.env.production.observability, undefined);
});
