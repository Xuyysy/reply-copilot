import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');
const ops=readFileSync(new URL('../src/components/admin/AdminOperationsInsights.tsx',import.meta.url),'utf8');
const billing=readFileSync(new URL('../src/components/admin/AdminCommercePanel.tsx',import.meta.url),'utf8');
const page=readFileSync(new URL('../src/pages/admin.astro',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/styles/global.css',import.meta.url),'utf8');
const values=['overview','users','campaigns','orders','subscriptions','packages','ledger','cost','ai-models','creator','content','security','settings','audits'];

test('Admin V2 keeps all 14 functions and seven workspaces in a real desktop sidebar',()=>{
 for(const value of values)assert.ok(source.includes('["'+value+'",t('),'missing preserved tab '+value);
 for(const heading of ['运营总览','用户中心','订单与财务','AI 使用分析','运营内容','系统与安全','审计中心'])
  assert.ok(source.includes(heading),heading);
 assert.match(source,/orientation="vertical"/);
 assert.match(source,/lg:grid-cols-\[228px_minmax\(0,1fr\)\]/);
 assert.match(source,/aria-label=\{t\("后台工作区导航"/);
 assert.match(source,/admin-console-nav hidden/);
 assert.match(source,/!flex !h-auto !max-h-none !w-full !flex-col/);
});

test('Mobile uses accessible compact workspace select instead of clipped two-column tab pills',()=>{
 assert.match(source,/id="admin-workspace-switch"/);
 assert.match(source,/data-testid="admin-mobile-workspace"/);
 assert.match(source,/aria-label=\{t\("切换工作区"/);
 assert.match(source,/<optgroup key=\{title\} label=\{title\}>/);
 assert.match(source,/lg:hidden/);
 assert.doesNotMatch(source,/grid-cols-2 items-start gap-2 overflow-y-auto/);
});

test('Overview prioritizes verified KPIs and actionable risk feed, legacy metrics are collapsed',()=>{
 const overview=source.split('<TabsContent value="overview"')[1]?.split('</TabsContent>')[0];
 assert.ok(overview);
 assert.match(overview,/AdminCommerceSummary active=\{tab==="overview"\} language=\{language\} variant="overview"/);
 assert.match(overview,/AdminOperationsInsights active=\{tab==="overview"\} mode="alerts"/);
 assert.match(overview,/compact\//);
 assert.match(overview,/admin-overview-secondary/);
 assert.match(overview,/xl:grid-cols-\[minmax\(0,1\.3fr\)_minmax\(300px,1fr\)\]/);
 assert.match(billing,/variant==='overview'/);
 assert.match(ops,/admin-ops-feed/);
});

test('All guarded account payment and audit operations remain accessible',()=>{
 for(const id of ['SubscriptionAdminPanel','SecurityPaymentPanel','AdminCommercePanel','AdminCommerceUserProfile','AdminUsageLedger','CampaignPanel','CreatorFeaturesPanel','SiteEditor','AIModelManagementPanel'])
  assert.ok(source.includes(id),id);
 assert.match(source,/\/v1\/admin\/reauth/);
 assert.match(source,/operationIds\.current/);
 assert.match(source,/AlertDialog/);
 assert.match(page,/admin-page-heading/);
 assert.match(page,/admin-app-shell/);
 assert.match(css,/\.admin-page-heading h1/);
 assert.match(css,/\.admin-console-overview/);
});
