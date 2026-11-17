import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pricing=readFileSync(new URL('../src/pages/pricing.astro',import.meta.url),'utf8');

test('Production subscription and permanent credit headings share restrained local typography',()=>{
 assert.equal((pricing.match(/class="section-heading pricing-typography"/g)||[]).length,2);
 assert.match(pricing,/id="subscription-title"/);
 assert.match(pricing,/id="credit-packs-title"/);
 assert.match(pricing,/:global\(\.public-refresh\) \.pricing-typography\{max-width:min\(100%,1040px\)/);
 assert.match(pricing,/:global\(\.public-refresh\) \.pricing-typography :is\(h1,h2\)\{[^\n]*font-size:clamp\(36px,3\.8vw,54px\)/);
 assert.match(pricing,/line-height:1\.2;letter-spacing:-\.025em/);
 assert.match(pricing,/text-wrap:pretty/);
 assert.doesNotMatch(pricing,/pricing-typography[^\n]*font-size:clamp\(48px,6\.2vw,83px\)/);
});

test('Pricing descriptions and mobile headings remain readable without modifying the global design system',()=>{
 assert.match(pricing,/:global\(\.public-refresh\) \.pricing-typography \.lead\{max-width:770px;[^\n]*font-size:clamp\(15px,1\.25vw,17px\);line-height:1\.85/);
 assert.match(pricing,/@media\(max-width:640px\)\{/);
 assert.match(pricing,/font-size:clamp\(30px,7vw,40px\);line-height:1\.24/);
 assert.match(pricing,/\.pricing-typography \.lead\{max-width:none;font-size:15px;line-height:1\.8\}/);
 assert.match(pricing,/pricing-subscription-usdt-chip/);
 assert.match(pricing,/pricing-credit-usdt-chip/);
});

test('Typographic cleanup preserves purchase navigation and backend availability checks',()=>{
 assert.match(pricing,/link\.href=`\/checkout\?package=\$\{encodeURIComponent\(pkg\.id\)\}`/);
 assert.match(pricing,/subscriptionPricingChoices/);
 assert.match(pricing,/\/v1\/boltutil\/availability/);
 assert.match(pricing,/syncUsdtChips\(\)/);
 assert.doesNotMatch(pricing,/<aside[^>]*pricing-usdt-announcement/);
});
