import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');

test('admin directory does not misrepresent intentionally omitted lifetime counts as zero',()=>{
 assert.match(ui,/generations: number \| null/);
 assert.match(ui,/user\.generations == null \? <span[^>]*>\{t\("详情内按需查询准确次数", "Load exact count in details"\)\}/);
 assert.match(ui,/user\.last_active_at\?date\(user\.last_active_at,language\):t\("详情查看", "View details"\)/);
 assert.doesNotMatch(ui,/user\.generations \|\| 0/);
});

test('on-demand user detail explicitly requests exact lifetime ACK count and retains last activity',()=>{
 assert.match(ui,/generations \?\? "—"/);
 assert.match(ui,/loadUserGenerationCount\(\)/);
 assert.match(ui,/detail\.user\.last_active_at \? date\(detail\.user\.last_active_at, language\) : "—"/);
 assert.match(ui,/read<UserDetail>\(\`\/v1\/admin\/users\/\$\{encodeURIComponent\(user\.id\)\}\?view=light\`\)/);
});
