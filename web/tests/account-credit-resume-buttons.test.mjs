import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync('web/src/components/account/AccountDashboard.tsx','utf8');
const api=readFileSync('api/src/account.ts','utf8');
const page=readFileSync('web/src/pages/checkout.astro','utf8');
test('account orders show a clear action for pending modern credits and legacy unresolved orders',()=>{
 assert.match(src,/data-credit-continue/);
 assert.match(src,/data-credit-review/);
 assert.match(src,/data-subscription-continue/);
 assert.match(api,/t\.amount_contract/);
 assert.match(src,/href=\{"\/checkout\/\?order="\+encodeURIComponent\(order\.id\)\}/);
 assert.match(page,/lookupUnresolvedCreditOrder/);
 assert.match(page,/resumeExistingCreditOrder/);
});
