import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const panel=readFileSync(new URL('../src/components/admin/AdminBoltUtilPanel.tsx',import.meta.url),'utf8');
test('admin renders actionable server-derived production readiness without exposing sensitive material',()=>{
 assert.match(panel,/data-testid="boltutil-production-readiness"/);
 assert.match(panel,/control\?\.readiness\.checks/);
 assert.match(panel,/control\?\.readiness\.networks/);
 assert.match(panel,/批准|审批值|Approved FX/);
 assert.match(panel,/这些|此处读取 Worker 当前运行配置/);
 assert.doesNotMatch(panel,/BOLTUTIL_API_KEY\s*=|BOLTUTIL_WEBHOOK_SECRET\s*=/);
 assert.match(panel,/USDT 收款总开关/);
 assert.match(panel,/write\("\/v1\/admin\/boltutil\/control"/);
});
