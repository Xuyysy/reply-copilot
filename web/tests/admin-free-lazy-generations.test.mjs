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
