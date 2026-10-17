import assert from "node:assert/strict";
import test from "node:test";
import { realTestAllowed } from "../src/real-test-policy.js";

const valid = {
  ENVIRONMENT: "staging",
  REAL_DEEPSEEK_TEST_ENABLED: "1",
  REAL_DEEPSEEK_TEST_USER_EMAIL: "pilot@example.test",
  REAL_DEEPSEEK_TEST_DAILY_BUDGET_MICRO_USD: "50000",
  SITE_DAILY_CAP: "10",
};

test("real-test allows only the exact configured account (case-insensitive)", () => {
  assert.equal(realTestAllowed(valid, "PILOT@example.test"), true);
  assert.equal(realTestAllowed(valid, "other@example.test"), false);
  assert.equal(realTestAllowed({ ...valid, REAL_DEEPSEEK_TEST_USER_EMAIL: "" }, "pilot@example.test"), false);
});

test("real-test fails closed outside staging or when disabled", () => {
  assert.equal(realTestAllowed({ ...valid, ENVIRONMENT: "production" }, "pilot@example.test"), false);
  assert.equal(realTestAllowed({ ...valid, REAL_DEEPSEEK_TEST_ENABLED: "0" }, "pilot@example.test"), false);
});

test("real-test requires a valid bounded budget and a site cap no higher than ten", () => {
  assert.equal(realTestAllowed({ ...valid, REAL_DEEPSEEK_TEST_DAILY_BUDGET_MICRO_USD: "100001" }, "pilot@example.test"), false);
  assert.equal(realTestAllowed({ ...valid, SITE_DAILY_CAP: "11" }, "pilot@example.test"), false);
  assert.equal(realTestAllowed({ ...valid, SITE_DAILY_CAP: "invalid" }, "pilot@example.test"), false);
});
