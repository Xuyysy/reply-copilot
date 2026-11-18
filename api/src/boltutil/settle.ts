import type {Env} from "../types";
import {ApiFailure} from "../types";
import {sha256,nowMs,uuid} from "../security";
import {response} from "../http";
import {verifyBoltWebhook,boltRequest} from "./client";
import {boltReadSchemaReady} from "./environment";
import {closeProviderConfirmedUnpaidBoltSubscription} from "./terminal";
import {verifiedSubscriptionSourceSql} from "../subscription-payment-proof";
import {VerifiedPayment,verifiedPayment,distinctSettlement,tokenRawUnits,equalAddress,normalizedBoltTransactionHash,NETWORKS,type BoltNetwork} from "./contract";
import {SUBSCRIPTION_PERIOD_MS,SUBSCRIPTION_DAY_MS} from "../../../domain/subscription-policy.js";

type Local = {
  id:string;external_order_id:string;user_id:string;product_type:string;
  network:BoltNetwork;token_contract:string;token_decimals:number;payable_token_raw:string|null;
  credit_order_id:string|null;subscription_order_id:string|null;status:string;
  quoted_usdt_micros:number;payable_usdt_micros:number|null;
  receiving_address:string|null;tx_hash:string|null;applied_at:number|null;
};
async function localOrder(env:Env,externalId:string):Promise<Local|null>{
  return env.DB.prepare("SELECT * FROM boltutil_orders WHERE external_order_id=?")
    .bind(externalId).first<Local>();
}
function coercePayment(value:Record<string,unknown>):unknown{
  const payment=value.payment;
  const nested=payment&&typeof payment==="object"&&!Array.isArray(payment)
    ? payment as Record<string,unknown>:{};
  return {...nested,...value,amount:value.amount??nested.amount??null,
    destinationAddress:value.destinationAddress??nested.destinationAddress??nested.address??null,
    externalOrderId:value.externalOrderId??value.merchantExternalId??null};
}
function isConfirmed(status:unknown):boolean{return status==="CONFIRMED"||status==="COMPLETED";}
function failReview(env:Env,order:Local,now:number):Promise<unknown>{
  return env.DB.prepare("UPDATE boltutil_orders SET status='manual_review',updated_at=? WHERE id=? AND status IN ('creating','pending','unknown')")
    .bind(now,order.id).run();
}

