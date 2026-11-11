import test from 'node:test';
import assert from 'node:assert/strict';
import {findUnresolvedCreditOrder,lookupUnresolvedCreditOrder} from '../src/lib/credit-order-discovery.mjs';
const order={id:'31675569-ee63-4f32-bff8-ec0c0c64f919',package_id:'large',provider:'xiaodou',payment_protocol:'rsa2',payment_channel:'ALIPAY_H5',status:'awaiting_payment',payment_status:'pending',created_at:2026};
const props={packageId:'large',provider:'xiaodou',channel:'ALIPAY_H5'};
test('finds existing payable credit order after browser exit and no new POST',async()=>{
 const found=await lookupUnresolvedCreditOrder({...props,request:async(path,opts)=>{
  assert.equal(path,'/v1/activity');assert.equal(opts.method,'GET');return {orders:[order]};
 }});
 assert.equal(found.id,order.id);
});
test('uses the newest matching pending/unknown order, only same package/channel/provider',()=>{
 const newer={...order,id:'dc736b28-2c27-4ea9-a8fa-1b986e940188',created_at:2030,payment_status:'unknown'};
 assert.equal(findUnresolvedCreditOrder({orders:[order,newer]},props).id,newer.id);
 for(const changed of [{package_id:'starter'},{provider:'mk99'},{payment_protocol:'epay'},{payment_channel:'WECHAT_H5'},{status:'paid'},{payment_status:'paid'},{id:'invalid'}]){
  assert.equal(findUnresolvedCreditOrder({orders:[{...order,...changed}]},props),null,JSON.stringify(changed));
 }
});
test('does not misclassify legacy epay or mk99 as modern RSA2',()=>{
 assert.equal(findUnresolvedCreditOrder({orders:[order]}, {...props,provider:'xiaodou_epay'}),null);
 assert.equal(findUnresolvedCreditOrder({orders:[order]}, {...props,provider:'mk99'}),null);
 assert.equal(findUnresolvedCreditOrder({orders:[]},props),null);
});
