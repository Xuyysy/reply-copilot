import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const admin=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');
const ledger=readFileSync(new URL('../src/components/admin/AdminUsageLedger.tsx',import.meta.url),'utf8');

test('Admin V2 puts subscription deliveries and credit usage in one lazily loaded operator view',()=>{
 assert.match(admin,/AdminUsageLedger active=\{tab==="ledger"\}/);
 assert.match(ledger,/\/v1\/admin\/usage-ledger/);
 assert.match(ledger,/subscription/);
 assert.match(ledger,/free/);
 assert.match(ledger,/paid/);
 assert.match(ledger,/\brequest_id\b/);
 assert.match(ledger,/nextCursor/);
 assert.match(ledger,/hasMore/);
 assert.match(ledger,/source_evidence/);
 assert.match(ledger,/ACK/);
});

test('Legacy grant and refund ledger remains accessible only on demand',()=>{
 assert.match(ledger,/mode==='changes'/);
 assert.match(ledger,/\/v1\/admin\/ledger/);
 assert.match(ledger,/purchase_reversal/);
 assert.match(ledger,/admin_adjustment/);
 assert.doesNotMatch(admin,/read<\{ ledger: Ledger\[\] \}>\("\/v1\/admin\/ledger"\)/);
});

test('Admin views keep existing financial and security panels isolated',()=>{
 assert.match(admin,/SubscriptionAdminPanel/);
 assert.match(admin,/SecurityPaymentPanel/);
 assert.match(admin,/AIModelManagementPanel/);
 assert.match(admin,/\/v1\/admin\/orders/);
 assert.match(admin,/\/v1\/admin\/reauth/);
 assert.doesNotMatch(ledger,/\/v1\/admin\/.*\/hold/);
});
