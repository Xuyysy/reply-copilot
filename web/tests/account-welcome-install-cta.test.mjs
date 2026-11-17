import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeSiteLink } from "../src/lib/site-content.mjs";

const account = readFileSync(new URL("../src/components/account/AccountDashboard.tsx", import.meta.url), "utf8");
const pending = account.split('usage.signupBenefit?.status === "pending" && <Alert')[1]?.split('<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">')[0] ?? "";

test("pending welcome credits show a focused bilingual installation CTA without changing eligibility", () => {
  assert.match(pending, /data-testid="account-welcome-credits-pending"/);
  assert.match(pending, /你的 200 次新人免费额度还未领取/);
  assert.match(pending, /200 free AI replies are waiting to be claimed/);
  assert.match(pending, /完成邮箱验证后，安装并登录 Chrome 插件，连接账户即可领取/);
  assert.match(pending, /Verify your email, install and sign in to the Chrome extension/);
  assert.match(pending, /data-testid="account-welcome-install"/);
  assert.match(pending, /立即安装插件/);
  assert.match(pending, /Install extension now/);
  assert.match(pending, /href={welcomeLinks.chromeStoreUrl} target="_blank" rel="noopener noreferrer"/);
  assert.match(pending, /flex-col items-start.*sm:flex-row sm:items-center/);
  assert.doesNotMatch(pending, /联系客服|contact support|\/v1\/(?:credits|claim|grant|billing)/i);
});

test("installation button falls back to the real production Chrome Store identity", () => {
  const match = account.match(/const DEFAULT_CHROME_STORE_URL = "(https:\/\/[^"]+)"/);
  assert.ok(match, "production store fallback must exist");
  assert.equal(match[1], "https://chromewebstore.google.com/detail/fgfjajofkapebgphfidblngcjomkbdaj");
  assert.equal(safeSiteLink(match[1], "chromeStoreUrl"), match[1]);
  assert.match(account, /safeSiteLink\(result\.content\?\.chromeStoreUrl, "chromeStoreUrl"\) \|\| DEFAULT_CHROME_STORE_URL/);
});

test("contact says DM me on X and uses the safely validated public profile config", () => {
  assert.match(account, /api<\{content\?: \{chromeStoreUrl\?: string; xProfileUrl\?: string\}\}>\("\/v1\/site"\)/);
  assert.match(account, /safeSiteLink\(result\.content\?\.xProfileUrl, "xProfileUrl"\)/);
  assert.match(pending, /data-testid="account-welcome-x-dm" href={welcomeLinks.xProfileUrl}/);
  assert.match(pending, /私信我的 X/);
  assert.match(pending, /DM me on X/);
  assert.match(pending, /target="_blank" rel="noopener noreferrer"/);
  assert.match(pending, /<span>\{t\("私信我的 X", "DM me on X"\)\}<\/span>/);
  assert.match(pending, /usage\.signupBenefit\?\.status === "pending"/);
});
