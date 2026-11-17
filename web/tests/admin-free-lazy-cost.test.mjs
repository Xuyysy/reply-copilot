import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');

test('regular admin overview does not invoke expensive monthly AI history',()=>{
 assert.match(source,/read<Metrics>\("\/v1\/admin\/dashboard\?view=overview"\)/);
 assert.match(source,/const \[costLoaded, setCostLoaded\] = useState\(false\)/);
 assert.match(source,/setContentLoaded\(false\); setCostLoaded\(false\)/);
});

test('AI cost panel retains exact full endpoint and renders only after successful fetch',()=>{
 assert.match(source,/if\(access!=="ready"\|\|tab!=="cost"\|\|costLoaded\)return;/);
 assert.match(source,/read<Metrics>\("\/v1\/admin\/dashboard"\)\.then\(full=>/);
 assert.match(source,/metrics:\{\.\.\.previous\.metrics,\.\.\.full\}/);
 assert.match(source,/setCostLoaded\(true\)/);
 assert.match(source,/\{!costLoaded\?<p role="status"/);
 assert.match(source,/正在读取精确 AI 成本及模型统计/);
 assert.match(source,/AiCostBreakdown rows=\{data\.metrics\.costByModel \|\| \[\]\}/);
 assert.match(source,/if\(!live\)return;/,'cancelled/stale workspace response must not mutate UI');
});

test('payment and admin mutation routes remain present and untouched',()=>{
 for(const route of ['/v1/admin/users','/v1/admin/orders','/v1/admin/settings','/v1/admin/reauth'])assert.ok(source.includes(route),route);
 assert.match(source,/setAccess\("loading"\)/);
 assert.match(source,/operationIds\.current/);
});
