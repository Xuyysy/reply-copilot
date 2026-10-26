import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentActionLabel} from '../src/lib/payment-presentation.mjs';

test('checkout button text follows Alipay and WeChat selection in Chinese and English',()=>{
 assert.equal(paymentActionLabel('WECHAT_H5','pay','zh'),'使用微信支付');
 assert.equal(paymentActionLabel('ALIPAY_H5','pay','zh'),'使用支付宝付款');
 assert.equal(paymentActionLabel('WECHAT_H5','pay','en'),'Pay with WeChat Pay');
 assert.equal(paymentActionLabel('ALIPAY_H5','pay','en'),'Pay with Alipay');
});

test('cashier-link text follows selected payment channel in both locales',()=>{
 assert.equal(paymentActionLabel('WECHAT_H5','cashier','zh'),'打开微信支付收银台');
 assert.equal(paymentActionLabel('ALIPAY_H5','cashier','zh'),'打开支付宝收银台');
 assert.equal(paymentActionLabel('WECHAT_H5','cashier','en'),'Open WeChat Pay cashier');
 assert.equal(paymentActionLabel('ALIPAY_H5','cashier','en'),'Open Alipay cashier');
});
