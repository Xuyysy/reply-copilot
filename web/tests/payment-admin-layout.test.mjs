import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/components/admin/SecurityPaymentPanel.tsx',import.meta.url),'utf8');

test('payment admin separates RSA2 and Epay channels and keeps platform release distinct from channel enablement',()=>{
 assert.match(source,/RSA2 Open API/);
 assert.match(source,/易支付 Epay/);
 assert.match(source,/rsa2WechatEnabled/);
 assert.match(source,/rsa2AlipayEnabled/);
 assert.match(source,/epayAlipayEnabled/);
 assert.match(source,/rsa2WechatReleased/);
 assert.match(source,/rsa2AlipayReleased/);
 assert.match(source,/epayAlipayReleased/);
 assert.match(source,/<details/);
 assert.match(source,/purchase_enabled|全站收款总开关|Global purchase switch/);
});

const merchant=readFileSync(new URL('../src/components/admin/MerchantPaymentSettings.tsx',import.meta.url),'utf8');

test('payment settings prioritize merchant, real methods and one-click readonly diagnostics',()=>{
 const status=source.indexOf('当前收款商家');
 const picker=source.indexOf('<MerchantPaymentSettings');
 const methods=source.indexOf('买家当前可选择');
 const diagnostic=source.indexOf('检查小豆 RSA2 连接');
 const advanced=source.indexOf('高级配置：小豆 RSA2 与历史易支付');
 assert.ok(status>=0&&status<picker&&picker<methods&&methods<diagnostic&&diagnostic<advanced);
 assert.match(source,/aria-busy=\{platformChecking\}/);
 assert.match(source,/platformCheckError&&<p role="alert"/);
 assert.match(source,/控制|control\.effectiveEnabled/);
 assert.match(source,/密码与登录会话管理（展开）/);
 assert.doesNotMatch(source,/<Label htmlFor="admin-security-reason">/);
});

test('merchant changes are previewed before save, with audit reason beside the action',()=>{
 assert.match(merchant,/changed&&<p role="status"/);
 assert.match(merchant,/reason=\{reason\}/);
 assert.match(merchant,/onReasonChange\(e\.target\.value\)/);
 assert.match(merchant,/disabled=\{busy\|\|!changed\|\|reason\.trim\(\)\.length<8\}/);
 assert.match(merchant,/额度包 \+ 四档订阅一起切换/);
 assert.match(merchant,/管理 MK99 渠道与许可（高级）/);
 assert.match(merchant,/微信支付尚未开通；易支付不再处理新订单/);
});
