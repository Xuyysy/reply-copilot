import test from 'node:test';
import assert from 'node:assert/strict';
import * as summaries from '../src/lib/order-price-summary.mjs';

test('MK99 order history shows exact paid CNY total, not the principal plus a zero fee',()=>{
 assert.equal(typeof summaries.orderPriceSummary,'function');
 assert.equal(summaries.orderPriceSummary({provider:'mk99',base_amount_fen:990,service_fee_fen:0,total_amount_fen:1043},'zh'),'人民币实付：¥10.43');
 assert.equal(summaries.orderPriceSummary({provider:'mk99',base_amount_fen:1990,service_fee_fen:0,total_amount_fen:2095},'en'),'Paid in CNY: ¥20.95');
});

test('legacy order history keeps its principal and service-fee meaning',()=>{
 assert.equal(summaries.orderPriceSummary({provider:'xiaodou',base_amount_fen:990,service_fee_fen:16,total_amount_fen:1006},'zh'),'套餐本金：¥9.90 · 服务费：¥0.16');
 assert.equal(summaries.orderPriceSummary({provider:'xiaodou',base_amount_fen:990,service_fee_fen:16,total_amount_fen:1006},'en'),'Principal: ¥9.90 · Fee: ¥0.16');
});
