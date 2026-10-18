import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const config=JSON.parse(readFileSync(path.join(root,"wrangler.jsonc"),"utf8"));

test("real payment stays disabled while only the staging Xiaodou webhook is enabled",()=>{
  assert.equal(config.vars.PAYMENTS_ENABLED,"0");
  assert.equal(config.vars.PAYMENT_PROVIDER,"mock");
  assert.equal(config.vars.XIAODOU_WEBHOOKS_ENABLED,"0");
  assert.equal(config.env.staging.vars.PAYMENTS_ENABLED,"0");
  assert.equal(config.env.staging.vars.PAYMENT_PROVIDER,"xiaodou");
  assert.equal(config.env.staging.vars.XIAODOU_WEBHOOKS_ENABLED,"1");
  assert.equal(config.env.staging.vars.AI_MODE,"mock");
  assert.equal(config.env.staging.vars.REAL_DEEPSEEK_TEST_ENABLED,"0");
  assert.equal(config.env.production.vars.PAYMENTS_ENABLED,"0");
  assert.equal(config.env.production.vars.PAYMENT_PROVIDER,"xiaodou");
  assert.equal(config.env.production.vars.XIAODOU_WEBHOOKS_ENABLED,"0");
});
