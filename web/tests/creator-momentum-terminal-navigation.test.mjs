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
 assert.match(layout,/<a href="\/momentum-terminal" data-zh="势能分析">Momentum Analytics<\/a>/);
 assert.match(actions,/<span data-zh="势能分析">Momentum Analytics<\/span>/);
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
 assert.doesNotMatch(panel,/cmi-research-status|cmi-access-disclaimer/);
 assert.match(panel,/实际提醒以插件本机阈值为准/);
 for(const feature of ["CMI 互动势能指数","三阶段临界信号","全天势能曲线与解读"])
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

test("the full founder-approved Notion thesis appears in its exact seven-paragraph order for guests and nonpay users",()=>{
 const canonical=[
  "我认为，原创帖的传播机会，并不只取决于发布的那一刻。",
  "持续参与高质量讨论，可能让账号逐渐建立话题关联、受众连接与行为信号，形成潜在的传播势能。",
  "我将这种互动积累过程中，可能出现传播条件非线性变化的关键节点，定义为「互动势能临界值」。",
  "互动势能分析引擎融合 X 推荐机制研究、互动时序建模、传播趋势分析及中文区创作者X榜单，构建多维势能评估体系。",
  "通过每日动态数据更新、历史样本数据库积累与持续模型训练分析，不断优化行为信号权重与临界策略，探索互动积累和原创内容曝光表现之间的潜在关联。",
  "系统通过分阶段临界识别，辅助捕捉值得尝试原创发布的关键窗口。",
  "互动是蓄势，临界是信号，原创是释放。"
 ];
 let previous=-1;
 for(const paragraph of canonical){
  const index=panel.indexOf(paragraph);
  assert.ok(index>previous,"missing or out-of-order canonical founder paragraph: "+paragraph);
  previous=index;
 }
 assert.match(panel,/founderNarrative\.map\(/);
 assert.match(panel,/cmi-founder-narrative/);
 assert.match(panel,/cmi-theory-manifesto/);
 assert.match(panel,/state==="locked"\|\|state==="guest"/);
 assert.match(panel,/基于已确认交付的 AI 生成事件/);

 assert.match(css,/\.cmi-founder-narrative/);
 assert.doesNotMatch(panel,/你的每次互动，可能都在为下一次原创积累机会/);
});

test("founder English narrative retains the original thesis and roadmap boundaries",()=>{
 for(const paragraph of [
  "I believe an original post's distribution opportunity is shaped by more than the moment it is published.",
  "I call the point at which accumulated engagement may correspond to a nonlinear shift in distribution conditions",
  "Through daily data updates, historical sample accumulation, and ongoing model training and analysis",
  "Engagement builds momentum. Thresholds signal opportunity. Original posts release it."
 ]) assert.ok(panel.includes(paragraph),"missing English narrative: "+paragraph);
 assert.match(layout,/aria-label="势能分析 \/ Momentum Analytics"/);
});
