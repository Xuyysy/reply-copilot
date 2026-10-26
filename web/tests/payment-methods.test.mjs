import test from 'node:test';
import assert from 'node:assert/strict';
import {uniquePaymentMethods,paymentMethodKey} from '../src/lib/payment-methods.mjs';
test('same channel on two providers remains two independent selectable methods',()=>{
 const methods=[{provider:'mk99',channel:'ALIPAY_H5'},{provider:'xiaodou',channel:'ALIPAY_H5'},{provider:'mk99',channel:'ALIPAY_H5'}];
 const choices=uniquePaymentMethods(methods);assert.deepEqual(choices,methods.slice(0,2));assert.deepEqual(choices.map(paymentMethodKey),['mk99:ALIPAY_H5','xiaodou:ALIPAY_H5']);
});
