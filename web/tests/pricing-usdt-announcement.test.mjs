import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pricing=readFileSync(new URL('../src/pages/pricing.astro',import.meta.url),'utf8');

test('Production pricing announces USDT above both product sections, without a direct pay action',()=>{
 const start=pricing.indexOf('<aside id="pricing-usdt-announcement"');
 const end=pricing.indexOf('</aside>',start);
 assert.ok(start>0&&end>start,'the announcement exists');
 assert.ok(start<pricing.indexOf('id="subscription-section"'),'both subscription and credit buyers see the notice');
 const notice=pricing.slice(start,end);
 assert.match(notice,/hidden aria-live="polite"/);
 assert.match(notice,/data-zh="新增 USDT 支付方式"/);
 assert.match(notice,/Now accepting USDT/);
 assert.match(notice,/订阅和永久额度包现已支持 USDT/);
 assert.match(notice,/Subscriptions and permanent credit packs now support USDT/);
 for(const name of ['TRON','Polygon','BNB Chain','Ethereum','Solana'])assert.ok(notice.includes(name),name);
 assert.match(notice,/以服务端订单为准/);
 assert.doesNotMatch(notice,/<(?:a|button)\b/,'the announcement cannot bypass checkout selection');
});

test('Production announcement is hidden until actual authenticated-independent availability confirms USDT',()=>{
 assert.match(pricing,/const syncUsdtAnnouncement=\(\)=>\{const announcement=document\.getElementById\("pricing-usdt-announcement"\);if\(announcement\)announcement\.hidden=!boltutilAvailable;\}/);
 assert.match(pricing,/boltutilAvailable=state\.available===true&&Array\.isArray\(state\.networks\)&&state\.networks\.length>0/);
 assert.match(pricing,/catch\{boltutilAvailable=false;\}syncUsdtAnnouncement\(\);syncCreditPaymentNotice\(\);render\(\);/);
 assert.match(pricing,/window\.addEventListener\("focus",\(\)=>\{[^\n]*checkBolt\(\)/);
});

test('Pricing preserves one checkout-entry per credit pack and no newly duplicated USDT shortcut',()=>{
 assert.match(pricing,/link\.href=`\/checkout\?package=\$\{encodeURIComponent\(pkg\.id\)\}`/);
 assert.doesNotMatch(pricing,/const crypto=document\.createElement/);
 const banner=pricing.slice(pricing.indexOf('<aside id="pricing-usdt-announcement"'),pricing.indexOf('</aside>')+8);
 assert.doesNotMatch(banner,/\/usdt-checkout/);
});
