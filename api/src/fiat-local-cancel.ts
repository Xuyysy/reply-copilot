import type {Env} from "./types";
import {ApiFailure} from "./types";
import {sessionFor,requireCsrf,takeRate} from "./auth";
import {requireWebOrigin,jsonBody,nowMs,uuid} from "./security";
import {response} from "./http";

const UUID=/^[0-9a-f-]{36}$/i;

/**
 * A local cancellation retires our own checkout, NOT the merchant's payment
 * instruction. All subsequent authenticated success evidence must be held for
 * human review, never silently granted by this old invoice.
 */
async function owner(request:Request,env:Env,orderId:string){
 if(!UUID.test(orderId))throw new ApiFailure(400,"INVALID_ORDER_ID","订单号无效。");
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=="web")throw new ApiFailure(403,"WEB_SESSION_REQUIRED","请在官网登录后操作。");
 requireWebOrigin(request,env);
 await requireCsrf(request,env,token);
 const body=await jsonBody(request,256);
 if(body.confirm!==true||Object.keys(body).some(key=>key!=="confirm"))
  throw new ApiFailure(400,"ORDER_CANCEL_CONFIRM_REQUIRED","请确认尚未付款，并同意旧商户链接可能仍收款。");
 if(!await takeRate(env,"fiat-local-cancel:"+session.user_id,5,60000,nowMs()))
  throw new ApiFailure(429,"TOO_MANY_REQUESTS","操作频繁，请稍后再试。");
 return session.user_id;
}

export async function cancelLocalFiatSubscription(request:Request,env:Env,id:string):Promise<Response>{
 const userId=await owner(request,env,id),now=nowMs(),claim=uuid();
 // Merchant settings are NOT a prerequisite to cancelling a historical invoice.
 // The join checks the stored merchant identity, not today's active merchant.
 const eligible=await env.DB.prepare(
  "SELECT o.id,t.id transaction_id FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id "+
  "WHERE o.id=? AND o.user_id=? AND o.status IN ('pending','unknown') AND o.paid_at IS NULL AND o.applied_at IS NULL "+
  "AND t.merchant_provider IN ('xiaodou','mk99') AND t.status IN ('pending','unknown') AND t.risk_state='clear' "+
  "AND t.paid_at IS NULL AND t.checkout_state IN ('ready','unknown') AND t.provider_trade_id IS NOT NULL "+
  "AND NOT EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id AND e.event_type='PAYMENT_SUCCEEDED') "+
  "AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id) "+
  "AND NOT EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=o.id)"
 ).bind(id,userId).first<{id:string;transaction_id:string}>();
 if(!eligible)throw new ApiFailure(409,"ORDER_LOCAL_CANCEL_UNAVAILABLE","订单可能已经支付、正在创建付款入口或需要核验，请先查验原单。");
 const safe=
  "id=? AND status IN ('pending','unknown') AND risk_state='clear' AND paid_at IS NULL "+
  "AND checkout_state IN ('ready','unknown') AND merchant_provider IN ('xiaodou','mk99') "+
  "AND NOT EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=subscription_payment_transactions.id AND e.event_type='PAYMENT_SUCCEEDED') "+
  "AND EXISTS(SELECT 1 FROM subscription_orders o WHERE o.id=subscription_payment_transactions.order_id "+
  "AND o.user_id=? AND o.status IN ('pending','unknown') AND o.paid_at IS NULL AND o.applied_at IS NULL "+
  "AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id) "+
  "AND NOT EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=o.id))";
 try{
  await env.DB.batch([
   env.DB.prepare("UPDATE subscription_payment_transactions SET status='closed',cashier_url=NULL,updated_at=? WHERE "+safe)
    .bind(now,eligible.transaction_id,userId),
   env.DB.prepare("UPDATE subscription_orders SET status='closed',updated_at=? WHERE id=? AND user_id=? "+
    "AND status IN ('pending','unknown') AND paid_at IS NULL AND applied_at IS NULL "+
    "AND EXISTS(SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=subscription_orders.id "+
    "AND t.id=? AND t.status='closed' AND t.paid_at IS NULL AND t.risk_state='clear') "+
    "AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=subscription_orders.id) "+
    "AND NOT EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=subscription_orders.id)")
    .bind(now,id,userId,eligible.transaction_id),
   env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS("+
    "SELECT 1 FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id "+
    "WHERE o.id=? AND o.user_id=? AND t.id=? AND o.status='closed' AND t.status='closed' "+
    "AND o.paid_at IS NULL AND o.applied_at IS NULL AND t.paid_at IS NULL "+
    "AND NOT EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id AND e.event_type='PAYMENT_SUCCEEDED') "+
    "AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id) "+
    "AND NOT EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=o.id)) THEN 1 ELSE 0 END")
    .bind(claim,id,userId,eligible.transaction_id),
   env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(claim)
  ]);
 }catch{throw new ApiFailure(409,"ORDER_LOCAL_CANCEL_CONFLICT","订单状态已变化，无法确认关闭，请查询原单。");}
 return response({ok:true,orderStatus:"closed",localOnly:true},200,env,request);
}

/** Marker is attached to a specific historical checkout attempt, not a
 * fabricated merchant event. It distinguishes a user-retired invoice from
 * a merchant-confirmed close in the late-payment settlement handler. */
