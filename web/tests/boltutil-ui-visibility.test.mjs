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
 assert.match(credit,/uniquePaymentMethods\(paymentMethods\.filter\(method=>method\.provider===provider\)\)/);
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
 assert.match(subscription,/name="subscription-intent"/);
 assert.match(subscription,/setUpgrade\(true\)/);
 assert.match(subscription,/setUpgrade\(false\)/);
 assert.match(subscription,/!canUpgrade/);
 assert.match(subscription,/\/v1\/boltutil\/availability/);
 assert.doesNotMatch(subscription,/>小豆支付</);
 assert.doesNotMatch(subscription,/>MK99 支付</);
});
test('five USDT networks are previewed for in-site checkout, but new order buttons are gated by availability',()=>{
 for(const code of ["TRC20","POLYGON","BEP20","ERC20","SOLANA"])assert.match(checkout,new RegExp('value="'+code+'"'));
 assert.match(checkout,/<div[^>]*id="bolt-chain-picker"[^>]*>/);
 assert.doesNotMatch(checkout,/<div[^>]*id="bolt-chain-picker"[^>]*\shidden\b/);
 assert.match(checkout,/chain\.disabled=true;/);
 assert.match(checkout,/if\(!availability\.available/);
 assert.match(checkout,/chain\.disabled=false;/);
 assert.match(checkout,/支持 TRON、Polygon、BNB、Ethereum 和 Solana/);
 assert.match(checkout,/await api<\{order:Order\}>\("\/v1\/boltutil\/orders"/);
});
test('Admin V2 has independent audited USDT operator controls and read-only payment evidence',()=>{
 assert.match(admin,/import AdminBoltUtilPanel from/);
 assert.match(admin,/\["boltutil",t\("USDT 收款","USDT payments"\)\]/);
 assert.match(admin,/<TabsContent value="boltutil"><AdminBoltUtilPanel active=\{tab==="boltutil"\}/);
 assert.match(panel,/data-testid="admin-boltutil-usdt"/);
 assert.match(panel,/\/v1\/admin\/boltutil\/orders/);
 assert.match(panel,/\/v1\/boltutil\/availability/);
 for(const code of ["TRC20","POLYGON","BEP20","ERC20","SOLANA"])assert.match(panel,new RegExp('code:"'+code+'"'));
 assert.match(panel,/\/v1\/admin\/boltutil\/control/);
 assert.match(panel,/confirm:true,reason:reason\.trim\(\)/);
 assert.match(panel,/Orders below are read-only/);
 assert.doesNotMatch(panel,/write\("\/v1\/boltutil\/orders"/);
 assert.match(panel,/币种单独记录/);
});

test('Staging buyer pays on-site with an exact signed provider invoice, not a BoltUtil outbound checkout',()=>{
 assert.match(checkout,/id="bolt-qr"/);
 assert.match(checkout,/QRCode\.toDataURL/);
 assert.match(checkout,/order\.status==="pending"&&!!order\.address&&!!order\.amount/);
 assert.match(checkout,/navigator\.clipboard\.writeText/);
 assert.match(checkout,/setInterval/);
 assert.match(checkout,/order\.entitlementApplied/);
 assert.match(checkout,/USDT 合约\/Mint/);
 assert.doesNotMatch(checkout,/link\.href=order\.checkoutUrl/);
 assert.doesNotMatch(checkout,/window\.location\s*=\s*order\.checkoutUrl/);
});

test('Native checkout can recover uncertain orders across reloads without opening BoltUtil and without storing wallet secrets',()=>{
 assert.match(checkout,/sessionStorage\.setItem\(storageKey,JSON\.stringify\(fresh\)\)/);
 assert.match(checkout,/saveAttempt\(network,attempt\)/);
 assert.match(checkout,/idempotencyKey:attempt\.key/);
 assert.match(checkout,/attempt\.quoteId=quote\.quote\.id/);
 assert.match(checkout,/clearAttempt\(next\.network\)/);
 assert.match(checkout,/\/v1\/boltutil\/orders"\)/);
 assert.match(checkout,/id="bolt-recent-orders"/);
 assert.match(checkout,/recentList\.replaceChildren\(\)/);
 assert.match(checkout,/rows\.length===0/);
 assert.doesNotMatch(checkout,/sessionStorage\.setItem\([^\n]*(?:address|amount|API_KEY|WEBHOOK)/);
});

test('Five-chain payment page distinguishes recipient amount from network fee, with no invented fixed gas estimate',()=>{
 assert.match(checkout,/id="bolt-fee-guidance"/);
 assert.match(checkout,/id="bolt-gas-info"/);
 for(const [network,token] of [['TRC20','TRX'],['POLYGON','POL'],['BEP20','BNB'],['ERC20','ETH'],['SOLANA','SOL']]){
  assert.match(checkout,new RegExp(network+':"'+token+'"'));
 }
 assert.match(checkout,/gasInfo\.textContent=t\(/);
 assert.match(checkout,/order\.amount\+" USDT"/);
 assert.match(checkout,/实际到账数量/);
 assert.match(checkout,/手续费可能从账户余额或提币金额中扣除/);
 assert.match(checkout,/never subtract it from the invoice amount/);
 assert.doesNotMatch(checkout,/gasFeeEstimate\s*=\s*[0-9]/);
});

test('USDT subscription conflict gives user an owner-scoped fiat + crypto original-order recovery, not a retrying cashier',()=>{
 assert.match(checkout,/id="bolt-subscription-blocker"/);
 assert.match(checkout,/id="bolt-blocker-list"/);
 assert.match(checkout,/SUBSCRIPTION_PENDING_ORDER/);
 assert.match(checkout,/SUBSCRIPTION_RENEWAL_QUEUED/);
 assert.match(checkout,/await showSubscriptionBlockers\(\)/);
 assert.match(checkout,/Promise\.allSettled\(\[/);
 assert.match(checkout,/api<\{orders:FiatSubscription\[\]\}>\("\/v1\/subscriptions\/orders"\)/);
 assert.match(checkout,/api<\{orders:Order\[\]\}>\("\/v1\/boltutil\/orders"\)/);
 assert.match(checkout,/\/subscription-checkout\/\?order=/);
 assert.match(checkout,/\/usdt-checkout\/\?order=/);
 assert.match(checkout,/periodStatus==="queued"/);
 assert.match(checkout,/item\.checkout\?\.paymentConfirmed===true/);
 assert.match(checkout,/if\(subscriptionConflict\)control\(/);
 assert.doesNotMatch(checkout,/if\(subscriptionConflict\)control\([^\n]*create\(\)/);
 assert.match(checkout,/blockerList\.replaceChildren\(\)/);
 assert.match(checkout,/await.*showSubscriptionBlockers/);
});

test('Production-aligned USDT subscriber blocker lookup includes fiat and paid queued USDT renewals',()=>{
 assert.match(checkout,/\/v1\/boltutil\/subscription-blockers/);
 assert.match(checkout,/rail:"fiat"\|"usdt"\|"account"/);
 assert.match(checkout,/item\.status==="queued"/);
 assert.match(checkout,/item\.rail==="usdt"\?"\/usdt-checkout\/\?order="/);
 assert.match(checkout,/item\.rail==="fiat"\?"\/subscription-checkout\/\?order="/);
 assert.match(checkout,/Older API or temporary network error/);
 assert.doesNotMatch(checkout,/cancelBoltOrder|confirmBoltPaymentWithoutProvider/);
});

test("Staging admin only shows five-chain payment operations, not retired mainnet probe",()=>{
 const sub=readFileSync(new URL('../src/components/account/SubscriptionCheckout.tsx',import.meta.url),'utf8');
 assert.match(sub,/TRON \/ Polygon \/ BNB \/ Ethereum \/ Solana/);
 assert.match(sub,/下一步选择 TRON、Polygon、BNB、Ethereum 或 Solana 网络/);
 assert.doesNotMatch(sub,/下一步选择 TRON、Polygon 或 BNB/);
 assert.match(panel,/lg:grid-cols-5/);
 assert.doesNotMatch(panel,/admin-boltutil-mainnet-test/);
 assert.doesNotMatch(panel,/\/v1\/admin\/boltutil\/test-orders/);
 assert.doesNotMatch(panel,/createMainnetTest|setProbes/);
 assert.match(panel,/USDT 独立订单与异常记录/);
 assert.match(panel,/查看用户端五链收银台/);
});
