import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
const pricing=read('../src/pages/pricing.astro');
const credits=read('../src/pages/checkout.astro');
const subscription=read('../src/components/account/SubscriptionCheckout.tsx');
const usdt=read('../src/pages/usdt-checkout.astro');

test('Production pricing keeps a single action per subscription and credit purchase',()=>{
 assert.match(pricing,/for\(const action of chosen\?\[chosen\]:\[\]\)/);
 assert.match(pricing,/购买额度包/);
 assert.doesNotMatch(pricing,/id="usdt-payment-method"/);
});
test('Production credit checkout filters active merchant and revalidates before a new order',()=>{
 assert.match(credits,/paymentMethods=\(data\.paymentMethods\?\?\[\]\)\.filter\(m=>m\.provider===data\.paymentProvider\)/);
 assert.match(credits,/latest\.paymentProvider!==selectedProvider/);
 assert.match(credits,/paymentRail:'fiat'\|'usdt'/);
 assert.match(credits,/paymentMethods=\[\];selectedChannel=null;selectedProvider=null/);
 assert.match(credits,/paymentRail==='fiat'/);
});
test('Production subscription checkout retains original-order retry and filters fiat methods',()=>{
 assert.match(subscription,/const visibleFiat=/);
 assert.match(subscription,/api<Catalog>\('\/v1\/subscriptions\/plans'\)/);
 assert.match(subscription,/setMethodsLoading\(true\)/);
 assert.match(subscription,/PAYMENT_METHOD_CHANGED/);
 assert.match(subscription,/retryAvailable===true/);
 assert.match(subscription,/setBlockingOrder/);
 assert.match(subscription,/\<strong\>USDT\<\/strong\>/);
});
test('Production USDT preview leaves merchant controls backend-owned and fail-closed',()=>{
 assert.match(usdt,/\/v1\/boltutil\/availability/);
 assert.match(usdt,/if\(!availability\.available/);
 assert.match(usdt,/chain\.disabled=true/);
 assert.match(usdt,/TRC20/);
 assert.match(usdt,/POLYGON/);
 assert.match(usdt,/BEP20/);
});