/** Provider status query is mandatory: a signed callback is a trigger, not permission to grant. */
export async function settleBoltPayment(env:Env,externalId:string,callback:Record<string,unknown>|null):Promise<void>{
  if(!boltReadSchemaReady(env)||!env.BOLTUTIL_API_KEY||!env.BOLTUTIL_WEBHOOK_SECRET)
    throw new ApiFailure(503,"BOLTUTIL_UNAVAILABLE","USDT 查单暂不可用。");
  const order=await localOrder(env,externalId);
  if(!order)throw new ApiFailure(404,"BOLTUTIL_ORDER_NOT_FOUND","订单不存在。");
  if(order.status==="paid"&&order.applied_at!==null){
    if(callback&&(typeof callback.txHash!=="string"||normalizedBoltTransactionHash(callback.txHash,order.network)!==order.tx_hash||callback.network!==order.network))
      throw new ApiFailure(409,"BOLTUTIL_TX_CONFLICT","付款证据不一致。");
    return;
  }
  if(order.payable_usdt_micros===null||order.receiving_address===null||order.payable_token_raw===null)
    throw new ApiFailure(503,"BOLTUTIL_SNAPSHOT_UNREADY","原始收银台快照尚未可靠保存，请保留原单重试查单。");
  const activeUser=await env.DB.prepare("SELECT 1 FROM users WHERE id=? AND status='active' AND archived_at IS NULL")
    .bind(order.user_id).first();
  if(!activeUser){
    await failReview(env,order,nowMs());
    throw new ApiFailure(409,"BOLTUTIL_ACCOUNT_HELD","账户无法接受新权益，已进入人工复核。");
  }
  if(order.status==="manual_review")
    throw new ApiFailure(409,"BOLTUTIL_PAYMENT_REVIEW","此订单需要人工核对。");
  let data:Record<string,unknown>;
  try{data=await boltRequest(env,"/api/v1/order/status",{externalOrderId:externalId});}
  catch(error){
    // A previously closed invoice stays closed if the provider cannot be
    // queried. Never mark it paid from an outage or a browser-reported result.
    if(order.status==="closed"&&!callback)return;
    throw error;
  }
  if(!isConfirmed(data.status)){
    // Only a provider-authenticated, identity-matched, strictly unpaid terminal
    // response may release an old BoltUtil subscription blocking new checkout.
    // EXPIRED alone may later receive a confirmed payment; never auto-grant it.
    if(!callback&&order.product_type==="subscription"&&order.status!=="closed")
      await closeProviderConfirmedUnpaidBoltSubscription(env,externalId,data);
    return;
  }
  let trusted:VerifiedPayment;
  try{
    trusted=verifiedPayment(coercePayment(data));
    if(callback){
      const webhook=verifiedPayment(callback);
      if(!distinctSettlement(webhook,trusted))throw new RangeError("callback vs query mismatch");
    }
    if(trusted.externalOrderId!==order.external_order_id || trusted.network!==order.network ||
       order.token_contract!==NETWORKS[order.network].contract ||
       order.token_decimals!==NETWORKS[order.network].decimals ||
       order.payable_usdt_micros===null||BigInt(order.payable_usdt_micros)!==trusted.amountMicros||
       !order.receiving_address||!equalAddress(order.receiving_address,trusted.address,order.network) ||
       order.payable_token_raw!==tokenRawUnits(trusted.amountMicros,order.network).toString() ||
       trusted.amountMicros<BigInt(order.quoted_usdt_micros) ||
       (order.tx_hash!==null&&normalizedBoltTransactionHash(order.tx_hash,order.network)!==trusted.txHash))
      throw new RangeError("payment vs order mismatch");
  }catch{
    await failReview(env,order,nowMs());
    throw new ApiFailure(409,"BOLTUTIL_PAYMENT_MISMATCH","链上付款与订单快照不一致，已进入人工核对。");
  }
  const now=nowMs(),eventId=callback&&typeof callback.eventId==="string"&&
    /^[A-Za-z0-9_-]{6,128}$/.test(callback.eventId)?callback.eventId:"query:"+trusted.txHash;
  const digest=await sha256(JSON.stringify({externalId,txHash:trusted.txHash,amount:String(trusted.amountMicros),
    paid:String(trusted.paidMicros),status:trusted.status,origin:callback?"webhook":"query"}));
  if(order.status==="closed"){
    // Local cashier closure never proves that funds cannot arrive later.
    // Record a subsequently provider-confirmed transfer, but DO NOT grant
    // subscription days or paid credits from a closed invoice.
    const claim=uuid();
    const original=order.product_type==="subscription"?"subscription_orders":"recharge_orders";
    const originalId=order.product_type==="subscription"?order.subscription_order_id:order.credit_order_id;
    const statements:D1PreparedStatement[]=[
      env.DB.prepare("INSERT INTO boltutil_payment_events(event_id,external_order_id,status,network,tx_hash,body_sha256,received_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM boltutil_orders WHERE id=? AND external_order_id=? AND status='closed' AND network=?) ON CONFLICT DO NOTHING")
        .bind(eventId,externalId,trusted.status,trusted.network,trusted.txHash,digest,now,order.id,externalId,order.network),
      env.DB.prepare("UPDATE boltutil_orders SET status='manual_review',paid_at=COALESCE(paid_at,?),paid_usdt_micros=?,tx_hash=?,updated_at=? WHERE id=? AND external_order_id=? AND status='closed' AND paid_at IS NULL AND applied_at IS NULL AND tx_hash IS NULL AND EXISTS(SELECT 1 FROM boltutil_payment_events WHERE external_order_id=? AND network=? AND tx_hash=?)")
        .bind(now,Number(trusted.paidMicros),trusted.txHash,now,order.id,externalId,externalId,trusted.network,trusted.txHash),
      ...(order.product_type==="subscription"?[
        env.DB.prepare("UPDATE subscription_orders SET status='manual_review',paid_at=COALESCE(paid_at,?),updated_at=? WHERE id=? AND user_id=? AND status='closed' AND applied_at IS NULL AND EXISTS(SELECT 1 FROM boltutil_orders b WHERE b.subscription_order_id=subscription_orders.id AND b.user_id=subscription_orders.user_id AND b.id=? AND b.status='manual_review' AND b.tx_hash=?)")
          .bind(now,now,originalId,order.user_id,order.id,trusted.txHash)
      ]:[]),
      env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM boltutil_orders b JOIN "+original+" o ON o.id="+(order.product_type==="subscription"?"b.subscription_order_id":"b.credit_order_id")+" AND o.user_id=b.user_id WHERE b.id=? AND b.user_id=? AND b.status='manual_review' AND b.tx_hash=? AND o.status='"+(order.product_type==="subscription"?"manual_review":"expired")+"' AND "+(order.product_type==="subscription"?"o.applied_at IS NULL AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id)":"o.credited_at IS NULL AND NOT EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id)")+") THEN 1 ELSE 0 END")
        .bind(claim,order.id,order.user_id,trusted.txHash),
      env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(claim)
    ];
    try{await env.DB.batch(statements);}
    catch{throw new ApiFailure(503,"BOLTUTIL_LATE_PAYMENT_REVIEW_UNCONFIRMED","关闭后到账证据待复核，请联系支持。");}
    return;
  }
  const statements:D1PreparedStatement[]=[
    env.DB.prepare("INSERT INTO boltutil_payment_events(event_id,external_order_id,status,network,tx_hash,body_sha256,received_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM boltutil_orders WHERE id=? AND external_order_id=? AND network=?) ON CONFLICT DO NOTHING")
      .bind(eventId,externalId,trusted.status,trusted.network,trusted.txHash,digest,now,order.id,externalId,order.network),
    env.DB.prepare("UPDATE boltutil_orders SET status='paid',paid_usdt_micros=?,tx_hash=?,paid_at=COALESCE(paid_at,?),updated_at=? WHERE id=? AND external_order_id=? AND status IN ('creating','pending','unknown','paid') AND payable_usdt_micros=? AND network=? AND (CASE WHEN network='SOLANA' THEN receiving_address=? ELSE lower(receiving_address)=lower(?) END) AND (tx_hash IS NULL OR tx_hash=?) AND EXISTS(SELECT 1 FROM boltutil_payment_events WHERE external_order_id=? AND network=? AND tx_hash=?)")
      .bind(Number(trusted.paidMicros),trusted.txHash,now,now,order.id,externalId,
        Number(trusted.amountMicros),order.network,trusted.address,trusted.address,trusted.txHash,externalId,order.network,trusted.txHash)
  ];
  // Use explicit paid proof in every write; no fiat payment_transactions rows are created.
  const paidProof="EXISTS(SELECT 1 FROM boltutil_orders b JOIN boltutil_payment_events e ON e.external_order_id=b.external_order_id AND e.network=b.network AND e.tx_hash=b.tx_hash WHERE b.id=? AND b.status='paid' AND b.tx_hash=? AND b.payable_usdt_micros=? AND b.network=? AND (CASE WHEN b.network='SOLANA' THEN b.receiving_address=? ELSE lower(b.receiving_address)=lower(?) END) AND EXISTS(SELECT 1 FROM users u WHERE u.id=b.user_id AND u.status='active' AND u.archived_at IS NULL))";
  const args=[order.id,trusted.txHash,Number(trusted.amountMicros),order.network,trusted.address,trusted.address];
  if(order.product_type==="credits"){
    statements.push(
      env.DB.prepare("UPDATE recharge_orders SET status='paid',paid_at=COALESCE(paid_at,?) WHERE id=? AND user_id=? AND status IN ('pending','awaiting_payment','paid') AND payment_method='boltutil' AND "+paidProof)
        .bind(now,order.credit_order_id,order.user_id,...args),
      env.DB.prepare("UPDATE credit_accounts SET paid_balance=paid_balance+(SELECT credits FROM recharge_orders WHERE id=?),version=version+1,updated_at=? WHERE user_id=? AND "+paidProof+" AND EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND status='paid' AND credited_at IS NULL) AND NOT EXISTS(SELECT 1 FROM credit_ledger WHERE kind='purchase_grant' AND reference_id=?)")
        .bind(order.credit_order_id,now,order.user_id,...args,order.credit_order_id,order.credit_order_id),
      env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) SELECT ?,o.user_id,'purchase_grant',0,o.credits,o.id,'BoltUtil USDT confirmed',? FROM recharge_orders o WHERE o.id=? AND o.user_id=? AND o.status='paid' AND "+paidProof+" ON CONFLICT(kind,reference_id) DO NOTHING")
        .bind(uuid(),now,order.credit_order_id,order.user_id,...args),
      env.DB.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,source_order_id,grant_credits,remaining_credits,consumed_credits,permanently_revoked_credits,generation_reserved_credits,refund_reserved_credits,granted_at,paid_at,history_confidence,status) SELECT ?,o.user_id,'paid','purchase',o.id,o.credits,o.credits,0,0,0,0,?,?,'tracked','active' FROM recharge_orders o WHERE o.id=? AND o.user_id=? AND EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id AND l.user_id=o.user_id) AND "+paidProof+" ON CONFLICT DO NOTHING")
        .bind(uuid(),now,now,order.credit_order_id,order.user_id,...args),
      env.DB.prepare("UPDATE recharge_orders SET credited_at=COALESCE(credited_at,?) WHERE id=? AND user_id=? AND status='paid' AND EXISTS(SELECT 1 FROM credit_batches WHERE source_order_id=? AND user_id=? AND status='active') AND "+paidProof)
        .bind(now,order.credit_order_id,order.user_id,order.credit_order_id,order.user_id,...args),
      env.DB.prepare("UPDATE boltutil_orders SET applied_at=COALESCE(applied_at,?),updated_at=? WHERE id=? AND status='paid' AND EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND user_id=? AND credited_at IS NOT NULL)")
        .bind(now,now,order.id,order.credit_order_id,order.user_id)
    );
  }else{
    const sub=await env.DB.prepare("SELECT id,kind,plan_version_id,target_period_id,amount_fen FROM subscription_orders WHERE id=? AND user_id=?")
      .bind(order.subscription_order_id,order.user_id).first<{id:string;kind:string;plan_version_id:string;target_period_id:string|null;amount_fen:number}>();
    if(!sub||!["purchase","renewal","upgrade"].includes(sub.kind))throw new ApiFailure(409,"BOLTUTIL_SUBSCRIPTION_INVALID","订阅订单无效。");
    statements.push(env.DB.prepare("UPDATE subscription_orders SET status='paid',paid_at=COALESCE(paid_at,?),updated_at=? WHERE id=? AND user_id=? AND status IN ('pending','unknown','paid') AND "+paidProof)
      .bind(now,now,sub.id,order.user_id,...args));
    if(sub.kind==="upgrade"){
      const claim=uuid();
      statements.push(
        env.DB.prepare("INSERT INTO subscription_tier_changes(id,period_id,order_id,previous_plan_version_id,next_plan_version_id,previous_daily_limit,next_daily_limit,charged_fen,effective_at,original_expires_at) SELECT ?,p.id,o.id,p.plan_version_id,v.id,p.daily_limit,v.daily_limit,o.amount_fen,?,p.end_at FROM subscription_orders o JOIN subscription_upgrade_quotes q ON q.order_id=o.id JOIN subscription_periods p ON p.id=q.period_id AND p.user_id=o.user_id JOIN subscription_orders source ON source.id=p.source_order_id AND source.user_id=p.user_id JOIN subscription_plan_versions v ON v.id=o.plan_version_id WHERE o.id=? AND o.user_id=? AND o.status='paid' AND o.kind='upgrade' AND o.target_period_id=p.id AND o.amount_fen=q.amount_fen AND q.to_version_id=v.id AND q.from_version_id=p.plan_version_id AND q.period_end_at=p.end_at AND p.status='active' AND p.end_at-?>=? AND v.daily_limit>p.daily_limit AND "+verifiedSubscriptionSourceSql(env)+" AND "+paidProof+" ON CONFLICT(order_id) DO NOTHING")
          .bind(claim,now,sub.id,order.user_id,now,SUBSCRIPTION_DAY_MS,...args),
        env.DB.prepare("UPDATE subscription_periods SET plan_version_id=?,daily_limit=(SELECT daily_limit FROM subscription_plan_versions WHERE id=?),updated_at=? WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM subscription_tier_changes WHERE id=? AND period_id=subscription_periods.id)")
          .bind(sub.plan_version_id,sub.plan_version_id,now,sub.target_period_id,order.user_id,claim),
        env.DB.prepare("UPDATE subscription_orders SET applied_at=COALESCE(applied_at,?),updated_at=? WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM subscription_tier_changes WHERE order_id=subscription_orders.id)")
          .bind(now,now,sub.id,order.user_id),
        env.DB.prepare("UPDATE subscription_orders SET status='manual_review',updated_at=? WHERE id=? AND user_id=? AND applied_at IS NULL AND status='paid'")
          .bind(now,sub.id,order.user_id),
        env.DB.prepare("UPDATE boltutil_orders SET status='manual_review',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM subscription_orders WHERE id=? AND status='manual_review')")
          .bind(now,order.id,sub.id)
      );
    }else{
      statements.push(
        env.DB.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) SELECT ?,o.user_id,o.id,o.plan_version_id,v.daily_limit,CASE WHEN EXISTS(SELECT 1 FROM subscription_periods p WHERE p.user_id=o.user_id AND (p.status IN ('active','refund_pending','revoked') AND p.end_at>? OR p.status='queued')) THEN 'queued' ELSE 'active' END,CASE WHEN EXISTS(SELECT 1 FROM subscription_periods p WHERE p.user_id=o.user_id AND (p.status IN ('active','refund_pending','revoked') AND p.end_at>? OR p.status='queued')) THEN NULL ELSE ? END,CASE WHEN EXISTS(SELECT 1 FROM subscription_periods p WHERE p.user_id=o.user_id AND (p.status IN ('active','refund_pending','revoked') AND p.end_at>? OR p.status='queued')) THEN NULL ELSE ? END,?,? FROM subscription_orders o JOIN subscription_plan_versions v ON v.id=o.plan_version_id WHERE o.id=? AND o.user_id=? AND o.kind IN ('purchase','renewal') AND o.status='paid' AND o.amount_fen=v.price_fen AND "+paidProof+" AND NOT EXISTS(SELECT 1 FROM subscription_periods WHERE source_order_id=o.id)")
          .bind(uuid(),now,now,now,now,now+SUBSCRIPTION_PERIOD_MS,now,now,sub.id,order.user_id,...args),
        env.DB.prepare("UPDATE subscription_orders SET applied_at=COALESCE(applied_at,?),updated_at=? WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM subscription_periods WHERE source_order_id=subscription_orders.id)")
          .bind(now,now,sub.id,order.user_id)
      );
    }
    statements.push(env.DB.prepare("UPDATE boltutil_orders SET applied_at=COALESCE(applied_at,?),updated_at=? WHERE id=? AND status='paid' AND EXISTS(SELECT 1 FROM subscription_orders WHERE id=? AND user_id=? AND applied_at IS NOT NULL)")
      .bind(now,now,order.id,sub.id,order.user_id));
  }
  const invariantId=uuid();
  statements.push(
    env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM boltutil_orders b JOIN "+(order.product_type==="credits"?"recharge_orders":"subscription_orders")+" o ON o.id="+(order.product_type==="credits"?"b.credit_order_id":"b.subscription_order_id")+" WHERE b.id=? AND b.user_id=? AND ((b.status='paid' AND b.applied_at IS NOT NULL AND o.status='paid') OR (b.status='manual_review' AND o.status='manual_review' AND b.product_type='subscription'))) THEN 1 ELSE 0 END")
      .bind(invariantId,order.id,order.user_id),
    env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(invariantId)
  );
  try{await env.DB.batch(statements);}
  catch{throw new ApiFailure(503,"BOLTUTIL_SETTLEMENT_UNCONFIRMED","付款已核验，但权益结算尚未完成，请保留原单。");}
}
export async function boltWebhook(request:Request,env:Env):Promise<Response>{
  if(!boltReadSchemaReady(env)||!env.BOLTUTIL_WEBHOOK_SECRET)
    throw new ApiFailure(404,"NOT_FOUND","支付通知接口不可用。");
  const payload=await verifyBoltWebhook(request,env.BOLTUTIL_WEBHOOK_SECRET);
  if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new ApiFailure(400,"INVALID_WEBHOOK","通知无效。");
  const event=payload as Record<string,unknown>;
  if(typeof event.externalOrderId!=="string"||!/^[A-Za-z0-9_-]{6,64}$/.test(event.externalOrderId)||
    typeof event.eventId!=="string"||!/^[A-Za-z0-9_-]{6,128}$/.test(event.eventId))
    throw new ApiFailure(400,"INVALID_WEBHOOK","通知订单标识无效。");
  if(!isConfirmed(event.status))return response({ok:true,settled:false},200,env,request);
  await settleBoltPayment(env,event.externalOrderId,event);
  return response({ok:true},200,env,request);
}
