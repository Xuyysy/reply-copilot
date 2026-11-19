import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=readFileSync(new URL('../src/components/admin/AdminBoltUtilPanel.tsx',import.meta.url),'utf8');
const panel=readFileSync(new URL('../src/components/admin/AdminBoltReconciliationPanel.tsx',import.meta.url),'utf8');
const router=readFileSync(new URL('../../api/src/index.ts',import.meta.url),'utf8');
const service=readFileSync(new URL('../../api/src/boltutil/reconciliation.ts',import.meta.url),'utf8');
test('admin USDT view includes independent read-only exception queue and evidence inspector',()=>{
 assert.ok(root.includes('AdminBoltReconciliationPanel active={active&&historyOpen}'));
 assert.ok(panel.includes('data-testid="boltutil-reconciliation"'));
 assert.ok(panel.includes('/v1/admin/boltutil/reconciliation'));
 assert.ok(panel.includes('/v1/admin/boltutil/orders/'));
 assert.ok(panel.includes('providerEvents'));
 assert.ok(panel.includes('matchedRecordedReceipts'));
 assert.ok(panel.includes('ledger_grants'));
 assert.ok(panel.includes('nextCursor'));
 assert.ok(panel.includes('no on-chain query or order mutation'));
 for(const token of ['markAsPaid','forceGrant','creditUser','confirmPayment','window.fetch("https://boltutil'])
  assert.ok(!panel.includes(token),token);
});
test('reconciliation routes and storage implementation are GET-only and admin guarded',()=>{
 assert.ok(router.includes('request.method==="GET"&&path==="/v1/admin/boltutil/reconciliation"'));
 assert.ok(router.includes('request.method==="GET"&&boltEvidenceMatch'));
 assert.ok(service.includes('await requireAdminSession(request,env)'));
 assert.ok(service.includes('boltReadSchemaReady(env)'));
 for(const token of ['.run(','.batch(','.exec(','fetch(','settleBoltPayment','paid_balance='])
  assert.ok(!service.includes(token),token);
 assert.ok(service.includes('LIMIT 25'));
 assert.ok(service.includes('filter.limit+1'));
});

test('CF Free: closed USDT history never loads order list or cross-ledger reconciliation',()=>{
 assert.match(root,/data-testid="boltutil-history-details" onToggle=\{event=>setHistoryOpen\(event\.currentTarget\.open\)\}/);
 assert.match(root,/const \[historyOpen,setHistoryOpen\]=useState\(false\)/);
 assert.match(root,/if\(!active\|\|!historyOpen\)return;/);
 const overview=root.slice(root.indexOf('useEffect(()=>{'),root.indexOf('// Historical invoices are intentionally cold'));
 assert.match(overview,/\/v1\/boltutil\/availability/);
 assert.match(overview,/\/v1\/admin\/boltutil\/control/);
 assert.doesNotMatch(overview,/\/v1\/admin\/boltutil\/orders/);
 assert.match(root,/api<AdminResponse>\("\/v1\/admin\/boltutil\/orders"\)/);
 assert.match(root,/AdminBoltReconciliationPanel active=\{active&&historyOpen\}/);
 assert.match(panel,/if\(!active\)return;/);
 assert.match(root,/historyLoading&&/);
 assert.match(root,/historyError&&/);
 assert.doesNotMatch(root,/setHistoryOpen\(true\)/);
});
