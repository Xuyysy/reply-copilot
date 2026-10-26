import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/auth.ts"), "utf8");

test("registration and reset emails use the new brand without changing the sender address", () => {
  assert.match(source, /x-Reply-Helper 注册验证码/);
  assert.match(source, /x-Reply-Helper 重置密码验证码/);
  assert.match(source, /您的 x-Reply-Helper/);
  assert.match(source, /from: env\.MAIL_FROM/);
  assert.doesNotMatch(source, /Reply Copilot|REPLY COPILOT/);
});
