import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const customerSources=[
 '../src/pages/checkout.astro',
 '../src/components/account/SubscriptionCheckout.tsx',
 '../src/components/account/AccountDashboard.tsx',
 '../src/lib/api.ts'
];
// Merchant keys remain valid for routing, but customer-facing string values must not display them.
const literalValues=source=>[...source.matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g)]
 .map(match=>match[1]??match[2]);
const internalKey=value=>/^(?:xiaodou|xiaodou_epay|mk99|[A-Z][A-Z0-9_]+)$/.test(value);

test('customer pages and confirmation copy never show internal merchant names',()=>{
 for(const path of customerSources){
  const source=read(path);
  const exposed=literalValues(source).filter(value=>/小豆|Xiaodou|MK99/i.test(value)&&!internalKey(value));
  assert.deepEqual(exposed,[],path+' must not display internal merchant names');
 }
 const credits=read('../src/pages/checkout.astro');
 assert.doesNotMatch(credits,/<p[^>]*>[^<]*(?:Xiaodou|MK99)[^<]*<\/p>/i);
 assert.match(credits,/想更换额度包或支付方式？/);
});

test('cancel buttons guide a repurchase while preserving late payment warning and confirmation',()=>{
 const subscription=read('../src/components/account/SubscriptionCheckout.tsx');
 const account=read('../src/components/account/AccountDashboard.tsx');
 const credits=read('../src/pages/checkout.astro');
 assert.match(subscription,/想重新购买其他套餐？/);
 assert.match(subscription,/之前打开的支付页面仍可能收款/);
 assert.match(subscription,/查验付款状态/);
 assert.match(subscription,/href="\/pricing\/"/);
 assert.match(account,/想重新购买其他套餐？/);
 assert.match(account,/想更换额度包或支付方式？/);
 assert.match(credits,/之前打开的收银台仍可能收款/);
 assert.match(credits,/\/local-cancel/);
 assert.match(subscription,/confirm:true/);
});

test('API user-facing failure messages are neutral but verified provider routing remains',()=>{
 for(const path of [
  '../../api/src/subscription-checkout.ts',
  '../../api/src/subscription-settlement.ts',
  '../../api/src/payments.ts'
 ]){
  const source=read(path);
  const failures=source.match(/new ApiFailure\([^\n]*\)/g)||[];
  for(const expression of failures){
   const message=/(?:'([^']*)'|"([^"]*)")\s*\)$/.exec(expression);
   if(message)assert.doesNotMatch(message[1]??message[2],/小豆|Xiaodou|MK99/i,path);
  }
 }
 const settlement=read('../../api/src/subscription-settlement.ts');
 assert.match(settlement,/verificationSource:'xiaodou_signed_query'/);
 assert.match(read('../src/components/account/SubscriptionCheckout.tsx'),/\/local-cancel/);
});