export const LOCAL_CANCEL_MARKER="|USER_LOCAL_CANCEL";
export async function cancelLocalFiatCredits(request:Request,env:Env,id:string):Promise<Response>{
 const userId=await owner(request,env,id),now=nowMs(),claim=uuid();
 const eligible=await env.DB.prepare(
  "SELECT o.id,t.id transaction_id FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id "+
  "WHERE o.id=? AND o.user_id=? AND o.status IN ('pending','awaiting_payment') AND o.paid_at IS NULL AND o.credited_at IS NULL "+
  "AND t.merchant_provider IN ('xiaodou','mk99') AND t.payment_protocol='rsa2' "+
  "AND t.status IN ('pending','unknown') AND t.risk_state='clear' AND t.paid_at IS NULL "+
  "AND COALESCE(t.actual_paid_fen,0)=0 AND t.provider_trade_id IS NOT NULL "+
  "AND EXISTS(SELECT 1 FROM payment_attempts a WHERE a.transaction_id=t.id AND a.state<>'prepared') "+
  "AND NOT EXISTS(SELECT 1 FROM payment_attempts a WHERE a.transaction_id=t.id AND a.state='prepared') "+
  "AND NOT EXISTS(SELECT 1 FROM provider_payment_events e WHERE e.transaction_id=t.id AND e.event_type='PAYMENT_SUCCEEDED') "+
  "AND NOT EXISTS(SELECT 1 FROM payment_refunds r WHERE r.transaction_id=t.id) "+
  "AND NOT EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id) "+
  "AND NOT EXISTS(SELECT 1 FROM credit_batches b WHERE b.source_order_id=o.id)"
 ).bind(id,userId).first<{id:string;transaction_id:string}>();
 if(!eligible)throw new ApiFailure(409,"ORDER_LOCAL_CANCEL_UNAVAILABLE","订单可能已支付或状态待核验，不能安全关闭。");
 try{
  await env.DB.batch([
   env.DB.prepare("UPDATE payment_attempts SET provider_code=COALESCE(provider_code,'')||?,updated_at=? "+
    "WHERE transaction_id=? AND attempt_number=(SELECT MAX(attempt_number) FROM payment_attempts WHERE transaction_id=?) "+
    "AND state<>'prepared' AND COALESCE(provider_code,'') NOT LIKE '%|USER_LOCAL_CANCEL' "+
    "AND EXISTS(SELECT 1 FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id "+
    "WHERE t.id=payment_attempts.transaction_id AND o.user_id=? AND o.status IN ('pending','awaiting_payment') "+
    "AND o.paid_at IS NULL AND o.credited_at IS NULL AND t.status IN ('pending','unknown') "+
    "AND t.risk_state='clear' AND t.paid_at IS NULL AND COALESCE(t.actual_paid_fen,0)=0)")
    .bind(LOCAL_CANCEL_MARKER,now,eligible.transaction_id,eligible.transaction_id,userId),
   env.DB.prepare("UPDATE payment_transactions SET status='closed',cashier_url=NULL,updated_at=? "+
    "WHERE id=? AND merchant_provider IN ('xiaodou','mk99') AND payment_protocol='rsa2' "+
    "AND status IN ('pending','unknown') AND risk_state='clear' AND paid_at IS NULL AND COALESCE(actual_paid_fen,0)=0 "+
    "AND EXISTS(SELECT 1 FROM payment_attempts a WHERE a.transaction_id=payment_transactions.id AND a.provider_code LIKE '%|USER_LOCAL_CANCEL') "+
    "AND NOT EXISTS(SELECT 1 FROM provider_payment_events e WHERE e.transaction_id=payment_transactions.id AND e.event_type='PAYMENT_SUCCEEDED') "+
    "AND NOT EXISTS(SELECT 1 FROM payment_refunds r WHERE r.transaction_id=payment_transactions.id) "+
    "AND EXISTS(SELECT 1 FROM recharge_orders o WHERE o.id=payment_transactions.order_id AND o.user_id=? "+
    "AND o.status IN ('pending','awaiting_payment') AND o.paid_at IS NULL AND o.credited_at IS NULL "+
    "AND NOT EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id) "+
    "AND NOT EXISTS(SELECT 1 FROM credit_batches b WHERE b.source_order_id=o.id))")
    .bind(now,eligible.transaction_id,userId),
   env.DB.prepare("UPDATE recharge_orders SET status='expired' WHERE id=? AND user_id=? "+
    "AND status IN ('pending','awaiting_payment') AND paid_at IS NULL AND credited_at IS NULL "+
    "AND EXISTS(SELECT 1 FROM payment_transactions t WHERE t.order_id=recharge_orders.id "+
    "AND t.id=? AND t.status='closed' AND t.risk_state='clear' AND t.paid_at IS NULL) "+
    "AND NOT EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=recharge_orders.id) "+
    "AND NOT EXISTS(SELECT 1 FROM credit_batches b WHERE b.source_order_id=recharge_orders.id)")
    .bind(id,userId,eligible.transaction_id),
   env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS("+
    "SELECT 1 FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id "+
    "WHERE o.id=? AND o.user_id=? AND t.id=? AND o.status='expired' AND t.status='closed' "+
    "AND o.paid_at IS NULL AND o.credited_at IS NULL AND t.paid_at IS NULL AND t.risk_state='clear' "+
    "AND EXISTS(SELECT 1 FROM payment_attempts a WHERE a.transaction_id=t.id AND a.provider_code LIKE '%|USER_LOCAL_CANCEL') "+
    "AND NOT EXISTS(SELECT 1 FROM provider_payment_events e WHERE e.transaction_id=t.id AND e.event_type='PAYMENT_SUCCEEDED') "+
    "AND NOT EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id) "+
    "AND NOT EXISTS(SELECT 1 FROM credit_batches b WHERE b.source_order_id=o.id)) THEN 1 ELSE 0 END")
    .bind(claim,id,userId,eligible.transaction_id),
   env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(claim)
  ]);
 }catch{throw new ApiFailure(409,"ORDER_LOCAL_CANCEL_CONFLICT","订单状态已变化，无法确认关闭，请查询原单。");}
 return response({ok:true,orderStatus:"closed",localOnly:true},200,env,request);
}
