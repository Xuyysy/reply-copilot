import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('owner cancellation is offered for old MK99/Xiaodou subscription and credit orders',()=>{
 const account=read('../src/components/account/AccountDashboard.tsx');
 const checkout=read('../src/components/account/SubscriptionCheckout.tsx');
 const credits=read('../src/pages/checkout.astro');
 assert.match(checkout,/想重新购买其他套餐？/);
 assert.match(checkout,/\/local-cancel/);
 assert.match(account,/想重新购买其他套餐？/);
 assert.match(account,/想更换额度包或支付方式？/);
 assert.match(account,/cancelFiatOrder\(order\.id,"subscription"\)/);
 assert.match(account,/cancelFiatOrder\(order\.id,"credits"\)/);
 assert.match(credits,/cancel-unpaid-order/);
 assert.match(credits,/想更换额度包或支付方式？/);
 assert.match(credits,/\/local-cancel/);
 assert.match(credits,/confirm:true/);
});

test('late verified credits appear as held for review instead of falsely credited',()=>{
 const account=read('../src/components/account/AccountDashboard.tsx');
 const credits=read('../src/pages/checkout.astro');
 assert.match(account,/order\.risk_state==="manual_review"\?t\("付款待人工核对"/);
 assert.match(credits,/款项正在人工核对，未自动发放额度/);
 assert.match(credits,/next\.status==="paid"&&!next\.creditedAt/);
});
