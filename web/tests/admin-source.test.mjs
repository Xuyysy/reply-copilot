import test from 'node:test';
import assert from 'node:assert/strict';
import {adminOperationPayload} from '../src/lib/admin-operation-payload.ts';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/components/admin/AdminDashboard.tsx', import.meta.url), 'utf8');
const mk99SettingsSource = await readFile(new URL('../src/components/admin/MerchantPaymentSettings.tsx', import.meta.url), 'utf8');

test('admin mutation identity survives network errors and reauthentication', () => {
  assert.match(source, /operationIds\.current\.get\(key\) \|\| crypto\.randomUUID\(\)/);
  assert.match(source, /JSON\.stringify\(\{ \.\.\.payload, operationId \}\)/);
  assert.match(source, /cause\.code !== "ADMIN_REAUTH_REQUIRED"/);
  assert.match(source, /result = await send\(\)/);
  assert.match(source, /if \(busyGuard\.current\) return; busyGuard\.current = true/);
  assert.match(source, /adminOperationPayload\(path,body,reasonRef\.current\)/);
  assert.match(source, /if \(!valid\) throw new Error/);
  const syncPath='/v1/admin/partners/manual-report';
  assert.deepEqual(adminOperationPayload(syncPath,{sync:true,userId:'partner'},''),{payload:{sync:true,userId:'partner'},valid:true});
  assert.deepEqual(adminOperationPayload(syncPath,{sync:true,userId:'partner'},'stale reason must not leak'),{payload:{sync:true,userId:'partner'},valid:true});
  for(const [path,body] of [[syncPath,{requestId:'request',action:'completed'}],[syncPath,{sync:true,userId:'partner',unexpected:true}],['/v1/admin/users/bulk-status',{sync:true,userId:'partner'}]]){
    assert.equal(adminOperationPayload(path,body,'').valid,false);
    assert.equal(adminOperationPayload(path,body,'short').valid,false);
  }
  assert.deepEqual(adminOperationPayload(syncPath,{requestId:'request',action:'completed',reason:'verified offline transfer'},''),{payload:{requestId:'request',action:'completed',reason:'verified offline transfer'},valid:true});
  assert.match(source, /type="password" autoComplete="current-password"/);
  assert.doesNotMatch(source, /window\.prompt|window\.confirm/);
});

test('MK99 balance check supplies an audit reason and exposes safe readiness/result feedback', () => {
  assert.match(mk99SettingsSource, /\/v1\/admin\/mk99-platform-check',\{reason:'MK99 read-only balance connectivity check'\}/);
  assert.match(mk99SettingsSource, /safeCheckCodes\.has\(r\.code\)/);
  assert.match(mk99SettingsSource, /credentialsConfigured\?/);
  assert.match(mk99SettingsSource, /pending\?t\('正在检测/);
  assert.match(mk99SettingsSource, /role=\{message\.includes/);
  assert.match(mk99SettingsSource, /role="alert"/);
});

test('admin tools include safe account operations, content, audit and price controls', () => {
  for (const route of ['/v1/admin/users/bulk-status', '/v1/admin/content', '/v1/admin/audits', '/v1/admin/reauth']) assert.ok(source.includes(route), route);
  for (const field of ['isTestAccount', 'settlementMode', 'exchangeRateMicros', 'feeRateBps', 'descriptionZh', 'descriptionEn', 'homeTitleZh', 'faqEn']) assert.ok(source.includes(field), field);
  assert.ok(source.includes('/archive'));
  assert.ok(source.includes('/test-account'));
  assert.doesNotMatch(source, /method: "DELETE"/);
});

test('operator details present quota and history with familiar labels', () => {
  assert.doesNotMatch(source, /JSON\.stringify\(detail\[/);
  assert.match(source, /function UserDetailHistory/);
  for (const label of ['可用免费额度', '可用付费额度', '最近额度流水', '最近 AI 使用']) assert.ok(source.includes(label), label);
  assert.match(source, /filter\(item => item\.key !== "announcement"\)/);
  assert.match(source, /item\.fee_rate_bps \?\? 150/);
});

const campaignSource = await readFile(new URL('../src/components/admin/CampaignPanel.tsx', import.meta.url), 'utf8');
test('campaign UI requires preview and explicit confirmation before manual batches', () => {
  assert.match(campaignSource, /setPreview\(null\),\[signature\]/);
  assert.match(campaignSource, /expectedCount:preview.recipientCount,confirm:true/);
  assert.match(campaignSource, /最多 3 人/);
  assert.match(campaignSource, /futureEligible:future/);
  assert.match(campaignSource, /90\*86400000/);
  assert.match(campaignSource, /confirm\("确认处理下一批"/);
  assert.doesNotMatch(campaignSource, /setInterval|while\s*\(/);
});
test('operations UI offers selected exports and server filters without unverified order grants', () => {
  for (const field of ['registeredFrom','registeredTo','activeSince','paidFilter','selectedOrders','/v1/admin/export?','/note','recommendedLabelZh','recommendedLabelEn','featured']) assert.ok(source.includes(field),field);
  assert.match(source,/credentials:"include"/);
  assert.match(source,/URL.revokeObjectURL\(url\)/);
  assert.match(source,/SiteEditor content=/);
  assert.match(source,/SecurityPaymentPanel language=/);
  assert.match(source,/newUsers7d/);
  assert.match(source,/revenue7dFen/);
  assert.doesNotMatch(source,/\/orders\/.*manual-grant/);
});
