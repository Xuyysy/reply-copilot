import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const component=readFileSync(fileURLToPath(new URL('../src/components/account/AccountDashboard.tsx',import.meta.url)),'utf8');
test('both order groups surface the original checkout actions without creating fresh orders',()=>{
  assert.match(component,/data-subscription-continue/);
  assert.match(component,/data-subscription-verify/);
  assert.match(component,/data-credit-continue/);
  assert.match(component,/t\("继续支付","Continue payment"\)/);
  assert.match(component,/href=\{"\/subscription-checkout\/\?order="\+encodeURIComponent\(order\.id\)\}/);
  assert.match(component,/href=\{"\/checkout\/\?order="\+encodeURIComponent\(order\.id\)\}/);
  assert.match(component,/order\.status==='pending'&&order\.riskState==='clear'&&!order\.checkout\.paymentConfirmed/);
  assert.match(component,/order\.payment_protocol==="rsa2"\|\|order\.payment_protocol==="epay"/);
  assert.match(component,/order\.payment_status==="pending"&&order\.risk_state==="clear"/);
  assert.match(component,/data-unresolved-order-shortcut/);
  assert.match(component,/data-credit-orders className=/);
  assert.match(component,/data-subscription-orders className=/);
  assert.doesNotMatch(component,/onClick=\{\(\)=>.*\/v1\/orders.*POST/);
});

test('Xiaodou credit resume button reads the original order, then safely reissues a new attempt only on explicit click',()=>{
  assert.match(component,/async function continueXiaodouCredit\(orderId:string\)/);
  assert.match(component,/path\+"\/attempts"/);
  assert.match(component,/!current\.paymentUrl/);
  assert.match(component,/attempt\.orderStatus!=="pending"/);
  assert.match(component,/!notices\.current!\.isOwner\(owner\)/);
  assert.match(component,/navigateVerifiedCashier\(current\.paymentUrl,\{allowedOrigin:current\.paymentCashierOrigin\}\)/);
  assert.match(component,/onClick=\{\(\)=>void continueXiaodouCredit\(order\.id\)\}/);
  assert.doesNotMatch(component,/continueXiaodouCredit\([^)]*\)\s*;\s*\}\s*,\s*\[\]/);
});
