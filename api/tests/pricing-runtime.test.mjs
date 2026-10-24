import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,enableEpaySales } from './helpers/payment-v2.mjs';
function setup(){const f=enableEpaySales(fixture());Object.assign(f.env,{PAYMENT_PROVIDER:'xiaodou_epay',XIAODOU_EPAY_GATEWAY:'https://epay.example.test/submit.php',XIAODOU_EPAY_PID:'12345',XIAODOU_EPAY_KEY:'test-only'});return f;}
test('package USD promotion, FX and per-package fee produce integer settlement snapshots',async()=>{
 const f=setup(),original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Provider access forbidden');};
 try{
  f.sql.prepare("UPDATE recharge_packages SET settlement_mode='usd_exchange',exchange_rate_micros=7123456,promo_price_cents=129,fee_rate_bps=250,description_zh='测试套餐',description_en='Test package' WHERE id='starter'").run();
  const packages=await f.call('/v1/packages',{method:'GET'}),pkg=packages.body.packages.find(p=>p.id==='starter');
  assert.deepEqual([pkg.price_cny_fen,pkg.service_fee_fen,pkg.total_payment_fen,pkg.fee_rate_bps,pkg.description_en],[919,24,943,250,'Test package']);
  const created=await f.call('/v1/orders');assert.equal(created.status,201);
  assert.equal(created.body.order.paymentForm.fields.money,'9.43');
  const saved=f.sql.prepare('SELECT base_amount_fen,service_fee_fen,amount_fen,fee_rate_bps,settlement_mode,exchange_rate_micros FROM payment_transactions').get();
  assert.deepEqual({...saved},{base_amount_fen:919,service_fee_fen:24,amount_fen:943,fee_rate_bps:250,settlement_mode:'usd_exchange',exchange_rate_micros:7123456});
  f.sql.prepare("UPDATE recharge_packages SET exchange_rate_micros=8000000,fee_rate_bps=0 WHERE id='starter'").run();
  assert.deepEqual({...f.sql.prepare('SELECT base_amount_fen,service_fee_fen,amount_fen,fee_rate_bps,settlement_mode,exchange_rate_micros FROM payment_transactions').get()},{...saved});
 }finally{globalThis.fetch=original;f.sql.close();}
});
test('invalid exchange configuration blocks creation without financial writes',async()=>{
 const f=setup();try{f.sql.prepare("UPDATE recharge_packages SET settlement_mode='usd_exchange',exchange_rate_micros=NULL WHERE id='starter'").run();const result=await f.call('/v1/orders');assert.equal(result.status,503);assert.equal(f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n,0);}finally{f.sql.close();}
});
test('MK99 merchant-borne estimate covers net target using integer ceiling, never changes Xiaodou',async()=>{const {buildSync}=await import('esbuild');const {createRequire}=await import('node:module');const {mkdtempSync}=await import('node:fs');const dir=mkdtempSync('/private/tmp/mk99-price-');buildSync({entryPoints:['api/src/pricing.ts'],bundle:true,platform:'node',format:'cjs',outfile:dir+'/price.cjs'});const p=createRequire(import.meta.url)(dir+'/price.cjs');for(const base of [1,19,20,21,990,1990,3290,99999]){const pkg={price_cents:149,price_cny_fen:base,fee_rate_bps:150};const old=p.projectPackagePricing(pkg),m=p.projectMk99Pricing(pkg);assert.equal(m.totalPaymentFen,Math.ceil(old.totalPaymentFen*100/95));assert.equal(m.merchantPricing.netTargetFen,old.totalPaymentFen);assert.equal(m.merchantPricing.status,'estimate_unverified');assert.equal(m.baseAmountFen+m.serviceFeeFen+m.merchantPricing.costCoverageFen,m.totalPaymentFen);assert.ok(m.totalPaymentFen-Math.ceil(m.totalPaymentFen*5/100)>=old.totalPaymentFen);}assert.equal(p.projectMk99Pricing({price_cents:149,price_cny_fen:990}).totalPaymentFen,1059);});
