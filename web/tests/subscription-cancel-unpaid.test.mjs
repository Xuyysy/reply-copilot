import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/components/account/SubscriptionCheckout.tsx',import.meta.url),'utf8');

test('original fiat checkout retains cashier, verification and closed-order re-purchase',()=>{
 assert.match(source,/打开原订单收银台/);
 assert.match(source,/查验付款状态/);
 assert.match(source,/返回账户查看权益/);
 assert.match(source,/\['closed','failed'\]\.includes\(order\.status\)/);
 assert.match(source,/返回套餐页重新购买/);
});

test('retired QR regeneration and fiat order closure are not shown or called by subscription checkout',()=>{
 assert.doesNotMatch(source,/重新生成原订单二维码|Generate new QR code for this order/);
 assert.doesNotMatch(source,/申请关闭本笔人民币原订单|Request closure of this fiat order/);
 assert.doesNotMatch(source,/act\('relaunch'\)|act\('cancel'\)/);
 assert.doesNotMatch(source,/\/attempts'|\/cancel'/);
 assert.match(source,/act\('refresh'\)/);
 assert.match(source,/付款入口可能已失效|原收银台入口可能已失效/);
});

test('Xiaodou and MK99 expose explicit local cancellation without bringing back redundant merchant controls',()=>{
 assert.match(source,/['"]local-cancel['"]/);
 assert.match(source,/想重新购买其他套餐？/);
 assert.match(source,/之前打开的支付页面仍可能收款/);
 assert.match(source,/confirm:true/);
 assert.match(source,/付款状态/);
 assert.doesNotMatch(source,/重新生成原订单二维码|申请关闭本笔人民币原订单/);
});
