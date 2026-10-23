import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("Staging uses ordinary real AI with operator budget and invocation logs off", () => {
  const staging = config.env.staging;
  assert.equal(staging.vars.AI_MODE, "production");
  assert.equal(staging.vars.REAL_DEEPSEEK_TEST_ENABLED, undefined);
  assert.equal(staging.vars.REAL_DEEPSEEK_TEST_DAILY_BUDGET_MICRO_USD, undefined);
  assert.equal(staging.vars.SITE_DAILY_CAP, undefined);
  assert.equal(staging.vars.DEEPSEEK_INPUT_USD_PER_MILLION, "0.30");
  assert.equal(staging.vars.DEEPSEEK_OUTPUT_USD_PER_MILLION, "1.32");
  assert.equal(staging.observability.logs.invocation_logs, false);
  assert.equal(config.env.production.observability, undefined);
});
