import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { fixture, withProvider, providerResponse, temp } from './helpers/payment-v2.mjs';
test.after(()=>rmSync(temp,{recursive:true,force:true}));
function noGrant(sql){assert.equal(sql.prepare('SELECT paid_balance n FROM credit_accounts').get().n,0);assert.equal(sql.prepare("SELECT count(*) n FROM credit_batches WHERE bucket='paid'").get().n,0);assert.equal(sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='purchase_grant'").get().n,0);}

test('V2 signed creation validates snapshot and releases only a verified cashier',async()=>{
 const f=fixture();try{await withProvider(req=>providerResponse(req),async calls=>{
  const r=await f.call('/v1/orders',{body:{packageId:'starter',amountFen:1}});
  assert.equal(r.status,201);assert.equal(r.body.order.checkout.outcome,'ready');assert.equal(r.body.order.amountFen,1006);assert.equal(r.body.order.credits,400);assert.ok(r.body.order.paymentUrl);assert.equal(calls.length,1);assert.equal(calls[0].redirect,'manual');
  const stored=await f.call(`/v1/orders/${r.body.order.id}`,{method:'GET'});assert.equal(stored.body.order.checkout.outcome,'ready');
  noGrant(f.sql);
 });}finally{f.sql.close();}
});

test('V2 explicit rejection and unknown create are linkless; local retry is permitted without granting credits',async()=>{
 for(const [status,code] of [[401,'OPEN_API_SIGNATURE_INVALID'],[403,'OPEN_API_SOURCE_IP_REJECTED'],[404,'OPEN_API_RESOURCE_NOT_FOUND'],[422,'OPEN_API_CHANNEL_UNAVAILABLE'],[503,'OPEN_API_GUARD_UNAVAILABLE']]){
  const f=fixture();try{await withProvider(req=>providerResponse(req,{code,message:'private upstream text',details:{reason:'HEADER_CONFLICT'}},{status,signed:false}),async calls=>{
   const r=await f.call('/v1/orders');
   assert.ok(r.status>=400);
   assert.equal(r.body.order.checkout.outcome,status<500?'rejected':'unknown');
   assert.equal(r.body.order.status,'unknown');
   assert.equal(r.body.order.retryAvailable,true);
   assert.equal(r.body.order.paymentUrl,null);
   assert.equal(r.body.diagnostic.upstreamHttpStatus,status);
   assert.doesNotMatch(JSON.stringify(r.body),/private upstream text|BEGIN.*KEY/);
   const next=await f.call('/v1/orders');
   assert.ok(next.status>=400);
   assert.equal(next.body.order.retryAvailable,true);
   assert.notEqual(next.body.order.id,r.body.order.id);
   assert.equal(calls.length,2,'no hidden provider call beyond the two buyer-requested attempts');
   assert.equal(f.sql.prepare("SELECT count(*) n FROM recharge_orders WHERE status='expired'").get().n,2);
   const stored=await f.call(`/v1/orders/${r.body.order.id}`,{method:'GET'});
   assert.equal(stored.body.order.checkout.outcome,r.body.order.checkout.outcome);
   assert.equal(stored.body.order.retryAvailable,true);
   noGrant(f.sql);
  });}finally{f.sql.close();}
 }
});

test('V2 invalid signed snapshots and absent materials never expose a payment link',async()=>{
 for(const [fields,options] of [[{amountFen:990},{}],[{outTradeNo:'different-order'},{}],[{currency:'USD'},{}],[{status:'INVALID'},{}],[{unknown:true},{}],[{payUrl:null},{}],[{payUrl:'http://cashier.example.test/'},{}],[{payUrl:'https://user:pass@cashier.example.test/'},{}],[{feeProjection:null},{}],[{}, {badSignature:true}]]){
  const f=fixture();try{await withProvider(req=>providerResponse(req,fields,options),async()=>{
   const r=await f.call('/v1/orders');assert.ok(r.status!==201);assert.equal(r.body.order.paymentUrl,null);noGrant(f.sql);
  });}finally{f.sql.close();}
 }
});

test('V2 network failure retains one unconfirmed order without retries',async()=>{
 const f=fixture();try{await withProvider(()=>{throw new TypeError('private-network-error');},async calls=>{
  const r=await f.call('/v1/orders');assert.equal(r.status,503);assert.equal(r.body.order.checkout.outcome,'unknown');assert.equal(calls.length,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n,1);noGrant(f.sql);
 });}finally{f.sql.close();}
});

test('V2 concurrent double submit creates one order and calls the provider once',async()=>{
 const f=fixture();try{await withProvider(req=>providerResponse(req),async calls=>{
  const r=await Promise.all([f.call('/v1/orders'),f.call('/v1/orders')]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal(calls.length,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM payment_attempts').get().n,1);noGrant(f.sql);
 });}finally{f.sql.close();}
});

test('V2 signed SUCCEEDED creation does not itself grant credits',async()=>{
 const f=fixture();try{await withProvider(req=>providerResponse(req,{status:'SUCCEEDED',payUrl:null}),async()=>{
  const r=await f.call('/v1/orders');assert.equal(r.status,202);assert.equal(r.body.order.checkout.outcome,'confirmation_required');assert.equal(r.body.order.paymentUrl,null);noGrant(f.sql);
 });}finally{f.sql.close();}
});

test('V2 create response cannot overwrite a concurrent trusted payment settlement',async()=>{
 const f=fixture();try{await withProvider(req=>{
  const outTradeNo=JSON.parse(req.body).outTradeNo;
  f.sql.prepare("UPDATE payment_transactions SET status='paid',paid_at=1 WHERE provider_trade_id=?").run(outTradeNo);
  f.sql.prepare("UPDATE recharge_orders SET status='paid',paid_at=1,credited_at=1 WHERE provider_reference=?").run(outTradeNo);
  return providerResponse(req);
 },async()=>{
  const r=await f.call('/v1/orders');assert.equal(r.body.order.status,'paid');assert.equal(r.body.order.paymentUrl,null);assert.equal(f.sql.prepare('SELECT status FROM payment_transactions').get().status,'paid');
 });}finally{f.sql.close();}
});

test('V2 local reads preserve historical UNKNOWN rows without attempting any provider call',async()=>{
 const f=fixture();try{
  const ids=['7fdc3d09-a7b1-47c5-97dd-827d5ad0b178','7452c937-69d4-4819-9d1a-bbbdb79c5a30'];
  for(const [i,id] of ids.entries()){
   f.sql.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) VALUES(?,'test-user','starter','Legacy',400,149,'USD','awaiting_payment',1)").run(id);
   f.sql.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,status,provider_trade_id,created_at,updated_at) VALUES(?,?,'xiaodou','CNY',1006,'unknown',?,1,1)").run('legacy-tx-'+i,id,'XRH_'+id.replaceAll('-',''));
   f.sql.prepare("INSERT INTO payment_attempts(id,transaction_id,attempt_number,provider_request_id,state,provider_code,created_at,updated_at) VALUES(?,?,1,?,'unknown',?,1,1)").run('legacy-attempt-'+i,'legacy-tx-'+i,'legacy-request-'+i,i?'OPEN_API_SOURCE_IP_REJECTED':'NETWORK_UNCERTAIN');
  }
  const before=JSON.stringify(f.sql.prepare('SELECT * FROM payment_transactions').all());
  await withProvider(()=>{throw new Error('must not query');},async calls=>{
    for(const id of ids){const r=await f.call(`/v1/orders/${id}`,{method:'GET'});assert.equal(r.body.order.checkout,null);assert.equal(r.body.order.status,'unknown');}
    const a=await f.call('/v1/activity',{method:'GET'});assert.equal(a.body.orders.length,2);assert.ok(a.body.orders.every(x=>x.checkout===null));
    assert.equal((await f.call('/v1/orders')).status,409);assert.equal(calls.length,0);
  });
  assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM payment_transactions').all()),before);noGrant(f.sql);
 }finally{f.sql.close();}
});

test('V2 verified query and webhook races grant one batch and ledger, even after checkout is disabled',async()=>{
 const f=fixture();try{
  let orderId,outTradeNo;
  await withProvider(req=>providerResponse(req),async()=>{const r=await f.call('/v1/orders');orderId=r.body.order.id;outTradeNo='XRH_'+orderId.replaceAll('-','');});
  f.env.PAYMENTS_ENABLED='0';
  const event={eventId:'v2-success-event-123',eventType:'PAYMENT_SUCCEEDED',appId:f.env.XIAODOU_APP_ID,outTradeNo,outRefundNo:null,eventAmountFen:1006,grossAmountFen:1006,status:'SUCCEEDED',occurredAt:Math.floor(Date.now()/1000),stateVersion:0};
  const { platform,worker }=await import('./helpers/payment-v2.mjs');
  const {sign,createHash}=await import('node:crypto');
  async function webhook(payload=event,{invalid=false}={}){
    const raw=JSON.stringify(payload),timestamp=String(Math.floor(Date.now()/1000)),nonce='test-webhook-nonce-123',keyId='test-platform';
    const canonical=['XD-Webhook-v1',payload.eventId,payload.eventType,timestamp,nonce,keyId,createHash('sha256').update(raw).digest('hex')].join('\n');
    const response=await worker.fetch(new Request(f.env.API_ORIGIN+'/v1/payments/xiaodou/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-XD-Webhook-Event-Id':payload.eventId,'X-XD-Webhook-Event-Type':payload.eventType,'X-XD-Webhook-Timestamp':timestamp,'X-XD-Webhook-Nonce':nonce,'X-XD-Webhook-Key-Id':keyId,'X-XD-Webhook-Signature':invalid?'AAAA':sign('RSA-SHA256',Buffer.from(canonical),platform.privateKey).toString('base64')},body:raw}),f.env);
    return {status:response.status,text:await response.text()};
  }
  assert.equal((await webhook(event,{invalid:true})).status,401);noGrant(f.sql);
  assert.equal((await webhook({...event,outTradeNo:'XRH_wrong_order'})).status,404);noGrant(f.sql);
  assert.equal((await webhook({...event,grossAmountFen:990})).status,409);noGrant(f.sql);
  // Closed/failed notifications are not absorbing: a late verified success wins.
  assert.equal((await webhook({...event,eventId:'v2-closed-event-123',eventType:'PAYMENT_CLOSED',status:'CLOSED',eventAmountFen:0})).status,200);
  await withProvider(req=>providerResponse(req,{outTradeNo,status:'SUCCEEDED',payUrl:null},{status:200}),async calls=>{
    const results=await Promise.all([webhook(),f.call(`/v1/orders/${orderId}/refresh`),webhook()]);
    assert.deepEqual(results.map(x=>x.status),[200,200,200]);
    assert.equal(calls.length,1);
    assert.equal((await f.call(`/v1/orders/${orderId}/refresh`)).status,200);
  });
  assert.equal(f.sql.prepare('SELECT free_balance n FROM credit_accounts').get().n,200);
  assert.equal(f.sql.prepare('SELECT paid_balance n FROM credit_accounts').get().n,400);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='purchase_grant'").get().n,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_batches WHERE source_order_id=?").get(orderId).n,1);
  assert.equal((await webhook({...event,eventId:'v2-late-failed-event',eventType:'PAYMENT_FAILED',status:'FAILED',eventAmountFen:0})).status,200);
  assert.equal(f.sql.prepare('SELECT status FROM payment_transactions').get().status,'paid');
 }finally{f.sql.close();}
});

