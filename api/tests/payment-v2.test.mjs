import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { fixture, withProvider, providerResponse, temp } from './helpers/payment-v2.mjs';
test.after(()=>rmSync(temp,{recursive:true,force:true}));
function noGrant(sql){assert.equal(sql.prepare('SELECT paid_balance n FROM credit_accounts').get().n,0);assert.equal(sql.prepare("SELECT count(*) n FROM credit_batches WHERE bucket='paid'").get().n,0);assert.equal(sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='purchase_grant'").get().n,0);}

test('V2 signed creation validates snapshot and releases only a verified cashier',async()=>{
 const f=fixture();try{await withProvider(req=>providerResponse(req),async calls=>{
  const r=await f.call('/v1/orders',{body:{packageId:'starter',amountFen:1}});
  assert.equal(r.status,201);assert.equal(r.body.order.checkout.outcome,'ready');assert.equal(r.body.order.amountFen,990);assert.equal(r.body.order.credits,400);assert.ok(r.body.order.paymentUrl);assert.equal(calls.length,1);assert.equal(calls[0].redirect,'manual');
  const stored=await f.call(`/v1/orders/${r.body.order.id}`,{method:'GET'});assert.equal(stored.body.order.checkout.outcome,'ready');
  noGrant(f.sql);
 });}finally{f.sql.close();}
});

test('V2 explicit HTTP rejection differs from uncertain creation and remains duplicate-protected',async()=>{
 for(const [status,code] of [[401,'OPEN_API_SIGNATURE_INVALID'],[403,'OPEN_API_SOURCE_IP_REJECTED'],[404,'OPEN_API_RESOURCE_NOT_FOUND'],[422,'OPEN_API_CHANNEL_UNAVAILABLE'],[503,'OPEN_API_GUARD_UNAVAILABLE']]){
  const f=fixture();try{await withProvider(req=>providerResponse(req,{code,message:'private upstream text',details:{reason:'HEADER_CONFLICT'}},{status,signed:false}),async calls=>{
    const r=await f.call('/v1/orders');assert.ok(r.status>=400);assert.equal(r.body.order.checkout.outcome,status<500?'rejected':'unknown');assert.equal(r.body.order.status,'unknown');assert.equal(r.body.order.paymentUrl,null);
    assert.equal(r.body.diagnostic.upstreamHttpStatus,status);assert.doesNotMatch(JSON.stringify(r.body),/private upstream text|BEGIN.*KEY/);
    assert.equal((await f.call('/v1/orders')).body.code,'UNRESOLVED_ORDER_EXISTS');assert.equal(calls.length,1);
    const stored=await f.call(`/v1/orders/${r.body.order.id}`,{method:'GET'});assert.equal(stored.body.order.checkout.outcome,r.body.order.checkout.outcome);
    noGrant(f.sql);
  });}finally{f.sql.close();}
 }
});

test('V2 invalid signed snapshots and absent materials never expose a payment link',async()=>{
 for(const [fields,options] of [[{amountFen:1006},{}],[{outTradeNo:'different-order'},{}],[{currency:'USD'},{}],[{status:'INVALID'},{}],[{unknown:true},{}],[{payUrl:null},{}],[{payUrl:'http://cashier.example.test/'},{}],[{payUrl:'https://user:pass@cashier.example.test/'},{}],[{}, {badSignature:true}]]){
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
  const event={eventId:'v2-success-event-123',eventType:'PAYMENT_SUCCEEDED',appId:f.env.XIAODOU_APP_ID,outTradeNo,outRefundNo:null,eventAmountFen:990,grossAmountFen:990,status:'SUCCEEDED',occurredAt:Math.floor(Date.now()/1000),stateVersion:0};
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
  assert.equal((await webhook({...event,grossAmountFen:1006})).status,409);noGrant(f.sql);
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
  await withProvider(req=>providerResponse(req,{outTradeNo,amountFen:1006}),async calls=>{
    const result=await Promise.all([f.call(`/v1/orders/${id}/attempts`,{body:{}}),f.call(`/v1/orders/${id}/attempts`,{body:{}})]);
    assert.equal(calls.filter(x=>x.method==='POST').length,0,'mismatched signed queries must block relaunch before provider POST');
    assert.equal(calls.filter(x=>x.method==='GET').length,2);
    assert.ok(result.every(x=>x.status===409&&x.body.code==='PAYMENT_MISMATCH'));
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


test('RSA2 credit order read restores only the original verified cashier, like subscription recovery',async()=>{
 const f=fixture();try{
  let id;
  await withProvider(req=>providerResponse(req),async calls=>{
   const created=await f.call('/v1/orders');
   assert.equal(created.status,201);
   id=created.body.order.id;
   assert.equal(calls.length,1);
   const recovered=await f.call('/v1/orders/'+id,{method:'GET'});
   assert.equal(recovered.status,200);
   assert.equal(recovered.body.order.paymentUrl,'https://cashier.example.test/pay/test');
   assert.equal(recovered.body.order.paymentCashierOrigin,'https://cashier.example.test');
   assert.equal(calls.length,1,'read must never ask the provider or mint another order');
  });
  const tx=f.sql.prepare('SELECT id FROM payment_transactions WHERE order_id=?').get(id).id;
  // A risk hold, an ambiguous attempt, a merchant mismatch, and paid evidence
  // must each independently suppress a stale link.
  f.sql.prepare("UPDATE payment_transactions SET risk_state='manual_review' WHERE id=?").run(tx);
  assert.equal((await f.call('/v1/orders/'+id,{method:'GET'})).body.order.paymentUrl,null);
  f.sql.prepare("UPDATE payment_transactions SET risk_state='clear', merchant_account='xdop_othermerchant00' WHERE id=?").run(tx);
  assert.equal((await f.call('/v1/orders/'+id,{method:'GET'})).body.order.paymentUrl,null);
  f.sql.prepare("UPDATE payment_transactions SET merchant_account=?, status='unknown' WHERE id=?").run(f.env.XIAODOU_APP_ID,tx);
  assert.equal((await f.call('/v1/orders/'+id,{method:'GET'})).body.order.paymentUrl,null);
  f.sql.prepare("UPDATE payment_transactions SET status='pending', cashier_url='https://cashier.example.test/pay/test' WHERE id=?").run(tx);
  f.sql.prepare("UPDATE recharge_orders SET paid_at=1 WHERE id=?").run(id);
  assert.equal((await f.call('/v1/orders/'+id,{method:'GET'})).body.order.paymentUrl,null);
  noGrant(f.sql);
 }finally{f.sql.close();}
});

test('RSA2 credit relaunch requires a signed unpaid lookup before creating a new attempt',async()=>{
 const f=fixture();try{
  let id,outTradeNo;
  await withProvider(req=>providerResponse(req),async()=>{
   const created=await f.call('/v1/orders');assert.equal(created.status,201);
   id=created.body.order.id;outTradeNo='XRH_'+id.replaceAll('-','');
  });
  const calls=[];
  const result=await withProvider(req=>{
   const path=new URL(req.url).pathname;calls.push(req.method+' '+path);
   if(req.method==='GET')return providerResponse(req,{outTradeNo,amountFen:990,currency:'CNY',channel:'ALIPAY_H5',status:'CREATED',payUrl:null},{status:200});
   assert.equal(req.method,'POST');assert.match(path,/\/attempts$/);
   return providerResponse(req,{outTradeNo,amountFen:990,currency:'CNY',channel:'ALIPAY_H5',status:'CREATED'});
  },()=>f.call('/v1/orders/'+id+'/attempts',{body:{}}));
  assert.equal(result.status,201,JSON.stringify(result.body));
  assert.equal(result.body.paymentUrl,'https://cashier.example.test/pay/test');
  assert.deepEqual(calls,['GET /api/open/v1/payments/'+outTradeNo,'POST /api/open/v1/payments/'+outTradeNo+'/attempts']);
  assert.equal((await f.call('/v1/orders/'+id,{method:'GET'})).body.order.paymentUrl,'https://cashier.example.test/pay/test');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n,1);
  noGrant(f.sql);
 }finally{f.sql.close();}
});

test('RSA2 credit recovery from an unconfirmed original requires provider nextAction',async()=>{
 const f=fixture();try{
  let id,outTradeNo;
  await withProvider(req=>providerResponse(req),async()=>{id=(await f.call('/v1/orders')).body.order.id;outTradeNo='XRH_'+id.replaceAll('-','');});
  const txn=f.sql.prepare('SELECT id FROM payment_transactions WHERE order_id=?').get(id).id;
  f.sql.prepare("UPDATE payment_transactions SET status='unknown',cashier_url=NULL WHERE id=?").run(txn);
  f.sql.prepare("UPDATE payment_attempts SET state='unknown',cashier_url=NULL WHERE transaction_id=?").run(txn);
  let attempts=0;
  const unsafe=await withProvider(req=>{
   if(req.method!=='GET')attempts++;
   return providerResponse(req,{outTradeNo,amountFen:990,channel:'ALIPAY_H5',status:'PAYING',payUrl:null},{status:200});
  },()=>f.call('/v1/orders/'+id+'/attempts',{body:{}}));
  assert.equal(unsafe.status,409,JSON.stringify(unsafe.body));
  assert.equal(attempts,0);
  const recovered=await withProvider(req=>{
   if(req.method==='GET')return providerResponse(req,{outTradeNo,amountFen:990,channel:'ALIPAY_H5',status:'CREATED',payUrl:null,nextAction:'CREATE_ATTEMPT'},{status:200});
   attempts++;
   return providerResponse(req,{outTradeNo,amountFen:990,channel:'ALIPAY_H5',status:'PAYING'});
  },()=>f.call('/v1/orders/'+id+'/attempts',{body:{}}));
  assert.equal(recovered.status,201,JSON.stringify(recovered.body));
  assert.equal(attempts,1);
  assert.equal(f.sql.prepare('SELECT status FROM payment_transactions WHERE id=?').get(txn).status,'pending');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n,1);
  noGrant(f.sql);
 }finally{f.sql.close();}
});

test('Xiaodou GET 502 leaves the original credit order and attempts unchanged',async()=>{
 const f=fixture();try{
  let id;
  await withProvider(req=>providerResponse(req),async()=>{id=(await f.call('/v1/orders')).body.order.id;});
  const counts=()=>JSON.stringify(['payment_transactions','payment_attempts','credit_accounts','credit_ledger'].map(t=>f.sql.prepare('SELECT * FROM '+t).all()));
  const before=counts();
  const failed=await withProvider(req=>providerResponse(req,{code:'OPEN_API_GUARD_UNAVAILABLE',message:'do not expose provider message'},{status:502}),async calls=>{
   const result=await f.call('/v1/orders/'+id+'/attempts',{body:{}});
   assert.equal(calls.length,1);
   assert.equal(calls[0].method,'GET','never request /attempts after failed GET');
   return result;
  });
  assert.equal(failed.status,502);
  assert.equal(failed.body.code,'PROVIDER_HTTP_ERROR');
  assert.equal(counts(),before);
  noGrant(f.sql);
 }finally{f.sql.close();}
});


test('website price is the exact signed Xiaodou SELLER amount with merchant fees deducted from settlement',async()=>{
 const f=fixture();
 try{
  const list=await f.call('/v1/packages',{method:'GET'});
  const starter=list.body.packages.find(x=>x.id==='starter');
  assert.equal(starter.price_cny_fen,990);
  assert.equal(starter.total_payment_fen,990);
  assert.equal(starter.service_fee_fen,0);
  assert.equal(starter.fee_rate_bps,0);
  const created=await withProvider(req=>{
   const sent=JSON.parse(req.body);
   assert.equal(sent.amountFen,990);
   assert.equal(sent.currency,'CNY');
   assert.equal(sent.channel,'ALIPAY_H5');
   assert.equal(sent.feeBearer,undefined,'Xiaodou defaults to SELLER');
   assert.equal(sent.merchantAmountFen,undefined,'BUYER mode must not be used');
   return providerResponse(req);
  },()=>f.call('/v1/orders',{body:{packageId:'starter'}}));
  assert.equal(created.status,201,JSON.stringify(created.body));
  assert.equal(created.body.order.amountFen,990);
  assert.equal(created.body.order.baseAmountFen,990);
  assert.equal(created.body.order.serviceFeeFen,0);
  assert.equal(created.body.order.checkout.outcome,'ready');
  const row=f.sql.prepare("SELECT amount_fen,base_amount_fen,service_fee_fen,provider_fee_projection_status,provider_fee_projection_json FROM payment_transactions").get();
  assert.deepEqual([row.amount_fen,row.base_amount_fen,row.service_fee_fen,row.provider_fee_projection_status],[990,990,0,'verified']);
  const ledger=JSON.parse(row.provider_fee_projection_json);
  assert.equal(ledger.merchantSettlementFen+ledger.companyServiceFeeFen,990);
  noGrant(f.sql);
 }finally{f.sql.close();}
});

test('seller fee projection needing finance review does not hide a signed, amount-matched cashier',async()=>{
 const f=fixture();try{
  const created=await withProvider(req=>providerResponse(req,{feeProjection:null}),()=>f.call('/v1/orders',{body:{packageId:'starter'}}));
  assert.equal(created.status,201,JSON.stringify(created.body));
  assert.equal(created.body.order.checkout.outcome,'ready');
  assert.equal(created.body.order.paymentUrl,'https://cashier.example.test/pay/test');
  const row=f.sql.prepare("SELECT amount_fen,provider_fee_projection_status,provider_fee_projection_issue FROM payment_transactions").get();
  assert.equal(row.amount_fen,990);assert.equal(row.provider_fee_projection_status,'review');assert.equal(row.provider_fee_projection_issue,'missing');
  noGrant(f.sql);
 }finally{f.sql.close();}
});


test('user-confirmed Xiaodou close safely releases a blocked package only after signed CLOSED proof',async()=>{
 const f=fixture();try{
  const created=await withProvider(req=>providerResponse(req),()=>f.call('/v1/orders'));
  assert.equal(created.status,201);
  const id=created.body.order.id,trade=f.sql.prepare('SELECT provider_trade_id FROM payment_transactions WHERE order_id=?').get(id).provider_trade_id;
  const blocked=await f.call('/v1/orders');assert.equal(blocked.status,409);
  const closed=await withProvider(req=>{
   assert.equal(req.method,'POST');assert.equal(new URL(req.url).pathname,'/api/open/v1/payments/'+trade+'/close');
   return providerResponse(req,{outTradeNo:trade,amountFen:990,currency:'CNY',channel:'ALIPAY_H5',status:'CLOSED',closeState:'CLOSE_REQUESTED'},{status:200});
  },()=>f.call('/v1/orders/'+id+'/close',{body:{}}));
  assert.equal(closed.status,200,JSON.stringify(closed.body));assert.equal(closed.body.orderStatus,'closed');
  assert.equal(f.sql.prepare('SELECT status FROM payment_transactions WHERE order_id=?').get(id).status,'closed');
  assert.equal(f.sql.prepare('SELECT status FROM recharge_orders WHERE id=?').get(id).status,'expired');
  const replacement=await withProvider(req=>providerResponse(req),()=>f.call('/v1/orders'));
  assert.equal(replacement.status,201,JSON.stringify(replacement.body));
  assert.notEqual(replacement.body.order.id,id);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n,2);
  noGrant(f.sql);
 }finally{f.sql.close();}
});

test('Xiaodou UNKNOWN_KEPT/paid-conflict/bad amount never close a live or uncertain credit order',async()=>{
 for(const fields of [
  {status:'UNKNOWN',closeState:'UNKNOWN_KEPT'},
  {status:'SUCCEEDED',closeState:'PROVIDER_PAID_CONFLICT'},
  {status:'CLOSED',closeState:'CLOSE_REQUESTED',amountFen:1006}
 ]){
  const f=fixture();try{
   const created=await withProvider(req=>providerResponse(req),()=>f.call('/v1/orders'));
   const id=created.body.order.id,trade=f.sql.prepare('SELECT provider_trade_id FROM payment_transactions WHERE order_id=?').get(id).provider_trade_id;
   const before=JSON.stringify(['recharge_orders','payment_transactions','provider_payment_events','credit_ledger'].map(t=>f.sql.prepare('SELECT * FROM '+t).all()));
   const attempt=await withProvider(req=>providerResponse(req,{outTradeNo:trade,amountFen:990,currency:'CNY',channel:'ALIPAY_H5',...fields},{status:200}),()=>f.call('/v1/orders/'+id+'/close',{body:{}}));
   assert.equal(attempt.status,409,JSON.stringify(attempt.body));
   assert.equal(JSON.stringify(['recharge_orders','payment_transactions','provider_payment_events','credit_ledger'].map(t=>f.sql.prepare('SELECT * FROM '+t).all())),before);
   noGrant(f.sql);
  }finally{f.sql.close();}
 }
});

test('Xiaodou close upstream HTTP 502 leaves the blocked order and ledger untouched',async()=>{
 const f=fixture();try{
  const created=await withProvider(req=>providerResponse(req),()=>f.call('/v1/orders'));
  const id=created.body.order.id;
  const before=JSON.stringify(['recharge_orders','payment_transactions','credit_accounts'].map(t=>f.sql.prepare('SELECT * FROM '+t).all()));
  const failed=await withProvider(req=>providerResponse(req,{code:'OPEN_API_GUARD_UNAVAILABLE',message:'private upstream detail'},{status:502}),()=>f.call('/v1/orders/'+id+'/close',{body:{}}));
  assert.equal(failed.status,502,JSON.stringify(failed.body));
  assert.equal(failed.body.code,'PROVIDER_HTTP_ERROR');
  assert.equal(JSON.stringify(['recharge_orders','payment_transactions','credit_accounts'].map(t=>f.sql.prepare('SELECT * FROM '+t).all())),before);
  noGrant(f.sql);
 }finally{f.sql.close();}
});
