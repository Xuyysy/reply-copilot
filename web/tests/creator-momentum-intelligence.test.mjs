import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=path=>readFileSync(path,"utf8");
const panel=source("web/src/components/account/CreatorMomentumIntelligence.tsx");
const dashboard=source("web/src/components/account/AccountDashboard.tsx");
const api=source("api/src/creator-momentum-insights.ts");
const routes=source("api/src/index.ts");
test("account page includes a single paid-only momentum terminal before the compact order center",()=>{
  assert.equal((dashboard.match(/<CreatorMomentumIntelligence userId=/g)||[]).length,1);
  assert.ok(dashboard.indexOf("<CreatorMomentumIntelligence userId=")<dashboard.indexOf("<Card data-orders-card"));
  assert.match(dashboard,/data-testid="account-subscription-quota"/);
  assert.match(dashboard,/data-credit-orders/);
});
test("three stages independently cycle, not one permanent progress bar or false triggered labels",()=>{
  assert.match(panel,/data-cmi-cycle-progress/);
  assert.match(panel,/cycle\?\.percent/);
  assert.match(panel,/cmi-primary-number/);
  assert.match(panel,/cycleProgress/);
  assert.match(panel,/研究参考节点已越过/);
  assert.match(panel,/下一次点击 X 原生回复时提示发布原创/);
  assert.match(panel,/参考信号 · 非实际提醒记录/);
  assert.doesNotMatch(panel,/500[–-]650|850[–-]1100|1350[–-]1700/);
});
test("gating stays on the authenticated API; no paid status from free balance",()=>{
  assert.match(routes,/\/v1\/creator-momentum\/insights/);
  assert.match(api,/sessionFor\(request,env\)/);
  assert.match(api,/creatorFeature\(env,session\.user_id\)/);
  assert.match(api,/new ApiFailure\(403,'PAID_FEATURE_REQUIRED'/);
  assert.match(api,/policy\.ranges/);
  assert.match(panel,/data-cmi-locked/);
  assert.match(panel,/api<Insights>\("\/v1\/creator-momentum\/insights"\)/);
});