test('V2 material relaunch is validated and cannot run concurrently',async()=>{
 const f=fixture();try{
  let id,outTradeNo;
  await withProvider(req=>providerResponse(req),async()=>{const r=await f.call('/v1/orders');id=r.body.order.id;outTradeNo='XRH_'+id.replaceAll('-','');});
  await withProvider(req=>providerResponse(req,{outTradeNo,amountFen:990}),async calls=>{
    const result=await Promise.all([f.call(`/v1/orders/${id}/attempts`,{body:{}}),f.call(`/v1/orders/${id}/attempts`,{body:{}})]);
    assert.equal(calls.length,1);assert.ok(result.every(x=>x.status>=400));
    assert.ok(result.every(x=>!x.body.paymentUrl));noGrant(f.sql);
  });
 }finally{f.sql.close();}
});

test('V2 failed trusted query does not modify any financial or order rows',async()=>{
 const f=fixture();try{
  let id;
  await withProvider(req=>providerResponse(req),async()=>{id=(await f.call('/v1/orders')).body.order.id;});
  const tables=['recharge_orders','payment_transactions','payment_attempts','credit_accounts','credit_batches','credit_ledger','provider_payment_events'];
  const snapshot=()=>JSON.stringify(tables.map(t=>f.sql.prepare(`SELECT * FROM ${t}`).all()));
  const before=snapshot();
  for(const status of [401,403,404,503])await withProvider(req=>providerResponse(req,{code:status===403?'OPEN_API_SOURCE_IP_REJECTED':'OPEN_API_RESOURCE_NOT_FOUND',message:'private'},{status}),async()=>{
    assert.ok((await f.call(`/v1/orders/${id}/refresh`)).status>=400);assert.equal(snapshot(),before);
  });
 }finally{f.sql.close();}
});
