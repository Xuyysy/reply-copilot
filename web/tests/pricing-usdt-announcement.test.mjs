import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pricing=readFileSync(new URL('../src/pages/pricing.astro',import.meta.url),'utf8');

test('Production pricing uses two unobtrusive USDT chips beside product section labels, not a full-width banner',()=>{
 assert.doesNotMatch(pricing,/id="pricing-usdt-announcement"/);
 assert.doesNotMatch(pricing,/pricing-usdt-announcement-inner/);
 const sub=pricing.indexOf('id="pricing-subscription-usdt-chip"');
 const credit=pricing.indexOf('id="pricing-credit-usdt-chip"');
 assert.ok(sub>pricing.indexOf('id="subscription-eyebrow"'),'subscription chip follows its existing small label');
 assert.ok(sub<pricing.indexOf('id="subscription-title"'),'subscription chip precedes the headline');
 assert.ok(credit>pricing.indexOf('data-zh="独立购买 · 超量补充"'),'credit chip follows its section label');
 assert.ok(credit<pricing.indexOf('id="credit-packs-title"'),'credit chip precedes the credit-pack headline');
 assert.equal((pricing.match(/class="pricing-usdt-chip" hidden/g)||[]).length,2,'both chips start hidden');
 assert.equal((pricing.match(/data-zh="NEW · USDT 支付">NEW · USDT payments/g)||[]).length,2);
 assert.match(pricing,/\.pricing-payment-kicker\{display:flex;align-items:center;gap:10px;flex-wrap:wrap;/);
 assert.match(pricing,/\.pricing-usdt-chip\[hidden\]\{display:none\}/);
});

test('USDT chips follow verified availability and remain hidden on error or disabled networks',()=>{
 assert.match(pricing,/const syncUsdtChips=\(\)=>\{for\(const id of \["pricing-subscription-usdt-chip","pricing-credit-usdt-chip"\]\)/);
 assert.match(pricing,/if\(chip\)chip\.hidden=!boltutilAvailable/);
 assert.match(pricing,/boltutilAvailable=state\.available===true&&Array\.isArray\(state\.networks\)&&state\.networks\.length>0/);
 assert.match(pricing,/catch\{boltutilAvailable=false;\}syncUsdtChips\(\);syncCreditPaymentNotice\(\);render\(\);/);
 assert.match(pricing,/window\.addEventListener\("focus",\(\)=>\{[^\n]*checkBolt\(\)/);
});

test('USDT announcement does not duplicate checkout buttons or alter credit and subscription purchases',()=>{
 assert.match(pricing,/link\.href=`\/checkout\?package=\$\{encodeURIComponent\(pkg\.id\)\}`/);
 assert.match(pricing,/subscriptionPricingChoices/);
 assert.doesNotMatch(pricing,/const crypto=document\.createElement/);
 assert.doesNotMatch(pricing,/<aside[^>]*pricing-usdt-announcement/);
 const chipArea=pricing.slice(0,pricing.indexOf('<script>'));
 assert.doesNotMatch(chipArea,/\/usdt-checkout\//);
});
