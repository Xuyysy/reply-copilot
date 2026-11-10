import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/components/admin/SecurityPaymentPanel.tsx',import.meta.url),'utf8');

test('payment admin exposes native RSA2 controls while retaining legacy Epay callback status only',()=>{
 assert.match(source,/RSA2 Open API/);
 assert.match(source,/易支付：历史协议/);
 assert.doesNotMatch(source,/启用易支付新订单/);
 assert.match(source,/rsa2WechatEnabled/);
 assert.match(source,/rsa2AlipayEnabled/);
 assert.match(source,/epayAlipayEnabled/);
 assert.match(source,/rsa2WechatReleased/);
 assert.match(source,/rsa2AlipayReleased/);
 assert.match(source,/epayAlipayReleased/);
 assert.match(source,/<details/);
 assert.match(source,/purchase_enabled|全站收款总开关|Global purchase switch/);
});
