import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=readFileSync(new URL('../src/components/admin/AdminBoltUtilPanel.tsx',import.meta.url),'utf8');
const panel=readFileSync(new URL('../src/components/admin/AdminBoltReconciliationPanel.tsx',import.meta.url),'utf8');
const router=readFileSync(new URL('../../api/src/index.ts',import.meta.url),'utf8');
const service=readFileSync(new URL('../../api/src/boltutil/reconciliation.ts',import.meta.url),'utf8');
test('admin USDT view includes independent read-only exception queue and evidence inspector',()=>{
 assert.match(root,/AdminBoltReconciliationPanel active=\{active\}/);
 assert.match(panel,/data-testid="boltutil-reconciliation"/);
 assert.match(panel,/\\/v1\\/admin\\/boltutil\\/reconciliation/);
 assert.match(panel,/\\/v1\\/admin\\/boltutil\\/orders\\/"/);
 assert.match(panel,/providerEvents/);
 assert.match(panel,/matchedRecordedReceipts/);
 assert.match(panel,/ledger_grants/);
 assert.match(panel,/nextCursor/);
 assert.match(panel,/no on-chain query or order mutation/);
 assert.doesNotMatch(panel,/markAsPaid|forceGrant|creditUser|confirmPayment|window\\.fetch\\(\\s*["']https:\\/\\/boltutil/i);
});
test('reconciliation routes and storage implementation are GET-only and admin guarded',()=>{
 assert.match(router,/request\\.method==="GET"&&path==="\\/v1\\/admin\\/boltutil\\/reconciliation"/);
 assert.match(router,/request\\.method==="GET"&&boltEvidenceMatch/);
 assert.match(service,/await requireAdminSession\\(request,env\\)/);
 assert.match(service,/boltReadSchemaReady\\(env\\)/);
 assert.doesNotMatch(service,/\\.run\\(|\\.batch\\(|\\.exec\\(|fetch\\(|settleBoltPayment|paid_balance\\s*=/);
 assert.match(service,/LIMIT 25/);
 assert.match(service,/filter\\.limit\\+1/);
});
