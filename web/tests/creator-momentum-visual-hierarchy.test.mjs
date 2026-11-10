import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const panel=readFileSync("web/src/components/account/CreatorMomentumIntelligence.tsx","utf8");
const css=readFileSync("web/src/styles/global.css","utf8");
const api=readFileSync("api/src/creator-momentum-insights.ts","utf8");
const dashboard=readFileSync("web/src/components/account/AccountDashboard.tsx","utf8");

const ready=panel.split('{state==="ready"&&insights&&cycle&&<>')[1];
assert.ok(ready,"Paid feature preview must stay protected by ready state");
const preview=ready.split('<details data-cmi-details')[0];
const details=ready.split('<details data-cmi-details')[1]?.split("</details>")[0];
assert.ok(details,"Methodology stays in collapsed native details");

test("CMI index and threshold signal, not raw AI reply counts, lead the account dashboard",()=>{
  assert.match(preview,/data-cmi-overview/);
  assert.match(preview,/data-cmi-score/);
  assert.match(preview,/score\.toFixed\(1\)/);
  assert.match(preview,/今日互动势能指数/);
  assert.match(preview,/data-cmi-signal-summary/);
  assert.match(preview,/今日临界信号/);
  assert.match(preview,/原创释放机会/);
  assert.doesNotMatch(preview,/insights\.totalConfirmed|今日已确认交付事件|Confirmed delivery events/);
});
test("raw generation-event count is confined to collapsed data-source and methodology disclosure",()=>{
  assert.match(details,/data-cmi-data-source/);
  assert.match(details,/insights\.totalConfirmed\?\?0/);
  assert.match(details,/今日已确认交付的 AI 生成结果/);
  assert.match(details,/不代表用户已在 X 实际发送回复/);
  assert.match(details,/not replies actually posted on X/);
  assert.match(details,/data-testid="cmi-methodology"/);
  assert.ok(panel.indexOf('data-cmi-data-source')>panel.indexOf('<details data-cmi-details'));
  assert.equal((panel.match(/insights\.totalConfirmed/g)||[]).length,1,"Never feature raw count as a headline");
});
test("three release stages remain distinct references, never falsely claim actual reminders",()=>{
  assert.match(preview,/cmi-stage-grid/);
  assert.match(preview,/cycle\.stages/);
  assert.match(preview,/referenceCrossed/);
  assert.match(preview,/研究参考节点已越过/);
  assert.match(preview,/本阶段参考进度/);
  assert.match(preview,/参考信号 · 非实际提醒记录/);
  assert.match(preview,/not a confirmed extension reminder/);
  assert.match(preview,/data-cmi-cycle-progress/);
  assert.match(api,/creatorFeature\(env,session\.user_id\)/);
  assert.match(api,/policy\.ranges/);
  assert.doesNotMatch(preview,/500[–-]650|850[–-]1100|1350[–-]1700/);
});
test("paid-only, locked account UI and compact responsive design remain intact",()=>{
  assert.match(panel,/data-cmi-locked/);
  assert.match(panel,/api<Insights>\("\/v1\/creator-momentum\/insights"\)/);
  assert.match(dashboard,/<CreatorMomentumIntelligence userId=/);
  assert.match(css,/\.cmi-overview-grid \{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.cmi-cycle-fill/);
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(css,/\.cmi-overview-grid \{grid-template-columns:1fr/);
  assert.match(panel,/Explore momentum curves, data sources and methodology/);
  assert.match(panel,/data-cmi-learn-more href="\/#momentum-framework"/);
  assert.match(panel,/详细了解互动势能临界值理论/);
  assert.match(panel,/Learn more about the Creator Momentum Threshold theory/);
});
