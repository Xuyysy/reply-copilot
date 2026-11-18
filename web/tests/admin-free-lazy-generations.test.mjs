import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');

test('CF Free overview/user detail loads exact generation counts only on explicit operator action',()=>{
 assert.ok(source.includes('/v1/admin/dashboard?view=overview'));
 assert.ok(source.includes('/v1/admin/dashboard?view=generations'));
 assert.ok(source.includes('?view=light'));
 assert.ok(source.includes('?view=generations'));
 assert.match(source,/loadExactGenerationStats\(\)/);
 assert.match(source,/loadUserGenerationCount\(\)/);
 assert.match(source,/generationStatsRequest\.current\+\+/);
 assert.match(source,/countRequest\.current\+\+/);
});
test('CF Free unloaded/failed counts use honest placeholders and remain retryable',()=>{
 assert.match(source,/generationStatsFailed&&<p role="status"/);
 assert.match(source,/generationStatsLoaded\?t\("刷新精确次数"/);
 assert.match(source,/generations \?\? "—"/);
 assert.match(source,/generations===null\?t\("查询精确次数"/);
 assert.match(source,/countFailed&&<span role="status"/);
 assert.match(source,/key=\{detail.user.id\} detail=\{detail\}/);
});

test('rolling release: new Pages accepts focused or old full Worker ACK read shape without overwriting financial KPI',()=>{
 assert.match(source,/typeof today!==\x27number\x27\|\|!Number\.isSafeInteger\(today\)/);
 assert.match(source,/typeof month!==\x27number\x27\|\|!Number\.isSafeInteger\(month\)/);
 assert.match(source,/monthGenerations:month/);
 assert.match(source,/exact\.user\?\.generations/);
 assert.match(source,/typeof value!==\x27number\x27\|\|!Number\.isSafeInteger\(value\)/);
 assert.doesNotMatch(source,/metrics:\{\.\.\.previous\.metrics,\.\.\.exact\}/);
});

test('protected Worker-first rollout: only new Pages opt in to lazy counters, old Worker result remains valid',()=>{
 assert.ok(source.includes('/v1/admin/dashboard?view=overview&generation_counts=lazy'));
 assert.match(source,/setGenerationStatsLoaded\(typeof metrics\.todayGenerations===\x27number\x27/);
 assert.match(source,/typeof metrics\.monthGenerations===\x27number\x27/);
 assert.match(source,/generationStatsLoaded\?t\("刷新精确次数"/);
});
