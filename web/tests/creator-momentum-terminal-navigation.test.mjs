import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(path,"utf8");
const layout=read("web/src/layouts/Base.astro");
const terminal=read("web/src/pages/momentum-terminal.astro");
const dashboard=read("web/src/components/account/AccountDashboard.tsx");
const panel=read("web/src/components/account/CreatorMomentumIntelligence.tsx");
const css=read("web/src/styles/global.css");
const api=read("api/src/creator-momentum-insights.ts");
const feature=read("api/src/creator-momentum.ts");

test("the independent momentum button sits in header actions BEFORE language switch",()=>{
 const nav=layout.split('<nav data-site-navigation')[1]?.split('</nav>')[0]??'';
 const actions=layout.split('<div class="header-actions">')[1]?.split('</div>')[0]??'';
 assert.doesNotMatch(nav,/momentum-nav-link|href="\/#creator-momentum"/);
 assert.match(actions,/data-nav-id="momentum-terminal"/);
 assert.match(actions,/class="momentum-terminal-entry" href="\/momentum-terminal"/);
 assert.ok(actions.indexOf('href="/momentum-terminal"')<actions.indexOf('id="language-toggle"'));
 assert.match(layout,/<a href="\/momentum-terminal" data-zh="互动势能智能分析终端">Creator Momentum Terminal<\/a>/);
 assert.match(css,/\.header-actions \.momentum-terminal-entry \{display:none;/);
});

test("standalone route renders the actual terminal, not a fake preview; account omits it",()=>{
 assert.match(terminal,/<Base title="互动势能智能分析终端"/);
 assert.match(terminal,/<CreatorMomentumIntelligence client:load \/>/);
 assert.doesNotMatch(dashboard,/CreatorMomentumIntelligence/);
 assert.match(dashboard,/<Card data-orders-card/);
});

test("a guest or unpaid account sees detailed locked explanations, not score data",()=>{
 assert.match(panel,/error.status===401\?"guest"/);
 assert.match(panel,/error.status===403\?"locked"/);
 assert.match(panel,/\(state==="locked"\|\|state==="guest"\)/);
 assert.match(panel,/data-cmi-locked/);
 for(const feature of ["CMI 互动势能指数","三阶段临界信号","全天势能曲线与解读","非 X 官方流量数据","下一次原生回复操作时触发"])
   assert.ok(panel.includes(feature),"missing locked overview: "+feature);
 assert.match(panel,/href="\/login"/);
 assert.match(panel,/href="\/pricing\/"/);
 assert.match(panel,/state==="ready"&&insights&&cycle&&<>/);
 assert.doesNotMatch(panel,/localStorage.*eligible|localStorage.*paid|quota.*eligible/);
});

test("payment access is still server-trusted, without adding or inferring user entitlements",()=>{
 assert.match(api,/sessionFor\(request,env\)/);
 assert.match(api,/creatorFeature\(env,session\.user_id\)/);
 assert.match(api,/new ApiFailure\(403,'PAID_FEATURE_REQUIRED'/);
 assert.match(feature,/subscriptionAccount\(env,userId\)/);
 assert.doesNotMatch(feature,/freeRemaining>0/);
 assert.match(panel,/api<Insights>\("\/v1\/creator-momentum\/insights"\)/);
});
