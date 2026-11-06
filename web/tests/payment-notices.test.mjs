import test from 'node:test';import assert from 'node:assert/strict';
import {createPaymentNotices}from '../src/lib/payment-sync.mjs';
test('dismissal is event based, survives effect replay/language change, and isolates accounts',()=>{
 const notices=createPaymentNotices();notices.setOwner('account-a');const e={orderId:'order-a',kind:'closed'};assert.deepEqual(notices.publish(e),e);notices.dismiss(e);assert.equal(notices.publish({...e}),null);assert.equal(notices.publish({orderId:'order-a',kind:'paid'})?.kind,'paid');notices.setOwner('account-b');assert.equal(notices.current(),null);assert.equal(notices.publish(e,'account-a'),null);assert.deepEqual(notices.publish(e,'account-b'),e);notices.setOwner('account-a');assert.equal(notices.current(),null);assert.equal(notices.publish(e),null);
});
