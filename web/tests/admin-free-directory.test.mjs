import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');

test('admin directory does not misrepresent intentionally omitted lifetime counts as zero',()=>{
 assert.match(ui,/generations: number \| null/);
 assert.match(ui,/user\.generations == null \? <span[^>]*>\{t\("详情查看准确次数", "Open details for exact count"\)\}/);
 assert.match(ui,/user\.last_active_at\?date\(user\.last_active_at,language\):t\("详情查看", "View details"\)/);
 assert.doesNotMatch(ui,/user\.generations \|\| 0/);
});

test('on-demand user detail retains exact lifetime count and last activity',()=>{
 assert.match(ui,/detail\.user\.generations \?\? "—"/);
 assert.match(ui,/detail\.user\.last_active_at \? date\(detail\.user\.last_active_at, language\) : "—"/);
 assert.match(ui,/read<UserDetail>\(\`\/v1\/admin\/users\/\$\{encodeURIComponent\(user\.id\)\}\`\)/);
});
