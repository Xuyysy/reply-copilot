import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const checkout=readFileSync(new URL('../src/pages/checkout.astro',import.meta.url),'utf8');
test('checkout identifies Alipay and offers no unavailable channel selector',()=>{
 assert.match(checkout,/支付宝 Alipay/);assert.match(checkout,/checkoutPaymentTitle/);
 assert.match(checkout,/checkoutPayButton/);assert.doesNotMatch(checkout,/创建订单 · ¥/);
 assert.doesNotMatch(checkout,/<(?:option|input)[^>]*(?:wechat|weixin)/i);
});
test('Alipay presentation retains server amount and explicit existing form submission',()=>{
 assert.match(checkout,/selected\.total_payment_fen/);assert.match(checkout,/next\.amountFen/);assert.match(checkout,/fee_rate_bps/);
 assert.match(checkout,/submitEpayForm\(/);assert.match(checkout,/epay-restore-label/);
 assert.match(checkout,/checkout-pay-button/);
});
test('checkout action and cashier labels follow the selected payment channel',()=>{
 assert.match(checkout,/paymentActionLabel/);
 assert.match(checkout,/selectedChannel===\"WECHAT_H5\"/);
 assert.match(checkout,/paymentChannel===\"WECHAT_H5\"/);
 assert.match(checkout,/byId\("cashier-link"\)\.textContent=paymentActionLabel/);
});
test('channel-specific checkout labels are excluded from static CMS replacement and selected route is submitted',()=>{
 assert.match(checkout,/<span id="create-order-label"[^>]*data-site-dynamic-text/);
 assert.match(checkout,/<span id="epay-pay-text"[^>]*data-site-dynamic-text/);
 assert.match(checkout,/input\.addEventListener\("change",\(\)=>\{\s*paymentRail='fiat';\s*selectedChannel=method\.channel;\s*selectedProvider=method\.provider;\s*render\(\);?\s*\}\)/);
 assert.match(checkout,/provider:selectedProvider,channel:selectedChannel/);
});
