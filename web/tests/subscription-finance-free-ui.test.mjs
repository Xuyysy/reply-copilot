import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/components/admin/SubscriptionAdminPanel.tsx',import.meta.url),'utf8');

test('subscription admin initial load fetches only verified payment summary',()=>{
 assert.match(source,/api<Finance>\('\/v1\/admin\/subscriptions\/finance\?view=summary'\)/);
 assert.match(source,/setFinance\(null\);setUsageLoadState\('idle'\);setUsageError\(''\)/);
 assert.match(source,/finance\.usage\s*\?/);
 assert.match(source,/为节约 D1 读取量/);
 assert.match(source,/查看近30天精确用量与成本/);
});
test('exact 30-day usage is still available on explicit operator click, with stale-response protection',()=>{
 assert.match(source,/onClick=\{loadExactUsage\}/);
 assert.match(source,/api<Finance>\('\/v1\/admin\/subscriptions\/finance'\)\.then\(full=>/);
 assert.match(source,/revision!==financeRequestVersion\.current/);
 assert.match(source,/financeRequestVersion\.current\+\+/);
 assert.match(source,/setUsageLoadState\('loaded'\)/);
 assert.match(source,/role="alert"/);
});
test('payment and subscription authorization UI remains present',()=>{
 for(const value of ["'/hold'","'/verify'","verified_event_count","risk_state","expectedId:next.id"])
  assert.ok(source.includes(value)||source.includes(value.replace(/^'|'$/g,'')),value);
 assert.match(source,/verified_event_count>0&&o\.payment_status==='paid'/);
});
