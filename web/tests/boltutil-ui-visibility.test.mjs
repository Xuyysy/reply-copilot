import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pricing=readFileSync(new URL('../src/pages/pricing.astro',import.meta.url),'utf8');
const checkout=readFileSync(new URL('../src/pages/usdt-checkout.astro',import.meta.url),'utf8');
const admin=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');
const panel=readFileSync(new URL('../src/components/admin/AdminBoltUtilPanel.tsx',import.meta.url),'utf8');

test('pricing has one purchase action per product; payment choices live in checkout',()=>{
 assert.doesNotMatch(pricing,/id="usdt-payment-method"/);
 assert.doesNotMatch(pricing,/const upgrade=document.createElement/);
 const subs=pricing.slice(pricing.indexOf("function renderSubscriptions()"),pricing.indexOf("async function loadSubscriptions()"));
 assert.match(subs,/buy\.href='\/subscription-checkout\/\?plan='/);
 assert.doesNotMatch(subs,/usdt-checkout/);
 const packs=pricing.slice(pricing.indexOf("function render(){const box"),pricing.indexOf("async function load(){"));
 assert.match(packs,/link\.href=\`\/checkout\?package=/);
 assert.doesNotMatch(packs,/const usdt=document.createElement/);
});
test('permanent credit checkout only renders backend-authorized fiat methods plus independent USDT',()=>{
 const credit=readFileSync(new URL('../src/pages/checkout.astro',import.meta.url),'utf8');
 assert.match(credit,/uniquePaymentMethods\(paymentMethods\)/);
 assert.match(credit,/paymentRail==='fiat'/);
 assert.match(credit,/const usdtRadio=document\.createElement/);
 assert.match(credit,/\/v1\/boltutil\/availability/);
 assert.match(credit,/\/v1\/packages/);
 assert.match(credit,/paymentMethods\.some\(m=>m\.provider===selectedProvider&&m\.channel===selectedChannel\)/);
 assert.match(credit,/selectedChannel=paymentMethods\[0\]\?\.channel/);
 assert.doesNotMatch(credit,/扫码后将在手机微信中打开小豆收银台/);
});
test('subscription checkout revalidates paid methods and does not reveal backend merchant names',()=>{
 const subscription=readFileSync(new URL('../src/components/account/SubscriptionCheckout.tsx',import.meta.url),'utf8');
 assert.match(subscription,/visibleFiat\(fresh\)/);
 assert.match(subscription,/window\.addEventListener\('focus',onFocus\)/);
 assert.match(subscription,/document\.addEventListener\('visibilitychange',onVisible\)/);
 assert.match(subscription,/const fresh=await api<Catalog>\('\/v1\/subscriptions\/plans'\)/);
 assert.match(subscription,/if\(rail!=='fiat'\|\|!methods\.includes\(channel\)\)/);
 assert.match(subscription,/fiatMethods\.map\(value=>/);
 assert.match(subscription,/usdtHref/);
 assert.match(subscription,/\/v1\/boltutil\/availability/);
 assert.doesNotMatch(subscription,/>小豆支付</);
 assert.doesNotMatch(subscription,/>MK99 支付</);
});
test('three networks are visible for checkout preview, but new order buttons are gated by availability',()=>{
 for(const code of ["TRC20","POLYGON","BEP20"])assert.match(checkout,new RegExp('value="'+code+'"'));
 assert.match(checkout,/<div id="bolt-chain-picker"[^>]*>/);
 assert.doesNotMatch(checkout,/<div id="bolt-chain-picker"[^>]*\shidden\b/);
 assert.match(checkout,/chain\.disabled=true;/);
 assert.match(checkout,/if\(!availability\.available/);
 assert.match(checkout,/chain\.disabled=false;/);
 assert.match(checkout,/report\("支持 TRON \(TRC20\)、Polygon 和 BNB/);
 assert.match(checkout,/await api<\{order:Order\}>\("\/v1\/boltutil\/orders"/);
});
test('Admin V2 has visible independent USDT tab including mobile nav, not only a hidden backend API',()=>{
 assert.match(admin,/import AdminBoltUtilPanel from/);
 assert.match(admin,/\["boltutil",t\("USDT 收款","USDT payments"\)\]/);
 assert.match(admin,/<TabsContent value="boltutil"><AdminBoltUtilPanel active=\{tab==="boltutil"\}/);
 assert.match(panel,/data-testid="admin-boltutil-usdt"/);
 assert.match(panel,/\/v1\/admin\/boltutil\/orders/);
 assert.match(panel,/\/v1\/boltutil\/availability/);
 for(const code of ["TRC20","POLYGON","BEP20"])assert.match(panel,new RegExp('code:"'+code+'"'));
 assert.match(panel,/Read-only:/);
 assert.doesNotMatch(panel,/<Button[^>]*onClick=\{[^}]*post/i);
 assert.match(panel,/币种单独记录/);
});
