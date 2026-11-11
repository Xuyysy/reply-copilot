import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {featuredPackages,packageSummary,renderFeaturedPackages} from '../src/lib/package-summary.mjs';
const pack={id:'featured',name_zh:'精选套餐',name_en:'Featured pack',credits:400,currency:'USD',price_cents:149,promo_price_cents:null,fee_rate_bps:0,total_payment_fen:990,featured:1,recommended_label_zh:'推荐',recommended_label_en:'Recommended'};
test('homepage uses active CNY configured packages and never advertises unconfigured prices',()=>{
 assert.deepEqual(featuredPackages([pack,{...pack,id:'hidden',featured:0},{...pack,id:'inactive',active:0},{...pack,id:'unpriced',total_payment_fen:null},{...pack,id:'wrongcurrency',currency:'CNY'}]),[pack]);
 const noFeatured={...pack,id:'regular',featured:0};
 assert.deepEqual(featuredPackages([noFeatured]),[noFeatured]);
 assert.deepEqual(featuredPackages(undefined),[]);
});
test('website and checkout use the exact same SELLER CNY price with no buyer fee',()=>{
 const zh=packageSummary(pack,'zh'),en=packageSummary(pack,'en');
 assert.equal(zh.price,'¥9.90');assert.equal(en.price,'¥9.90');
 assert.equal(zh.cny,'人民币实付：¥9.90 CNY');
 assert.equal(zh.fee,'支付手续费由商家承担，结账不额外收取。');
 assert.equal(en.fee,'Payment processing fees are paid by the merchant. No extra charge at checkout.');
 assert.doesNotMatch(zh.price,/\$/);assert.doesNotMatch(en.fee,/buyer processing fee/i);
});
test('historical MK99 and legacy buyer-fee summaries preserve exact charged CNY and existing disclosure',()=>{
 const legacy=packageSummary({...pack,fee_rate_bps:150,total_payment_fen:1006},'en');
 assert.equal(legacy.price,'¥10.06');
 assert.equal(legacy.fee,'Buyer processing fee: 1.50%, included in the CNY total.');
 const mk99={...pack,total_payment_fen:1043,merchant_pricing:{feeBearer:'merchant',rateBps:500,status:'estimate_unverified'}};
 const zh=packageSummary(mk99,'zh');assert.equal(zh.price,'¥10.43');assert.equal(zh.fee,'人民币售价已包含支付渠道成本，收银台不再额外加收。');
 assert.equal(zh.cny,'人民币实付：¥10.43 CNY');
});
test('invalid CNY price does not fall back to misleading old USD amount',()=>{
 const invalid=packageSummary({...pack,total_payment_fen:null},'zh');
 assert.equal(invalid.price,'价格待配置');assert.equal(invalid.cny,'');
});
test('featured renderer displays CNY price as text, supports empty state, and links to all packs',()=>{
 function element(){return {children:[],append(item){this.children.push(item)},replaceChildren(){this.children=[]}}}
 const container=element(),document={createElement:()=>element()};
 renderFeaturedPackages(document,container,[{...pack,name_en:'<img onerror=alert(1)>'}],'en');
 assert.equal(container.hidden,false);assert.equal(container.children[0].children[1].textContent,'<img onerror=alert(1)>');
 assert.equal(container.children[0].children[2].textContent,'¥9.90');
 assert.equal(container.children[0].children.at(-1).href,'/pricing#packages');
 renderFeaturedPackages(document,container,[],'en');assert.equal(container.hidden,true);assert.equal(container.children.length,0);
});
test('home page shows configured credit CNY prices even while subscription plans are visible',()=>{
 const index=readFileSync(fileURLToPath(new URL('../src/pages/index.astro',import.meta.url)),'utf8');
 const checkout=readFileSync(fileURLToPath(new URL('../src/pages/checkout.astro',import.meta.url)),'utf8');
 assert.match(index,/id="home-credit-packages"/);
 assert.match(index,/renderFeaturedPackages\(document,container,featuredSource/);
 assert.doesNotMatch(index,/if\(homeSubscriptions\)\{container\.hidden=true/);
 assert.match(checkout,/官网标价：¥/);
 assert.doesNotMatch(checkout,/美元价格：\$/);
});
