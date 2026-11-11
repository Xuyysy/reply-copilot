import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');
const values=['overview','users','campaigns','orders','subscriptions','packages','ledger','cost','ai-models','creator','content','security','settings','audits'];
test('Admin V2 navigation groups 14 preserved operator panels into exactly seven business workspaces',()=>{
 for(const value of values)assert.ok(source.includes('["'+value+'",t('),'missing preserved tab '+value);
 for(const heading of ['运营总览','用户中心','订单与财务','AI 使用分析','运营内容','系统与安全','审计中心'])assert.ok(source.includes(heading));
 assert.match(source,/lg:grid-cols-\[230px_minmax\(0,1fr\)\]/);
 assert.match(source,/aria-label=\{t\("后台工作区导航"/);
 assert.match(source,/max-h-\[min\(66dvh,540px\)\]/);
});
test('Account, payment, audit and creation tools remain in their existing guarded panels',()=>{
 for(const id of ['SubscriptionAdminPanel','SecurityPaymentPanel','AdminCommercePanel','AdminCommerceUserProfile','AdminUsageLedger','CampaignPanel','CreatorFeaturesPanel','SiteEditor','AIModelManagementPanel'])assert.ok(source.includes(id),id);
 assert.match(source,/\/v1\/admin\/reauth/);
 assert.match(source,/operationIds\.current/);
 assert.match(source,/AlertDialog/);
});
