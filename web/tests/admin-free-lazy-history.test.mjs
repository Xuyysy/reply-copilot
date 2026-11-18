import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');

test('collapsed legacy KPI panel is opt-in and never displays unloaded historical money as zero',()=>{
 assert.match(src,/const \[historyOpen, setHistoryOpen\] = useState\(false\)/);
 assert.match(src,/const \[historyLoaded, setHistoryLoaded\] = useState\(false\)/);
 assert.match(src,/onToggle=\{event=>\{setHistoryOpen\(event\.currentTarget\.open\)/);
 assert.match(src,/!historyLoaded\?<p role="status"/);
 assert.match(src,/Could not load historical metrics/);
 assert.match(src,/Close and reopen to retry/);
 assert.match(src,/<\/p>:<div className="mt-3 grid grid-cols-2/);
});

test('history loads only on overview expansion and restores on refresh without duplicate accounting',()=>{
 assert.match(src,/if\(access!=="ready"\|\|tab!=="overview"\|\|!historyOpen\|\|historyLoaded\|\|historyLoadFailed\)return;/);
 assert.match(src,/read<Metrics>\("\/v1\/admin\/dashboard\?view=history"\)\.then\(history=>/);
 assert.match(src,/if\(!live\)return;/);
 assert.match(src,/metrics:\{\.\.\.previous\.metrics,\.\.\.history\}/);
 assert.match(src,/setHistoryLoaded\(false\); setHistoryLoadFailed\(false\)/);
 assert.match(src,/setHistoryLoaded\(true\)/);
 assert.match(src,/setHistoryLoadFailed\(true\)/);
});
