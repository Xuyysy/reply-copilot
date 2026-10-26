import test from "node:test";
import assert from "node:assert/strict";
import { checkoutOrderMessage, checkoutOrderFromError, mergeCheckoutRead } from "../src/lib/checkout-status.mjs";

test("link generation failure is explicit in both languages without inviting blind retries", () => {
  const order = { status: "unknown", paymentLinkUnavailable: true };
  assert.match(checkoutOrderMessage(order, "zh"), /付款链接生成失败/);
  assert.doesNotMatch(checkoutOrderMessage(order, "zh"), /刷新|重新下单/);
  assert.match(checkoutOrderMessage(order, "en"), /Payment link could not be generated/);
  assert.doesNotMatch(checkoutOrderMessage(order, "en"), /refresh later/);
  assert.equal(order.status, "unknown");
});

test("existing successful checkout and ordinary unknown messages remain unchanged", () => {
  assert.match(checkoutOrderMessage({ status: "pending" }, "zh"), /订单待支付/);
  assert.match(checkoutOrderMessage({ status: "paid", paymentLinkUnavailable: true }, "en"), /Payment succeeded/);
  assert.match(checkoutOrderMessage({ status: "unknown" }, "en"), /refresh later/);
});

test('V2 checkout outcomes have distinct bilingual actions, with paid state taking precedence',()=>{
  const outcomes=['ready','rejected','unknown','unavailable','confirmation_required'];
  for(const lang of ['zh','en']){
    const messages=outcomes.map(outcome=>checkoutOrderMessage({status:'unknown',checkout:{outcome}},lang));
    assert.equal(new Set(messages).size,outcomes.length);
    assert.doesNotMatch(messages[1],/刷新|refresh later/);
  }
  assert.match(checkoutOrderMessage({status:'paid',checkout:{outcome:'rejected'}},'en'),/Payment succeeded/);
});

test('trusted closed and failed states override stale checkout preparation markers',()=>{
 assert.match(checkoutOrderMessage({status:'closed',checkout:{outcome:'ready'}},'en'),/closed/);
 assert.match(checkoutOrderMessage({status:'failed',checkout:{outcome:'unknown'}},'en'),/Payment failed/);
});


test('local reads preserve only a same-order, still-pending in-memory payment link',()=>{
 const current={id:'order-1',status:'pending',paymentUrl:'https://cashier.example.test/verified'};
 assert.equal(mergeCheckoutRead(current,{id:'order-1',status:'pending',paymentUrl:null}).paymentUrl,current.paymentUrl);
 for(const status of ['unknown','paid','closed','failed','refunded'])assert.equal(mergeCheckoutRead(current,{id:'order-1',status,paymentUrl:null}).paymentUrl,null);
 assert.equal(mergeCheckoutRead(current,{id:'order-2',status:'pending',paymentUrl:null}).paymentUrl,null);
});

test('non-success checkout retains validated local order context without enabling a second purchase',()=>{
 const order={id:'11111111-1111-4111-8111-111111111111',status:'unknown',amountFen:1006,baseAmountFen:990,serviceFeeFen:16,credits:400,currency:'CNY',paymentUrl:null,checkout:{outcome:'rejected'}};
 assert.equal(checkoutOrderFromError({order}),order);
 assert.equal(checkoutOrderFromError({order:{...order,amountFen:1}}),null);
 assert.equal(checkoutOrderFromError(new Error('no order')),null);
});

test('Epay pending text describes a prepared form, and a local read preserves only the same pending order form',()=>{
 const current={id:'epay-order',status:'pending',paymentProtocol:'epay',paymentForm:{action:'https://gateway.example.test/submit.php'}};
 assert.match(checkoutOrderMessage(current,'zh'),/付款表单/);
 assert.match(checkoutOrderMessage(current,'en'),/verified notification/);
 assert.deepEqual(mergeCheckoutRead(current,{id:'epay-order',status:'pending',paymentProtocol:'epay'}).paymentForm,current.paymentForm);
 assert.equal(mergeCheckoutRead(current,{id:'epay-order',status:'paid',paymentProtocol:'epay'}).paymentForm,undefined);
 assert.equal(mergeCheckoutRead(current,{id:'different-order',status:'pending',paymentProtocol:'epay'}).paymentForm,undefined);
});

test('MK99 hold revokes prior cashier and survives stale pending reads without affecting other orders',()=>{const prior={id:'mk',paymentProtocol:'mk99',status:'pending',riskState:'clear',paymentUrl:'https://cashier.example.test/pay'};const held=mergeCheckoutRead(prior,{...prior,riskState:'manual_review',paymentUrl:null});assert.equal(held.paymentUrl,null);assert.equal(mergeCheckoutRead(held,prior).paymentUrl,null);assert.match(checkoutOrderMessage(held,'zh'),/正在人工核对，请勿继续付款/);assert.match(checkoutOrderMessage(held,'en'),/manual review/);assert.equal(mergeCheckoutRead(prior,{...prior,paymentUrl:null}).paymentUrl,null);assert.equal(mergeCheckoutRead(prior,{...prior,id:'other'}).paymentUrl,prior.paymentUrl);});
test('MK99 error order accepts only a fully balanced merchant-cost snapshot',()=>{const order={id:'11111111-1111-4111-8111-111111111111',status:'unknown',paymentProtocol:'mk99',amountFen:1059,baseAmountFen:990,serviceFeeFen:16,credits:400,currency:'CNY',merchantPricing:{costCoverageFen:53}};assert.equal(checkoutOrderFromError({order}),order);assert.equal(checkoutOrderFromError({order:{...order,amountFen:1060}}),null);assert.equal(checkoutOrderFromError({order:{...order,merchantPricing:{costCoverageFen:-1}}}),null);});
