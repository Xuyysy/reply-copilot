import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/components/account/SubscriptionCheckout.tsx',import.meta.url),'utf8');
test('subscription cancel needs explicit confirmation and merchant status before buy-again link',()=>{
 assert.match(source,/window\.confirm\(/);
 assert.match(source,/\/'\+id\+'\/cancel'/);
 assert.match(source,/order\.merchantProvider==='xiaodou'&&order\.status==='pending'/);
 assert.match(source,/\['closed','failed'\]\.includes\(order\.status\)/);
});

test('legacy fiat cancellation explicitly excludes USDT and remains merchant-confirmed',()=>{
 assert.match(source,/仅申请关闭当前这笔人民币原订单，不会取消 USDT 订单/);
 assert.match(source,/申请关闭本笔人民币原订单/);
 assert.match(source,/order\.merchantProvider==='xiaodou'&&order\.status==='pending'/);
});
