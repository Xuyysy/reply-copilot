import {createMk99Checkout,refreshMk99Order,mk99Notify,adminMk99Check} from './mk99-payments';
import {orderById,querySubscriptionPayment} from './subscription-settlement';
export {mk99Notify,adminMk99Check};
import {mk99Config} from './mk99';
import { paymentControl, type PaymentChannel, type PaymentProvider } from "./payment-policy";
import {xiaodouNetworkReady} from './xiaodou-merchant';
import { CUSTOMER_FEE_RATE_BPS, projectMk99Pricing, projectPackagePricing, projectXiaodouSellerPricing, type PackagePricing } from "./pricing";
export { projectPaymentFee } from "./pricing";
import type { Env, Session } from "./types";
import { epayCheckout, parseEpayParameters, verifyEpay, moneyToFen } from "./epay.js";
import { inspectCheckoutResponse, classifyCheckoutFailure, checkoutMarker, checkoutFromAttempt, checkoutHttpStatus, type CheckoutResult } from "./payment-checkout";
import { ApiFailure, RefreshDiagnosticFailure, type RefreshDiagnosticCode, type RefreshDiagnosticStage } from "./types";
import { requireCsrf, sessionFor } from "./auth";
import { requireAdminSession } from "./admin-auth";
import { jsonBody, nowMs, uuid } from "./security";
import { response } from "./http";
import { releaseUnusableCreditCheckout } from "./payment-retry-release.js";
import { balance } from "./quota";
import { PayloadTooLargeError, readLimitedBytes, refundEventMatchesTransaction, reconcileFeeProjection, webhookEventMatchesStatus, XiaodouClient, XiaodouProviderError, safeProviderResponseDiagnostic, xiaodouWebhookIsEnabled } from "./xiaodou.js";

export type PaymentTransaction = { id:string;order_id:string;provider:"xiaodou"|"local_mock";amount_fen:number;currency:"CNY";status:string;provider_trade_id:string|null;order_user_id?:string;order_credits?:number;order_status?:string;credited_at?:number|null;base_amount_fen?:number;service_fee_fen?:number;fee_rate_bps?:number;principal_refunded_fen?:number;service_fee_refunded_fen?:number;provider_fee_projection_status?:string;provider_fee_projection_json?:string|null;provider_fee_projection_issue?:string|null;payment_protocol?:"rsa2"|"epay";payment_channel?:"ALIPAY_H5"|"WECHAT_H5"|null;epay_pid?:string|null;epay_trade_no?:string|null;merchant_provider?:string;merchant_account?:string|null;notification_sign_type?:string|null;provider_payment_id?:string|null;amount_contract?:string|null;risk_state?:string };
type PaymentEvent = { eventId:string;eventType:string;amountFen:number;currency:string;bodySha256?:string;epayTradeNo?:string };
const LOCAL_WEB_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

function isLocalMock(env:Env,request:Request):boolean {
  const host=new URL(request.url).hostname;
  return env.ENVIRONMENT==="development"&&env.AI_MOCK==="1"&&env.PAYMENT_PROVIDER==="mock"&&LOCAL_WEB_ORIGIN.test(env.WEB_ORIGIN)&&["127.0.0.1","localhost"].includes(host);
}
function realPaymentsEnabled(env:Env):boolean { return env.PAYMENTS_ENABLED==='1'; }
async function checkoutAllowedFor(env:Env,transaction:PaymentTransaction):Promise<boolean> {
  const control=await paymentControl(env);
  const provider=transaction.merchant_provider==="mk99"?"mk99":transaction.payment_protocol==="epay"?"xiaodou_epay":"xiaodou";
  // Historical rows may not have a channel snapshot. Before channel-aware
  // orders existed, the only supported channel was Alipay H5.
  const channel=transaction.payment_channel??"ALIPAY_H5";
  // Creating another pay attempt is forbidden when purchases are paused.
  // An old RSA2 order still belongs to its original Xiaodou merchant even
  // after NEW orders have been switched back to MK99. Checking methods alone
  // would mistakenly strand it under the new merchant selection.
  if(provider==="xiaodou"){
    const channelSettings=control.channels.rsa2[channel==="WECHAT_H5"?"wechat":"alipay"];
    return control.environmentReady&&control.operatorEnabled&&control.providers.rsa2.enabled
      &&control.providers.rsa2.credentialsConfigured&&channelSettings.enabled&&channelSettings.platformReleased
      &&env.XIAODOU_RSA2_SUBSCRIPTIONS_READY==="1"&&xiaodouNetworkReady(env)
      &&env.XIAODOU_WEBHOOKS_ENABLED==="1"
      &&(channel!=="WECHAT_H5"||env.XIAODOU_WECHAT_MERCHANT_APPROVED==="1")
      &&(!transaction.merchant_account||transaction.merchant_account===env.XIAODOU_APP_ID);
  }
  return control.methods.some(method=>method.provider===provider&&method.channel===channel);
}
function epayConfig(env:Env){
  if(!env.XIAODOU_EPAY_GATEWAY||!env.XIAODOU_EPAY_PID||!/^\d{1,32}$/.test(env.XIAODOU_EPAY_PID)||!env.XIAODOU_EPAY_KEY?.trim())throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","易支付尚未配置完成。");
  return {gateway:env.XIAODOU_EPAY_GATEWAY,pid:env.XIAODOU_EPAY_PID,key:env.XIAODOU_EPAY_KEY,apiOrigin:env.API_ORIGIN,webOrigin:env.WEB_ORIGIN};
}
function configuredXiaodouClient(env:Env):InstanceType<typeof XiaodouClient> {
  if(!env.XIAODOU_BASE_URL||!env.XIAODOU_APP_ID||!env.XIAODOU_KEY_ID||!env.XIAODOU_PRIVATE_KEY||!env.XIAODOU_PLATFORM_PUBLIC_KEYS) throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付暂未开放。");
  let keys:Record<string,string>;
  try { keys=JSON.parse(env.XIAODOU_PLATFORM_PUBLIC_KEYS) as Record<string,string>; } catch { throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付暂未开放。"); }
  try { return new XiaodouClient({baseUrl:env.XIAODOU_BASE_URL,ownApiOrigin:env.API_ORIGIN,appId:env.XIAODOU_APP_ID,keyId:env.XIAODOU_KEY_ID,privateKeyPem:env.XIAODOU_PRIVATE_KEY,platformPublicKeys:keys,environment:env.ENVIRONMENT}); }
  catch { throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付暂未开放。"); }
}
function paymentClient(env:Env):InstanceType<typeof XiaodouClient> {
  if(!realPaymentsEnabled(env))throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付暂未开放。");
  return configuredXiaodouClient(env);
}
async function webSession(request:Request,env:Env,write=false):Promise<Session> {
  const {session,token}=await sessionFor(request,env);
  if(session.kind!=="web") throw new ApiFailure(403,"FORBIDDEN","请在官网登录。");
  if(write) await requireCsrf(request,env,token);
  return session;
}
function cleanId(value:unknown,pattern=/^[a-z0-9_-]{6,64}$/i):string { if(typeof value!=="string"||!pattern.test(value)) throw new ApiFailure(400,"INVALID_REQUEST","请求标识无效。"); return value; }
function localOnlyError():never { throw new ApiFailure(404,"NOT_FOUND","接口不存在。"); }
function refreshProviderFailure(error:unknown,requestId:string):RefreshDiagnosticFailure {
  if(error instanceof XiaodouProviderError){
    const providerResponse=safeProviderResponseDiagnostic(error.responseDiagnostic,error.upstreamHttpStatus);
    if(error.code==="NETWORK_UNCERTAIN") return new RefreshDiagnosticFailure("PROVIDER_NETWORK_ERROR","provider_fetch",requestId,503,"连接支付平台失败，订单状态仍待确认。");
    if(error.code==="PROVIDER_CONFIG_ERROR") return new RefreshDiagnosticFailure("PROVIDER_CONFIG_ERROR","provider_request_signing",requestId,503,"支付配置暂时无法用于查单。");
    if(error.stage==="provider_http_response") return new RefreshDiagnosticFailure("PROVIDER_HTTP_ERROR","provider_http_response",requestId,502,"支付平台暂时无法确认订单。",error.upstreamHttpStatus??null,providerResponse);
    if(error.stage==="provider_response_signature") return new RefreshDiagnosticFailure("PROVIDER_SIGNATURE_ERROR","provider_response_signature",requestId,502,"支付平台响应暂时无法验证。",error.upstreamHttpStatus??null,providerResponse);
    const stage:RefreshDiagnosticStage=error.stage==="provider_request_signing"?"provider_request_signing":error.stage==="provider_fetch"?"provider_fetch":error.stage==="provider_response"?"provider_response":"unknown";
    return new RefreshDiagnosticFailure("SERVER_UNAVAILABLE",stage,requestId,503,"查单暂时不可用，订单状态仍待确认。",error.upstreamHttpStatus??null);
  }
  return new RefreshDiagnosticFailure("SERVER_UNAVAILABLE","unknown",requestId,503,"查单暂时不可用，订单状态仍待确认。");
}
function mapProviderStatus(value:unknown):"pending"|"paid"|"closed"|"failed"|"unknown" {
  if(value==="SUCCEEDED")return "paid";
  if(value==="CLOSED")return "closed";
  if(value==="FAILED")return "failed";
  if(value==="UNKNOWN")return "unknown";
  if(value==="CREATED"||value==="PAYING")return "pending";
  throw new ApiFailure(502,"INVALID_PROVIDER_STATUS","支付状态暂时无法确认。");
}
async function transactionForOrder(env:Env,orderId:string):Promise<PaymentTransaction|null> {
  return env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.order_id=?").bind(orderId).first<PaymentTransaction>();
}
async function recordProviderFeeProjection(env:Env,transaction:PaymentTransaction,incoming:unknown):Promise<ReturnType<typeof reconcileFeeProjection>>{
  const next=reconcileFeeProjection(transaction.provider_fee_projection_status??"pending",transaction.provider_fee_projection_json??null,incoming,transaction.amount_fen);
  await env.DB.prepare("UPDATE payment_transactions SET provider_fee_projection_status=?,provider_fee_projection_json=?,provider_fee_projection_issue=?,updated_at=? WHERE id=?").bind(next.status,next.json,next.issue,nowMs(),transaction.id).run();
  transaction.provider_fee_projection_status=next.status;
  transaction.provider_fee_projection_json=next.json;
  transaction.provider_fee_projection_issue=next.issue;
  return next;
}
export async function applyPaymentEvent(env:Env,transaction:PaymentTransaction,event:PaymentEvent):Promise<{duplicate:boolean;quota:{freeRemaining:number;paidRemaining:number;totalRemaining:number};status:string}> {
  if(event.currency!=="CNY")throw new ApiFailure(409,"PAYMENT_MISMATCH","支付金额或币种与订单不符。");
  if(event.eventType==="PAYMENT_SUCCEEDED"&&event.amountFen!==transaction.amount_fen)throw new ApiFailure(409,"PAYMENT_MISMATCH","支付金额或币种与订单不符。");
  const now=nowMs(),userId=transaction.order_user_id!,orderId=transaction.order_id;
  const target=event.eventType==="PAYMENT_SUCCEEDED"?"paid":event.eventType==="PAYMENT_CLOSED"?"closed":event.eventType==="PAYMENT_FAILED"?"failed":event.eventType==="PAYMENT_UNKNOWN"?"unknown":null;
  if(!target)throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","支付事件类型无效。");
  const duplicatePaymentState=async()=>{
    const row=await env.DB.prepare("SELECT transaction_id,event_type,amount_fen,currency FROM provider_payment_events WHERE provider=? AND provider_event_id=?").bind(transaction.provider,event.eventId).first<{transaction_id:string;event_type:string;amount_fen:number;currency:string}>();
    if(!row)return null;
    if(row.transaction_id!==transaction.id||row.event_type!==event.eventType||Number(row.amount_fen)!==event.amountFen||row.currency!==event.currency)
      throw new ApiFailure(409,"PAYMENT_EVENT_CONFLICT","支付事件标识已用于其他订单或与当前订单信息不匹配。");
    const current=await transactionForOrder(env,orderId);
    return {duplicate:true as const,quota:await balance(env,userId),status:current?.status??transaction.status};
  };
  const priorEvent=await duplicatePaymentState();
  if(priorEvent)return priorEvent;
  const eventId=uuid();
  const epayGuard=event.epayTradeNo?[
    env.DB.prepare("UPDATE payment_transactions SET epay_trade_no=? WHERE id=? AND payment_protocol='epay' AND (epay_trade_no IS NULL OR epay_trade_no=?)").bind(event.epayTradeNo,transaction.id,event.epayTradeNo),
    env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND payment_protocol='epay' AND epay_trade_no=?) THEN 1 ELSE 0 END").bind(`epay:${eventId}`,transaction.id,event.epayTradeNo),
  ]:[];
  if(transaction.merchant_provider==="mk99")epayGuard.push(
    env.DB.prepare("UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),actual_paid_fen=CASE WHEN ?='PAYMENT_SUCCEEDED' THEN ? ELSE actual_paid_fen END WHERE id=? AND merchant_provider='mk99' AND (provider_payment_id IS NULL OR provider_payment_id=?)").bind(transaction.provider_payment_id??null,event.eventType,transaction.amount_fen,transaction.id,transaction.provider_payment_id??null),env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND merchant_provider='mk99' AND risk_state='clear' AND provider_payment_id=?) THEN 1 ELSE 0 END").bind(`mk99:${eventId}`,transaction.id,transaction.provider_payment_id??null));
  const results=await env.DB.batch([
    ...epayGuard,
    env.DB.prepare("INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at,merchant_provider) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payment_transactions WHERE id=?) ON CONFLICT(provider,provider_event_id) DO NOTHING").bind(eventId,transaction.provider,event.eventId,transaction.id,event.eventType,event.amountFen,event.currency,event.bodySha256??null,now,transaction.merchant_provider??transaction.provider,transaction.id),
    env.DB.prepare("UPDATE payment_transactions SET status=?,provider_trade_id=COALESCE(provider_trade_id,?),paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,?) ELSE paid_at END,updated_at=? WHERE id=? AND status NOT IN ('paid','refunded') AND EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?)").bind(target,transaction.provider_trade_id??null,target,now,now,transaction.id,eventId),
    env.DB.prepare("UPDATE recharge_orders SET status=CASE WHEN ?='paid' THEN 'paid' WHEN ?='closed' THEN 'expired' WHEN ?='unknown' THEN 'awaiting_payment' ELSE 'failed' END,payment_method=?,provider_reference=COALESCE(provider_reference,?),paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,?) ELSE paid_at END WHERE id=? AND status IN ('pending','awaiting_payment','failed','expired') AND credited_at IS NULL AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status=?)").bind(target,target,target,transaction.merchant_provider==="mk99"?"mk99":transaction.provider,transaction.provider_trade_id??null,target,now,orderId,transaction.id,target),
    env.DB.prepare("UPDATE credit_accounts SET paid_balance=paid_balance+?,version=version+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND status='paid' AND credited_at IS NULL) AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status='paid') AND NOT EXISTS(SELECT 1 FROM credit_ledger WHERE kind='purchase_grant' AND reference_id=?) AND NOT EXISTS(SELECT 1 FROM credit_batches WHERE source_order_id=?)").bind(transaction.order_credits,now,userId,orderId,transaction.id,orderId,orderId),
    env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) SELECT ?,?,'purchase_grant',0,?,?,?,? WHERE EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND status='paid' AND credited_at IS NULL) AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status='paid') ON CONFLICT(kind,reference_id) DO NOTHING").bind(uuid(),userId,transaction.order_credits,orderId,transaction.merchant_provider==="mk99"?"MK99支付成功到账":"小豆支付成功到账",now,orderId,transaction.id),
    env.DB.prepare(`INSERT INTO credit_batches(id,user_id,bucket,source_kind,source_order_id,grant_credits,remaining_credits,consumed_credits,permanently_revoked_credits,generation_reserved_credits,refund_reserved_credits,granted_at,paid_at,history_confidence,status)
      SELECT ?,?, 'paid','purchase',?,?,?,0,0,0,0,?,?,'tracked','active'
      WHERE EXISTS(SELECT 1 FROM credit_ledger WHERE kind='purchase_grant' AND reference_id=?) ON CONFLICT DO NOTHING`).bind(uuid(),userId,orderId,transaction.order_credits,transaction.order_credits,now,now,orderId),
    env.DB.prepare("UPDATE recharge_orders SET credited_at=? WHERE id=? AND status='paid' AND credited_at IS NULL AND EXISTS(SELECT 1 FROM credit_ledger WHERE kind='purchase_grant' AND reference_id=?) AND EXISTS(SELECT 1 FROM credit_batches WHERE source_order_id=? AND user_id=? AND grant_credits=?)").bind(now,orderId,orderId,orderId,userId,transaction.order_credits),
    env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status='paid') OR EXISTS(SELECT 1 FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id JOIN credit_batches b ON b.source_order_id=o.id JOIN credit_accounts a ON a.user_id=o.user_id WHERE t.id=? AND o.credited_at IS NOT NULL AND b.grant_credits=o.credits AND a.paid_balance=(SELECT COALESCE(sum(remaining_credits),0) FROM credit_batches WHERE user_id=o.user_id AND bucket='paid')) THEN 1 ELSE 0 END`).bind(eventId,transaction.id,transaction.id),
    env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(eventId),
    ...(transaction.merchant_provider==="mk99"?[env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(`mk99:${eventId}`)]:[]),
    ...(event.epayTradeNo?[env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(`epay:${eventId}`)]:[]),
  ]);
  if(results[epayGuard.length].meta.changes!==1){
    const duplicate=await duplicatePaymentState();
    if(duplicate)return duplicate;
    throw new ApiFailure(409,"PAYMENT_EVENT_CONFLICT","支付事件无法安全关联到当前订单，请核对后重试。");
  }
  const current=await transactionForOrder(env,orderId);
  return {duplicate:false,quota:await balance(env,userId),status:current?.status??target};
}
async function applyRefundEvent(env:Env,transaction:PaymentTransaction,refund:Record<string,unknown>,event:PaymentEvent):Promise<{duplicate:boolean;status:string;quota:{freeRemaining:number;paidRemaining:number;totalRemaining:number}}>{
  const refundId=String(refund.id),refundNo=String(refund.out_refund_no),amount=Number(refund.amount_fen),credits=Number(refund.credits_to_revoke??refund.credits_reserved),principal=Number(refund.base_amount_fen??amount),fee=Number(refund.service_fee_amount_fen??0),batchId=typeof refund.credit_batch_id==="string"?refund.credit_batch_id:null,userId=transaction.order_user_id!;
  if(event.currency!=="CNY"||event.amountFen!==amount)throw new ApiFailure(409,"REFUND_MISMATCH","退款金额或币种与记录不符。");
  if(event.eventType!=="REFUND_SUCCEEDED"&&event.eventType!=="REFUND_FAILED")throw new ApiFailure(400,"INVALID_REFUND_EVENT","退款事件类型无效。");
  const duplicateState=async()=>{
    const row=await env.DB.prepare(`SELECT e.transaction_id,e.event_type,e.amount_fen,e.currency,
      EXISTS(SELECT 1 FROM payment_refunds r WHERE r.resolved_event_id=e.provider_event_id AND r.id=?) same_refund,
      EXISTS(SELECT 1 FROM payment_refunds r WHERE r.resolved_event_id=e.provider_event_id AND r.id<>?) other_refund
      FROM provider_payment_events e WHERE e.provider=? AND e.provider_event_id=?`).bind(refundId,refundId,transaction.provider,event.eventId).first<{transaction_id:string;event_type:string;amount_fen:number;currency:string;same_refund:number;other_refund:number}>();
    if(!row)return null;
    if(row.transaction_id!==transaction.id||row.event_type!==event.eventType||Number(row.amount_fen)!==event.amountFen||row.currency!==event.currency||row.same_refund!==1||row.other_refund!==0)
      throw new ApiFailure(409,"REFUND_EVENT_CONFLICT","退款事件标识已用于其他退款或与当前退款信息不匹配。");
    const current=await env.DB.prepare("SELECT status FROM payment_refunds WHERE id=?").bind(refundId).first<{status:string}>();
    return {duplicate:true as const,status:current?.status??String(refund.status),quota:await balance(env,userId)};
  };
  const priorEvent=await duplicateState();
  if(priorEvent)return priorEvent;
  const now=nowMs(),resolved=event.eventType==="REFUND_SUCCEEDED"?"succeeded":"failed",eid=uuid();
  const auditBefore=JSON.stringify({status:refund.status,principalRefundedFen:transaction.principal_refunded_fen??0,serviceFeeRefundedFen:transaction.service_fee_refunded_fen??0,creditsReserved:credits,creditBatchId:batchId});
  const auditAfter=JSON.stringify({status:resolved,eventId:event.eventId,amountFen:amount,principalRefundFen:principal,serviceFeeRefundFen:fee,creditsToRevoke:credits,creditBatchId:batchId});
  const statements=[
    env.DB.prepare("INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payment_transactions WHERE id=?) ON CONFLICT(provider,provider_event_id) DO NOTHING").bind(eid,transaction.provider,event.eventId,transaction.id,event.eventType,event.amountFen,event.currency,event.bodySha256??null,now,transaction.id),
    env.DB.prepare("UPDATE payment_refunds SET status=?,resolved_event_id=?,updated_at=?,succeeded_at=CASE WHEN ?='succeeded' THEN COALESCE(succeeded_at,?) ELSE succeeded_at END WHERE id=? AND status IN ('requested','pending','unknown') AND resolved_event_id IS NULL AND EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?)").bind(resolved,event.eventId,now,resolved,now,refundId,eid),
    env.DB.prepare("UPDATE credit_batches SET remaining_credits=remaining_credits-CASE WHEN ?='succeeded' THEN ? ELSE 0 END,permanently_revoked_credits=permanently_revoked_credits+CASE WHEN ?='succeeded' THEN ? ELSE 0 END,refund_reserved_credits=refund_reserved_credits-?,status=CASE WHEN ?='succeeded' AND remaining_credits=? THEN 'refunded' WHEN status='refund_pending' THEN 'active' ELSE status END WHERE id=? AND refund_reserved_credits>=? AND remaining_credits>=? AND EXISTS(SELECT 1 FROM payment_refunds WHERE id=? AND resolved_event_id=? AND status=?) AND EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?)").bind(resolved,credits,resolved,credits,credits,resolved,credits,batchId,credits,credits,refundId,event.eventId,resolved,eid),
    env.DB.prepare("UPDATE credit_accounts SET paid_balance=paid_balance-CASE WHEN ?='succeeded' THEN ? ELSE 0 END,paid_reserved_for_refunds=paid_reserved_for_refunds-?,version=version+1,updated_at=? WHERE user_id=? AND paid_balance>=CASE WHEN ?='succeeded' THEN ? ELSE 0 END AND paid_reserved_for_refunds>=? AND EXISTS(SELECT 1 FROM payment_refunds WHERE id=? AND resolved_event_id=? AND status=?) AND EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?)").bind(resolved,credits,credits,now,userId,resolved,credits,credits,refundId,event.eventId,resolved,eid),
    env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) SELECT ?,?,'purchase_reversal',0,?,?,?,? WHERE ?='succeeded' AND EXISTS(SELECT 1 FROM payment_refunds WHERE id=? AND resolved_event_id=? AND status='succeeded') AND EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?) ON CONFLICT(kind,reference_id) DO NOTHING").bind(uuid(),userId,-credits,refundNo,"小豆退款成功，收回该订单未使用额度",now,resolved,refundId,event.eventId,eid),
    env.DB.prepare("UPDATE payment_transactions SET principal_refunded_fen=principal_refunded_fen+?,service_fee_refunded_fen=service_fee_refunded_fen+?,status=CASE WHEN principal_refunded_fen+?+service_fee_refunded_fen+?>=amount_fen THEN 'refunded' ELSE status END,refunded_at=CASE WHEN principal_refunded_fen+?+service_fee_refunded_fen+?>=amount_fen THEN COALESCE(refunded_at,?) ELSE refunded_at END,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM payment_refunds WHERE id=? AND resolved_event_id=? AND status='succeeded') AND EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?)").bind(resolved==='succeeded'?principal:0,resolved==='succeeded'?fee:0,resolved==='succeeded'?principal:0,resolved==='succeeded'?fee:0,resolved==='succeeded'?principal:0,resolved==='succeeded'?fee:0,now,now,transaction.id,refundId,event.eventId,eid),
    env.DB.prepare("UPDATE recharge_orders SET status='refunded' WHERE id=? AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status='refunded') AND EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?)").bind(transaction.order_id,transaction.id,eid),
    env.DB.prepare(`INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,before_json,after_json,created_at)
      SELECT ?,r.actor_user_id,?,r.id,r.reason,?,?,? FROM payment_refunds r
      WHERE r.id=? AND r.refund_kind='special' AND r.actor_user_id IS NOT NULL AND r.resolved_event_id=? AND r.status=? AND EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?)`).bind(uuid(),`special_refund_${resolved}`,auditBefore,auditAfter,now,refundId,event.eventId,resolved,eid),
    env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM payment_refunds r JOIN payment_transactions t ON t.id=r.transaction_id WHERE r.id=? AND r.resolved_event_id=? AND r.status=? AND (r.credits_to_revoke=0 OR EXISTS(SELECT 1 FROM credit_batches b WHERE b.id=r.credit_batch_id AND b.refund_reserved_credits=(SELECT COALESCE(sum(other.credits_to_revoke),0) FROM payment_refunds other WHERE other.credit_batch_id=b.id AND other.status IN ('requested','pending','unknown')) AND b.remaining_credits=b.grant_credits-b.consumed_credits-b.permanently_revoked_credits)) AND EXISTS(SELECT 1 FROM credit_accounts a WHERE a.user_id=? AND a.paid_balance=(SELECT COALESCE(sum(remaining_credits),0) FROM credit_batches WHERE user_id=? AND bucket='paid') AND a.paid_reserved_for_refunds=(SELECT COALESCE(sum(refund_reserved_credits),0) FROM credit_batches WHERE user_id=? AND bucket='paid')) AND (r.refund_kind<>'special' OR r.actor_user_id IS NULL OR EXISTS(SELECT 1 FROM admin_audit_logs WHERE target_id=r.id AND action=?))) THEN 1 ELSE 0 END WHERE EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?)`).bind(eid,refundId,event.eventId,resolved,userId,userId,userId,`special_refund_${resolved}`,eid),
    env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(eid),
  ];
  const results=await env.DB.batch(statements);
  if(results[0].meta.changes!==1){
    const duplicate=await duplicateState();
    if(duplicate)return duplicate;
    throw new ApiFailure(409,"REFUND_EVENT_CONFLICT","退款事件无法安全关联到当前退款，请核对后重试。");
  }
  const current=await env.DB.prepare("SELECT status FROM payment_refunds WHERE id=?").bind(refundId).first<{status:string}>();
  return {duplicate:false,status:current?.status??resolved,quota:await balance(env,userId)};
}

export async function packages(request:Request,env:Env):Promise<Response>{
  const rows=await env.DB.prepare("SELECT id,name_zh,name_en,credits,price_cents,promo_price_cents,currency,price_cny_fen,description_zh,description_en,recommended_label_zh,recommended_label_en,featured,settlement_mode,exchange_rate_micros,fee_rate_bps,sort_order FROM recharge_packages WHERE active=1 ORDER BY sort_order,id").all();
  const control=await paymentControl(env);
  const priced=rows.results.map((row:any)=>{let fee:ReturnType<typeof projectPackagePricing>|null=null;try{fee=control.activeMerchant==='mk99'?projectMk99Pricing(row):control.defaultMethod?.provider==='xiaodou_epay'?projectPackagePricing(row):projectXiaodouSellerPricing(row);}catch(error){if(!(error instanceof ApiFailure))throw error;}return {...row,price_cny_fen:fee?.baseAmountFen??null,service_fee_fen:fee?.serviceFeeFen??null,total_payment_fen:fee?.totalPaymentFen??null,...(fee&&"merchantPricing" in fee?{merchant_pricing:fee.merchantPricing}:{}),fee_rate_bps:fee?.feeRateBps??(control.activeMerchant==='mk99'?0:row.fee_rate_bps??CUSTOMER_FEE_RATE_BPS)};});
  const localMock=isLocalMock(env,request),paymentAvailable=localMock||control.effectiveEnabled;
  return response({packages:priced,paymentAvailable,paymentProvider:localMock?"local_mock":control.defaultMethod?.provider??null,paymentMethods:localMock?[{provider:"local_mock",channel:"ALIPAY_H5"}]:control.methods},200,env,request);
}
export async function createOrder(request:Request,env:Env,options?:{pilot?:{actorUserId:string;operationId:string;expectedAmountFen:number}}):Promise<Response>{
  const session=await webSession(request,env,true),body=await jsonBody(request,1024),packageId=cleanId(body.packageId,/^[a-z0-9_-]{1,64}$/i),mock=isLocalMock(env,request),control=await paymentControl(env),pilot=options?.pilot??null;
  if(pilot&&(
    env.ENVIRONMENT!=='production'||env.XIAODOU_PRODUCTION_PILOT_ENABLED!=='1'||
    env.XIAODOU_PRODUCTION_PILOT_TRADE_APPROVED!=='1'||
    session.user_id!==pilot.actorUserId||!/^[-0-9a-f]{36}$/i.test(pilot.operationId)||
    control.activeMerchant!=='mk99'||!control.environmentReady||!control.operatorEnabled||
    !control.providers.rsa2.enabled||!control.providers.rsa2.credentialsConfigured||
    !control.channels.rsa2.alipay.enabled||!xiaodouNetworkReady(env)||
    env.XIAODOU_WEBHOOKS_ENABLED!=='1'||mock||packageId!=='starter'||body.channel!=='ALIPAY_H5'))
    throw new ApiFailure(409,'XIAODOU_PILOT_NOT_READY','仅允许已明确批准的生产管理员测试订单。');
  const real=pilot?(control.environmentReady&&control.operatorEnabled):control.effectiveEnabled;
  if(!mock&&!real)throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付尚未开放，暂不能创建订单。");
  const channel=(body.channel??control.defaultMethod?.channel??"ALIPAY_H5") as PaymentChannel;
  if(!["ALIPAY_H5","WECHAT_H5"].includes(channel))throw new ApiFailure(400,"INVALID_PAYMENT_CHANNEL","请选择可用的支付方式。");
  const selected=pilot?{provider:"xiaodou" as const,channel:"ALIPAY_H5" as const}:mock?{provider:"local_mock" as const,channel:"ALIPAY_H5" as const}:control.methods.find(method=>method.channel===channel&&(body.provider===undefined?control.activeMerchant==='xiaodou':method.provider===body.provider));
  if(!selected)throw new ApiFailure(503,"PAYMENT_CHANNEL_UNAVAILABLE","该支付方式暂不可用。");
  const paymentProvider=selected.provider as PaymentProvider|"local_mock";
  const pkg=await env.DB.prepare("SELECT id,name_zh,credits,price_cents,promo_price_cents,currency,price_cny_fen,settlement_mode,exchange_rate_micros,fee_rate_bps FROM recharge_packages WHERE id=? AND active=1").bind(packageId).first<{id:string;name_zh:string;credits:number;price_cents:number;promo_price_cents:number|null;currency:string;price_cny_fen:number|null}&PackagePricing>();
  if(!pkg)throw new ApiFailure(404,"PACKAGE_NOT_FOUND","套餐不存在或已下架。");
  const feeSnapshot=paymentProvider==="mk99"?projectMk99Pricing(pkg):paymentProvider==="xiaodou"?projectXiaodouSellerPricing(pkg):projectPackagePricing(pkg),amountFen=feeSnapshot.totalPaymentFen;
  if(pilot&&(paymentProvider!=='xiaodou'||channel!=='ALIPAY_H5'||amountFen<1||amountFen>1000||amountFen!==pilot.expectedAmountFen))
    throw new ApiFailure(409,'PILOT_PRICE_EXCEEDS_LIMIT','正式验收仅允许固定入门包，单笔付款不超过 ¥10。');
  const mk99=real&&paymentProvider==="mk99",mkConfig=mk99?mk99Config(env):null;
  const epay=real&&paymentProvider==="xiaodou_epay";
  if(body.restartPayment!==undefined&&(typeof body.restartPayment!=="boolean"||!epay))throw new ApiFailure(400,"INVALID_REQUEST","仅易支付支持主动重新发起订单。");
  const restart=epay&&body.restartPayment===true;
  const paymentProtocol=epay?"epay":"rsa2";
  const unresolvedProtocol=" AND EXISTS(SELECT 1 FROM payment_transactions existing WHERE existing.order_id=recharge_orders.id AND existing.payment_protocol=? AND existing.merchant_provider=?)";
  const client=real&&!epay&&!mk99?paymentClient(env):null;
  // Release only an original first-attempt linkless checkout, never payment facts.
  const retryMerchant=pilot?null:mk99?'mk99':real&&paymentProvider==='xiaodou'?'xiaodou':null;
  if(retryMerchant){
    try{await releaseUnusableCreditCheckout(env,{userId:session.user_id,merchant:retryMerchant,packageId:pkg.id});}
    catch{console.warn({event:'credit_checkout_retry_release_error',merchant:retryMerchant,stage:'precreate'});}
  }
  const id=uuid(),now=nowMs(),amountCents=pkg.promo_price_cents??pkg.price_cents,provider=mock?"local_mock":"xiaodou",outTradeNo=`XRH_${id.replaceAll("-","")}`,transactionId=uuid(),attemptId=uuid(),requestId=`xrh-${uuid()}`,packageName=pilot?`【小豆生产验收】${pkg.name_zh}`:pkg.name_zh;
  let paymentForm:ReturnType<typeof epayCheckout>|null=null;
  if(epay){
    try{paymentForm=epayCheckout(epayConfig(env),{orderId:id,outTradeNo,amountFen,name:`x-Reply-Helper ${pkg.credits}次`});}
    catch{throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","易支付配置暂时不可用。");}
  }
  const merchant=mk99?'mk99':'xiaodou';
  const gateKeys=mk99?['payment_mk99_enabled',channel==='WECHAT_H5'?'payment_mk99_wechat_enabled':'payment_mk99_alipay_enabled',channel==='WECHAT_H5'?'payment_mk99_wechat_released':'payment_mk99_alipay_released']:epay?['payment_epay_enabled','payment_epay_alipay_enabled','payment_epay_alipay_released']:['payment_rsa2_enabled',channel==='WECHAT_H5'?'payment_rsa2_wechat_enabled':'payment_rsa2_alipay_enabled',channel==='WECHAT_H5'?'payment_rsa2_wechat_released':'payment_rsa2_alipay_released'];
  const creationGate=pilot
    ? " AND EXISTS(SELECT 1 FROM system_settings WHERE key='active_merchant' AND value='mk99') AND EXISTS(SELECT 1 FROM system_settings WHERE key='purchase_enabled' AND value='1') AND (SELECT count(*) FROM system_settings WHERE key IN ('payment_rsa2_enabled','payment_rsa2_alipay_enabled') AND value='1')=2 AND EXISTS(SELECT 1 FROM site_administrator WHERE id=1 AND user_id=?) AND EXISTS(SELECT 1 FROM admin_operations WHERE id=? AND actor_user_id=? AND action='xiaodou_production_pilot_checkout') AND NOT EXISTS(SELECT 1 FROM recharge_orders older WHERE older.user_id=? AND older.package_name LIKE '【小豆生产验收】%' AND older.created_at>=?)"
    : " AND (?=1 OR (EXISTS(SELECT 1 FROM system_settings WHERE key='active_merchant' AND value=?) AND EXISTS(SELECT 1 FROM system_settings WHERE key='purchase_enabled' AND value='1') AND (SELECT count(*) FROM system_settings WHERE key IN (?,?,?) AND value='1')=3))";
  const creationArgs=pilot?[session.user_id,pilot.operationId,session.user_id,session.user_id,now-86400000]:[mock?1:0,merchant,...gateKeys];
  const created=await env.DB.batch([
    env.DB.prepare(`INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,payment_method,provider_reference,created_at) SELECT ?,?,?,?, ?,?,'USD','awaiting_payment',?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND archived_at IS NULL) AND (?=1 OR NOT EXISTS(SELECT 1 FROM recharge_orders WHERE user_id=? AND package_id=? AND status IN ('pending','awaiting_payment')${unresolvedProtocol}))${creationGate}`).bind(id,session.user_id,pkg.id,packageName,pkg.credits,amountCents,pilot?'xiaodou_pilot':mk99?"mk99":provider,outTradeNo,now,session.user_id,restart?1:0,session.user_id,pkg.id,paymentProtocol,mk99?"mk99":mock?"local_mock":"xiaodou",...creationArgs),
    env.DB.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,base_amount_fen,service_fee_fen,fee_rate_bps,fee_snapshot_version,provider_fee_projection_status,status,provider_trade_id,created_at,updated_at,payment_protocol,payment_channel,epay_pid,settlement_mode,exchange_rate_micros,merchant_provider,merchant_account,notification_sign_type,amount_contract,provider_requested_fen,merchant_pricing_snapshot) SELECT ?,?,?,'CNY',?,?,?,?, 'fee-v1',CASE WHEN ?='xiaodou' THEN 'pending' ELSE 'not_applicable' END,'pending',?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND user_id=?)").bind(transactionId,id,provider,amountFen,feeSnapshot.baseAmountFen,feeSnapshot.serviceFeeFen,feeSnapshot.feeRateBps,epay?"epay":mk99?"mk99":provider,outTradeNo,now,now,paymentProtocol,channel,epay?env.XIAODOU_EPAY_PID:null,feeSnapshot.settlementMode,feeSnapshot.exchangeRateMicros,mk99?"mk99":mock?"local_mock":"xiaodou",mk99?mkConfig!.pid:(!epay&&!mock?env.XIAODOU_APP_ID??null:null),mk99?mkConfig!.notifySignType:(!epay&&!mock?env.XIAODOU_KEY_ID??null:null),(mk99||(!epay&&!mock&&paymentProvider==="xiaodou"))?"CNY_EXACT_BUYER_TOTAL":null,mk99?amountFen:null,mk99?JSON.stringify((feeSnapshot as ReturnType<typeof projectMk99Pricing>).merchantPricing):null,id,session.user_id),
    env.DB.prepare("INSERT INTO payment_attempts(id,transaction_id,attempt_number,provider_request_id,state,created_at,updated_at) SELECT ?,?,1,?,'prepared',?,? WHERE EXISTS(SELECT 1 FROM payment_transactions WHERE id=?)").bind(attemptId,transactionId,requestId,now,now,transactionId),
  ]);
  if(created[0].meta.changes!==1){
    if(pilot)throw new ApiFailure(409,"PILOT_LIMIT_REACHED","已有验收订单或管理员操作记录，请核对原订单，勿重复付款。");
    if(!mock&&!(await paymentControl(env)).methods.some(method=>method.provider===selected.provider&&method.channel===channel))throw new ApiFailure(503,"PAYMENT_CHANNEL_UNAVAILABLE","支付方式状态已变化，请重新选择。");
    throw new ApiFailure(409,"UNRESOLVED_ORDER_EXISTS",mk99?"该套餐已有待付款或待确认订单，请先确认原订单状态。其他套餐仍可购买。":"该套餐在当前通道已有待支付或待确认订单。请查看原订单，或主动选择重新发起支付；旧订单仍保留。");
  }
  if(mk99)return await createMk99Checkout(request,env,(await transactionForOrder(env,id))!,{attemptId,requestId,packageName:packageName,credits:pkg.credits,displayPriceCents:amountCents,...feeSnapshot});
  if(mock)return response({paymentAvailable:true,paymentProvider:"local_mock",order:{id,packageName:packageName,credits:pkg.credits,displayPriceCents:amountCents,displayCurrency:"USD",baseAmountFen:feeSnapshot.baseAmountFen,serviceFeeFen:feeSnapshot.serviceFeeFen,feeRateBps:feeSnapshot.feeRateBps,amountFen,currency:"CNY",status:"pending",paymentMode:"mock",message:"本地模拟订单，不会产生真实扣款。"}},201,env,request);
  if(paymentForm){
    const checkout:CheckoutResult={outcome:"ready",issue:"EPAY_FORM_PREPARED",paymentUrl:null,paymentStatus:"pending"};
    let prepared=true;
    try{await persistCheckout(env,transactionId,attemptId,checkout);}catch{prepared=false;}
    return response({ok:prepared,paymentProvider:"xiaodou_epay",order:{id,packageName:packageName,credits:pkg.credits,displayPriceCents:amountCents,displayCurrency:"USD",...feeSnapshot,amountFen,currency:"CNY",status:"pending",paymentProtocol:"epay",paymentChannel:channel,paymentForm:prepared?paymentForm:null,checkout:prepared?{outcome:"ready",issue:"EPAY_FORM_PREPARED"}:{outcome:"unknown",issue:"CHECKOUT_PERSISTENCE_UNCONFIRMED"}},requestId},prepared?201:503,env,request);
  }
  let checkout:CheckoutResult,providerError:unknown;
  try {
    const result=await client!.createPayment({outTradeNo,channel,amountFen,currency:"CNY",subject:`x-Reply-Helper ${packageName} ${pkg.credits}次`,payerClientIp:request.headers.get("cf-connecting-ip")||"",...(env.XIAODOU_TRADE_SCOPE?{tradeScope:env.XIAODOU_TRADE_SCOPE}:{}),...(env.XIAODOU_RETURN_URL?{returnUrl:env.XIAODOU_RETURN_URL}:{})},{requestId});
    checkout=inspectCheckoutResponse(result,{outTradeNo,amountFen});
    // Show a verified buyer cashier even if the independent seller-fee
    // projection needs accounting review; never change the buyer amount.
    await recordProviderFeeProjection(env,(await transactionForOrder(env,id))!,result.feeProjection);
  } catch(error) { providerError=error;checkout=classifyCheckoutFailure(error); }
  try { await persistCheckout(env,transactionId,attemptId,checkout); }
  catch { checkout={outcome:"unknown",issue:"CHECKOUT_PERSISTENCE_UNCONFIRMED",paymentUrl:null,paymentStatus:"unknown"}; }
  const current=await transactionForOrder(env,id);
  let retryAvailable=false;
  if(!pilot&&paymentProvider==='xiaodou'&&checkout.outcome!=='ready'&&checkout.outcome!=='confirmation_required'){
    try{retryAvailable=await releaseUnusableCreditCheckout(env,{userId:session.user_id,merchant:'xiaodou',orderId:id});}
    catch{console.warn({event:'credit_checkout_retry_release_error',merchant:'xiaodou',stage:'postcreate'});}
  }
  const settled=current&&["paid","refunded","closed","failed"].includes(current.status);
  const diagnostic=providerError&&env.ENVIRONMENT==="staging"?refreshProviderFailure(providerError,requestId):null;
  return response({ok:checkout.outcome==="ready",...(checkout.outcome!=="ready"?{code:"PAYMENT_CHECKOUT_UNAVAILABLE",message:retryAvailable?"付款链接未生成；本地重试限制已解除，可以重新下单；如发生实际扣款请联系客服核对。":"付款链接未生成，请保留订单并核对结果，不要重复下单。"}:{}),
    order:{id,packageName:packageName,credits:pkg.credits,displayPriceCents:amountCents,displayCurrency:"USD",...feeSnapshot,amountFen,currency:"CNY",status:settled?current.status:checkout.paymentStatus,
      paymentUrl:!settled&&checkout.outcome==="ready"?checkout.paymentUrl:null,checkout:{outcome:checkout.outcome,issue:checkout.issue},paymentLinkUnavailable:checkout.outcome!=="ready",retryAvailable,paymentProtocol,paymentChannel:channel},
    requestId,...(diagnostic?{diagnostic:{stage:diagnostic.stage,upstreamHttpStatus:diagnostic.upstreamHttpStatus,...(diagnostic.providerResponse?{providerResponse:diagnostic.providerResponse}:{})}}:{})},checkoutHttpStatus(checkout),env,request);
}
async function persistCheckout(env:Env,transactionId:string,attemptId:string,result:CheckoutResult):Promise<void>{
  const now=nowMs(),attemptState=result.outcome==="rejected"?"failed":result.paymentStatus==="pending"?"pending":"unknown";
  await env.DB.batch([
    env.DB.prepare("UPDATE payment_attempts SET state=?,cashier_url=?,provider_code=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status IN ('pending','unknown'))").bind(attemptState,result.paymentUrl,checkoutMarker(result),now,attemptId,transactionId),
    env.DB.prepare("UPDATE payment_transactions SET status=?,cashier_url=?,updated_at=? WHERE id=? AND status IN ('pending','unknown')").bind(result.paymentStatus,result.paymentUrl,now,transactionId),
  ]);
}
function storedMk99Cashier(env:Env,row:Record<string,unknown>):{url:string;origin:string}|null {
  if(row.merchant_provider!=="mk99"||row.payment_status!=="pending"||row.risk_state!=="clear"
    ||row.credited_at!=null||row.paid_at!=null||row.has_credit_settlement===1||!["pending","awaiting_payment"].includes(String(row.status)))return null;
  try {
    if(typeof row.cashier_url!=="string"||/[\\\u0000-\u0020\u007f]/.test(row.cashier_url))return null;
    const url=new URL(row.cashier_url);
    if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash||!mk99Config(env).cashierOrigins.includes(url.origin))return null;
    return {url:row.cashier_url,origin:url.origin};
  }catch{return null;}
}

/** Restore only an ORIGINAL, previously signed Xiaodou cashier snapshot.
 * An ordinary GET never contacts Xiaodou, mints a new attempt or grants credit.
 * Never return a cashier on unknown/paid/risk-held/merchant-mismatched orders. */
function storedXiaodouCashier(env:Env,row:Record<string,unknown>):{url:string;origin:string}|null {
  const marker=checkoutFromAttempt(row.checkout_marker);
  if(row.merchant_provider!=="xiaodou"||row.payment_protocol!=="rsa2"||
    row.payment_status!=="pending"||row.status!=="awaiting_payment"||
    row.risk_state!=="clear"||row.credited_at!=null||row.paid_at!=null||
    Number(row.has_credit_settlement)!==0||marker?.outcome!=="ready"||
    (row.amount_contract!=="CNY_EXACT_BUYER_TOTAL"&&row.provider_fee_projection_status!=="verified")||
    row.merchant_account!==env.XIAODOU_APP_ID||
    row.notification_sign_type!==env.XIAODOU_KEY_ID)return null;
  try{
    if(typeof row.cashier_url!=="string"||row.cashier_url.length>8192||/[\\\u0000-\u0020\u007f]/.test(row.cashier_url))return null;
    const url=new URL(row.cashier_url);
    if(url.protocol!=="https:"||url.username||url.password)return null;
    return {url:row.cashier_url,origin:url.origin};
  }catch{return null;}
}
export async function findUnresolvedOrder(request:Request,env:Env):Promise<Response>{
 const session=await webSession(request,env);
 const url=new URL(request.url);
 const packageId=cleanId(url.searchParams.get("packageId"),/^[a-z0-9_-]{1,64}$/i);
 const provider=url.searchParams.get("provider"),channel=url.searchParams.get("channel");
 if(!["xiaodou","xiaodou_epay","mk99","local_mock"].includes(provider||"")||
    !["ALIPAY_H5","WECHAT_H5"].includes(channel||""))
   throw new ApiFailure(400,"INVALID_REQUEST","请选择有效的套餐和付款方式。");
 const protocol=provider==="mk99"?"mk99":provider==="xiaodou_epay"?"epay":"rsa2";
 const merchant=provider==="mk99"?"mk99":provider==="local_mock"?"local_mock":"xiaodou";
 const found=await env.DB.prepare("SELECT o.id,t.status payment_status FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id WHERE o.user_id=? AND o.package_id=? AND o.status IN ('pending','awaiting_payment') AND t.payment_protocol=? AND t.merchant_provider=? ORDER BY o.created_at DESC LIMIT 1").bind(session.user_id,packageId,protocol,merchant).first<{id:string;payment_status:string}>();
 return response({order:found?{id:found.id,status:found.payment_status}:null},200,env,request);
}
/* Read-only, authenticated lookup across all orders (not limited to account
 * history's 50 rows). It never creates an attempt or assumes 'unknown'=unpaid. */
export async function getOrder(request:Request,env:Env,orderId:string):Promise<Response>{
  const session=await webSession(request,env),row=await env.DB.prepare("SELECT o.id,o.package_id,o.package_name,o.credits,o.amount_cents,o.currency,o.status,o.created_at,o.paid_at,o.credited_at,(EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id) OR EXISTS(SELECT 1 FROM credit_batches b WHERE b.source_order_id=o.id)) has_credit_settlement,t.provider,t.merchant_provider,t.payment_protocol,t.payment_channel,t.amount_fen,t.base_amount_fen,t.service_fee_fen,t.fee_rate_bps,t.currency payment_currency,t.status payment_status,t.risk_state,t.merchant_pricing_snapshot,t.cashier_url,t.merchant_account,t.notification_sign_type,t.amount_contract,t.provider_fee_projection_status,t.provider_fee_projection_issue,(SELECT a.provider_code FROM payment_attempts a WHERE a.transaction_id=t.id ORDER BY a.attempt_number DESC LIMIT 1) checkout_marker FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id WHERE o.id=? AND o.user_id=?").bind(orderId,session.user_id).first<Record<string,unknown>>();
  if(!row)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
  const cashier=storedMk99Cashier(env,row)??storedXiaodouCashier(env,row);
  return response({order:{paymentProvider:row.merchant_provider==="mk99"?"mk99":row.provider,paymentProtocol:row.merchant_provider==="mk99"?"mk99":row.payment_protocol,paymentChannel:row.payment_channel??null,...(row.merchant_provider==="mk99"?{riskState:row.risk_state,merchantPricing:row.merchant_pricing_snapshot?JSON.parse(String(row.merchant_pricing_snapshot)):null}:{}),checkout:checkoutFromAttempt(row.checkout_marker),id:row.id,packageId:row.package_id,packageName:row.package_name,credits:row.credits,displayPriceCents:row.amount_cents,displayCurrency:row.currency,baseAmountFen:row.base_amount_fen,serviceFeeFen:row.service_fee_fen,feeRateBps:row.fee_rate_bps,amountFen:row.amount_fen,currency:row.payment_currency,status:row.payment_status,providerFeeProjectionStatus:row.provider_fee_projection_status,providerFeeProjectionIssue:row.provider_fee_projection_issue,createdAt:row.created_at,paidAt:row.paid_at,creditedAt:row.credited_at,paymentUrl:cashier?.url??null,paymentCashierOrigin:cashier?.origin??null,retryAvailable:row.status==="expired"&&row.payment_status==="unknown"&&row.paid_at==null&&row.credited_at==null&&Number(row.has_credit_settlement)===0&&!row.cashier_url},quota:await balance(env,session.user_id)},200,env,request);
}
async function paymentTransactionForOwner(env:Env,orderId:string,userId:string):Promise<PaymentTransaction>{
  const txn=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE o.id=? AND o.user_id=?").bind(orderId,userId).first<PaymentTransaction>();
  if(!txn)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
  return txn;
}
export async function simulatePayment(request:Request,env:Env,orderId:string):Promise<Response>{
  if(!isLocalMock(env,request))localOnlyError();
  const session=await webSession(request,env,true),transaction=await paymentTransactionForOwner(env,orderId,session.user_id),body=await jsonBody(request,1024);
  if(transaction.provider!=="local_mock")throw new ApiFailure(404,"NOT_FOUND","接口不存在。");
  const eventId=cleanId(body.eventId,/^[A-Za-z0-9_-]{8,80}$/),eventType=body.eventType??"PAYMENT_SUCCEEDED";
  if(!["PAYMENT_SUCCEEDED","PAYMENT_FAILED","PAYMENT_CLOSED","PAYMENT_UNKNOWN"].includes(String(eventType)))throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","模拟支付状态无效。");
  const amountFen=body.amountFen===undefined?transaction.amount_fen:Number(body.amountFen);
  if(!Number.isSafeInteger(amountFen)||amountFen<0)throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","模拟支付金额无效。");
  const result=await applyPaymentEvent(env,transaction,{eventId,eventType:String(eventType),amountFen:eventType==="PAYMENT_SUCCEEDED"?amountFen:0,currency:"CNY"});
  return response({ok:true,alreadyProcessed:result.duplicate,orderStatus:result.status,quota:result.quota},200,env,request);
}
export async function refreshOrder(request:Request,env:Env,orderId:string):Promise<Response>{
  const session=await webSession(request,env,true),transaction=await paymentTransactionForOwner(env,orderId,session.user_id);
  if(new URL(request.url).searchParams.has('diagnostic'))throw new ApiFailure(404,"NOT_FOUND","接口不存在。");
  if(transaction.merchant_provider==="mk99")return await refreshMk99Order(request,env,transaction);
  // Payment checkout is a separately gated write capability. Existing owners
  // must still be able to reconcile a previously created Xiaodou order after
  // checkout is turned off, using the configured read-only query operation.
  if(transaction.provider!=="xiaodou")throw new ApiFailure(404,"NOT_FOUND","接口不存在。");
  if(transaction.payment_protocol==="epay")return response({ok:true,orderStatus:transaction.status,verificationSource:"local_only",quota:await balance(env,session.user_id)},200,env,request);
  const requestId=`xrh-q-${uuid()}`;
  let client:InstanceType<typeof XiaodouClient>;
  try { client=configuredXiaodouClient(env); }
  catch(error) {
    if(error instanceof ApiFailure&&error.code==="PAYMENT_UNAVAILABLE")throw new RefreshDiagnosticFailure("PROVIDER_CONFIG_ERROR","provider_config",requestId,503,"支付配置暂时无法用于查单。");
    throw error;
  }
  if(transaction.merchant_provider==='xiaodou'&&transaction.merchant_account&&transaction.merchant_account!==env.XIAODOU_APP_ID)
    throw new ApiFailure(409,'PAYMENT_MERCHANT_MISMATCH','原订单的小豆商户配置已变化，请联系客服核对。');
  let result:Awaited<ReturnType<typeof client.queryPayment>>;
  try { result=await client.queryPayment(transaction.provider_trade_id!,{requestId}); }
  catch(error) { throw refreshProviderFailure(error,requestId); }
  try {
    if(result.outTradeNo!==transaction.provider_trade_id||result.currency!=="CNY"||!Number.isSafeInteger(result.amountFen)||result.amountFen!==transaction.amount_fen)throw new ApiFailure(409,"PAYMENT_MISMATCH","查询结果与订单不匹配。");
    const projection=await recordProviderFeeProjection(env,transaction,result.feeProjection);
    const state=mapProviderStatus(result.status);
    if(state==="paid"){
      // A stable synthetic event ID makes repeated trusted queries idempotent
      // without changing the provider's webhook event IDs or state ordering.
      const applied=await applyPaymentEvent(env,transaction,{eventId:`xrh-query-${transaction.id}`,eventType:"PAYMENT_SUCCEEDED",amountFen:Number(result.amountFen),currency:"CNY"});
      return response({ok:true,orderStatus:applied.status,providerFeeProjectionStatus:projection.status,quota:applied.quota},200,env,request);
    }
    const orderStatus=state==="closed"?"expired":state==="failed"?"failed":"awaiting_payment",now=nowMs();
    await env.DB.batch([
      env.DB.prepare("UPDATE payment_transactions SET status=?,updated_at=? WHERE id=? AND status NOT IN ('paid','refunded')").bind(state,now,transaction.id),
      env.DB.prepare("UPDATE recharge_orders SET status=? WHERE id=? AND credited_at IS NULL AND status IN ('pending','awaiting_payment','failed','expired') AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status=?)").bind(orderStatus,transaction.order_id,transaction.id,state),
    ]);
    return response({ok:true,orderStatus:state,providerFeeProjectionStatus:projection.status,quota:await balance(env,session.user_id)},200,env,request);
  } catch(error) {
    if(error instanceof ApiFailure)throw error;
    throw new RefreshDiagnosticFailure("ORDER_RECONCILIATION_ERROR","order_reconciliation",requestId,503,"查单结果已收到，但本地订单状态同步失败；请稍后刷新，勿重复下单。",200);
  }
}
export async function relaunchPayment(request:Request,env:Env,orderId:string):Promise<Response>{
  const session=await webSession(request,env,true),transaction=await paymentTransactionForOwner(env,orderId,session.user_id);
  if(transaction.merchant_provider==="mk99")throw new ApiFailure(409,"ORDER_NOT_PAYABLE","请使用原付款链接，MK99不支持自动重新建单。");
  if(transaction.payment_protocol==="epay"){
    if(!await checkoutAllowedFor(env,transaction)||transaction.provider!=="xiaodou"||transaction.status!=="pending"||transaction.order_status!=="awaiting_payment")throw new ApiFailure(409,"ORDER_NOT_PAYABLE","当前订单不能恢复付款表单。");
    let form:ReturnType<typeof epayCheckout>;
    try{
      const config=epayConfig(env);
      if(config.pid!==transaction.epay_pid)throw new Error("Merchant changed");
      form=epayCheckout(config,{orderId,outTradeNo:transaction.provider_trade_id!,amountFen:transaction.amount_fen,name:`x-Reply-Helper ${transaction.order_credits}次`});
    }catch{throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","原订单的易支付配置暂时不可用。");}
    return response({ok:true,orderStatus:"pending",paymentProtocol:"epay",paymentForm:form},200,env,request);
  }
  if(transaction.provider!=="xiaodou"||transaction.payment_protocol!=="rsa2"||
     !await checkoutAllowedFor(env,transaction)||
     !["pending","unknown"].includes(transaction.status)||
     transaction.order_status!=="awaiting_payment"||transaction.risk_state!=="clear"||
     transaction.credited_at!=null)
    throw new ApiFailure(409,"ORDER_NOT_PAYABLE","当前订单不能重新拉起支付。");
  const client=paymentClient(env);
  // Copy the signed-query prerequisite from subscription relaunch. A new
  // payment attempt never relies on the browser or a stale local status.
  const queryRequestId=`xrh-q-${uuid()}`;
  let live:Awaited<ReturnType<typeof client.queryPayment>>;
  try{live=await client.queryPayment(transaction.provider_trade_id!,{requestId:queryRequestId});}
  catch(error){throw refreshProviderFailure(error,queryRequestId);}
  if(live.outTradeNo!==transaction.provider_trade_id||
     live.amountFen!==transaction.amount_fen||live.currency!=="CNY"||
     live.channel!==transaction.payment_channel)
    throw new ApiFailure(409,"PAYMENT_MISMATCH","平台查单结果与原订单不匹配，禁止生成新二维码。");
  if(!["CREATED","PAYING"].includes(live.status)||live.unknown===true)
    throw new ApiFailure(409,"PAYMENT_STATUS_UNCONFIRMED","原订单可能已支付或状态不明，请先查验付款状态，勿重复付款。");
  // If creation previously timed out, the platform must explicitly tell us
  // there is NO usable attempt before we allow recovery from UNKNOWN.
  if(transaction.status==="unknown"&&live.nextAction!=="CREATE_ATTEMPT")
    throw new ApiFailure(409,"PAYMENT_ATTEMPT_UNCONFIRMED","平台未确认可重拉起原订单，请勿重复付款。");
  const next=await env.DB.prepare("SELECT COALESCE(max(attempt_number),0)+1 n FROM payment_attempts WHERE transaction_id=?").bind(transaction.id).first<{n:number}>(),attempt=Number(next?.n||1),now=nowMs(),attemptId=uuid(),requestId=`xrh-a-${uuid()}`;
  const reserved=await env.DB.prepare("INSERT INTO payment_attempts(id,transaction_id,attempt_number,provider_request_id,state,created_at,updated_at) SELECT ?,?,?,?,'prepared',?,? WHERE NOT EXISTS(SELECT 1 FROM payment_attempts WHERE transaction_id=? AND state='prepared') AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status IN ('pending','unknown') AND risk_state='clear') ON CONFLICT(transaction_id,attempt_number) DO NOTHING").bind(attemptId,transaction.id,attempt,requestId,now,now,transaction.id,transaction.id).run();
  if(reserved.meta.changes!==1)throw new ApiFailure(409,"PAYMENT_ATTEMPT_IN_PROGRESS","已有支付尝试正在处理，请勿重复提交。");
  let checkout:CheckoutResult,providerError:unknown;
  try {
    const result=await client.relaunchPayment(transaction.provider_trade_id!,{requestId});
    checkout=inspectCheckoutResponse(result,{outTradeNo:transaction.provider_trade_id!,amountFen:transaction.amount_fen});
    // Merchant settlement audit is not a condition for exposing a properly
    // signed original-order cashier at the exact agreed buyer total.
    await recordProviderFeeProjection(env,transaction,result.feeProjection);
  }catch(error){providerError=error;checkout=classifyCheckoutFailure(error);}
  try {await persistCheckout(env,transaction.id,attemptId,checkout);}catch{checkout={outcome:"unknown",issue:"CHECKOUT_PERSISTENCE_UNCONFIRMED",paymentUrl:null,paymentStatus:"unknown"};}
  const current=await transactionForOrder(env,orderId),settled=current&&["paid","refunded","closed","failed"].includes(current.status);
  const diagnostic=providerError&&env.ENVIRONMENT==="staging"?refreshProviderFailure(providerError,requestId):null;
  return response({ok:checkout.outcome==="ready",orderStatus:settled?current.status:checkout.paymentStatus,checkout:{outcome:checkout.outcome,issue:checkout.issue},paymentUrl:!settled&&checkout.outcome==="ready"?checkout.paymentUrl:null,requestId,
    ...(checkout.outcome!=="ready"?{code:"PAYMENT_CHECKOUT_UNAVAILABLE",message:"付款链接未生成，请保留订单核对，不要重复发起支付尝试。"}:{}),
    ...(diagnostic?{diagnostic:{stage:diagnostic.stage,upstreamHttpStatus:diagnostic.upstreamHttpStatus,...(diagnostic.providerResponse?{providerResponse:diagnostic.providerResponse}:{})}}:{})},checkoutHttpStatus(checkout),env,request);
}


/**
 * User-initiated, provider-confirmed cancellation of an unpaid Xiaodou order.
 * Xiaodou's signed close endpoint verifies at the institution that the
 * transaction has NOT succeeded; never infer nonpayment from age or 502.
 */
export async function cancelUnpaidXiaodouOrder(request:Request,env:Env,orderId:string):Promise<Response>{
 const session=await webSession(request,env,true);
 const transaction=await paymentTransactionForOwner(env,orderId,session.user_id);
 if(transaction.merchant_provider!=="xiaodou"||transaction.provider!=="xiaodou"||transaction.payment_protocol!=="rsa2"||
    !["pending","unknown"].includes(transaction.status)||transaction.order_status!=="awaiting_payment"||
    transaction.risk_state!=="clear"||transaction.credited_at!=null||!transaction.provider_trade_id||
    transaction.merchant_account!==env.XIAODOU_APP_ID||transaction.notification_sign_type!==env.XIAODOU_KEY_ID)
   throw new ApiFailure(409,"ORDER_NOT_CLOSABLE","原订单无法安全关闭，请先查验或联系支持。");
 const requestId="xrh-close-"+uuid();
 let result:Awaited<ReturnType<InstanceType<typeof XiaodouClient>["closePayment"]>>;
 try{result=await configuredXiaodouClient(env).closePayment(transaction.provider_trade_id,{requestId});}
 catch(error){throw refreshProviderFailure(error,requestId);}
 if(result.outTradeNo!==transaction.provider_trade_id||result.amountFen!==transaction.amount_fen||
    result.currency!=="CNY"||result.channel!==transaction.payment_channel)
   throw new ApiFailure(409,"PAYMENT_MISMATCH","平台关单结果与原订单不符，原订单保持不变。");
 if(!["CLOSE_REQUESTED","ALREADY_CLOSED"].includes(result.closeState)||result.status!=="CLOSED")
   // UNKNOWN_KEPT / PROVIDER_PAID_CONFLICT / SUCCEEDED are NOT canceled.
   throw new ApiFailure(409,"PAYMENT_CLOSE_UNCONFIRMED","平台未确认安全关闭原订单，请查验支付状态。");
 const applied=await applyPaymentEvent(env,transaction,{eventId:"xrh-closed-"+transaction.id,eventType:"PAYMENT_CLOSED",amountFen:0,currency:"CNY"});
 if(applied.status!=="closed")throw new ApiFailure(409,"PAYMENT_CLOSE_UNCONFIRMED","订单状态已变化，请先查验是否已经付款。");
 return response({ok:true,orderStatus:"closed",quota:applied.quota},200,env,request);
}

export async function xiaodouWebhook(request:Request,env:Env):Promise<Response>{
  if(!xiaodouWebhookIsEnabled(env))localOnlyError();
  let bytes:Uint8Array;try{bytes=await readLimitedBytes(request.body,64*1024);}catch(error){if(error instanceof PayloadTooLargeError)throw new ApiFailure(413,"PAYMENT_EVENT_TOO_LARGE","支付事件过大。");throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","支付事件格式无效。");}
  const client=configuredXiaodouClient(env);
  let verified:Awaited<ReturnType<InstanceType<typeof XiaodouClient>["verifyWebhook"]>>;
  try { verified=await client.verifyWebhook(request.headers,bytes); }
  catch(error) {
    if(error instanceof XiaodouProviderError&&error.status===401)throw new ApiFailure(401,error.code,"支付通知签名无效或已过期。");
    throw error;
  }
  let event:Record<string,unknown>;try{event=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as Record<string,unknown>;}catch{throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","支付事件格式无效。");}
  if(event.eventId!==verified.eventId||event.eventType!==verified.eventType||event.appId!==env.XIAODOU_APP_ID)throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","支付事件格式无效。");
  const type=String(event.eventType);
  if(!webhookEventMatchesStatus(event))throw new ApiFailure(409,"PAYMENT_EVENT_STATUS_MISMATCH","支付事件类型、状态或金额格式不匹配。");
  if(event.currency!==undefined&&event.currency!=="CNY")throw new ApiFailure(409,"PAYMENT_MISMATCH","支付金额或币种与订单不符。");
  const outTradeNo=String(event.outTradeNo??"");
  if(type.startsWith("PAYMENT_")){
    const transaction=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.provider='xiaodou' AND t.merchant_provider='xiaodou' AND t.provider_trade_id=?").bind(outTradeNo).first<PaymentTransaction>();
    if(!transaction){
      // The vendor application-level notify URL is shared by credit packages
      // and subscriptions. A signed callback for a subscription is only a
      // trigger for a second, separately authenticated provider status query.
      // No browser-supplied or webhook-only data can grant a subscription.
      const subscription=await env.DB.prepare("SELECT t.order_id,t.amount_fen,t.payment_channel,t.merchant_account FROM subscription_payment_transactions t WHERE t.merchant_provider='xiaodou' AND t.provider_trade_id=?").bind(outTradeNo).first<{order_id:string;amount_fen:number;payment_channel:string;merchant_account:string}>();
      if(!subscription)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
      if(subscription.merchant_account!==env.XIAODOU_APP_ID||subscription.payment_channel!=='ALIPAY_H5'||
        event.grossAmountFen!==subscription.amount_fen||(type==='PAYMENT_SUCCEEDED'&&event.eventAmountFen!==subscription.amount_fen)||
        (type!=='PAYMENT_SUCCEEDED'&&event.eventAmountFen!==0))
        throw new ApiFailure(409,"PAYMENT_MISMATCH","小豆订阅通知金额或身份不一致。");
      const order=await orderById(env,subscription.order_id);
      if(!order||order.merchant_provider!=='xiaodou')throw new ApiFailure(404,"ORDER_NOT_FOUND","订阅订单不存在。");
      const confirmed=await querySubscriptionPayment(env,order);
      if(type==='PAYMENT_SUCCEEDED'&&!confirmed.paymentConfirmed)throw new ApiFailure(502,"SUBSCRIPTION_PAYMENT_UNCONFIRMED","小豆付款仍待签名查单确认。");
      return new Response("success",{status:200,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
    }
    if(transaction.merchant_provider==="mk99"||transaction.payment_protocol==="epay")throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
    if(transaction.merchant_account&&transaction.merchant_account!==env.XIAODOU_APP_ID)throw new ApiFailure(409,'PAYMENT_MERCHANT_MISMATCH','原始订单商户身份不匹配。');
    const amount=event.eventAmountFen as number,gross=event.grossAmountFen;
    if(!Number.isSafeInteger(gross)||gross!==transaction.amount_fen||(type==="PAYMENT_SUCCEEDED"&&amount!==transaction.amount_fen)||(type!=="PAYMENT_SUCCEEDED"&&amount!==0))throw new ApiFailure(409,"PAYMENT_MISMATCH","支付事件金额不匹配。");
    await recordProviderFeeProjection(env,transaction,event.feeProjection);
    await applyPaymentEvent(env,transaction,{eventId:verified.eventId,eventType:type,amountFen:amount,currency:String(event.currency??"CNY"),bodySha256:verified.bodySha256});
  }else{
    const refundNo=String(event.outRefundNo??""),refund=await env.DB.prepare("SELECT r.* FROM payment_refunds r JOIN payment_transactions t ON t.id=r.transaction_id WHERE t.provider='xiaodou' AND r.out_refund_no=?").bind(refundNo).first<Record<string,unknown>>();
    if(!refund)throw new ApiFailure(404,"REFUND_NOT_FOUND","退款记录不存在。");
    const transaction=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.id=?").bind(refund.transaction_id).first<PaymentTransaction>();
    if(!transaction||transaction.merchant_provider==="mk99"||transaction.payment_protocol==="epay")throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
    if(!refundEventMatchesTransaction(event,refund,transaction))throw new ApiFailure(409,"REFUND_MISMATCH","退款事件与原订单或退款记录不符。");
    await applyRefundEvent(env,transaction,refund,{eventId:verified.eventId,eventType:type,amountFen:event.eventAmountFen as number,currency:"CNY",bodySha256:verified.bodySha256});
  }
  return new Response("success",{status:200,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
}

export async function epayNotify(request:Request,env:Env):Promise<Response>{
  if(env.XIAODOU_WEBHOOKS_ENABLED!=="1"||env.PAYMENT_PROVIDER==="mock")throw new ApiFailure(404,"NOT_FOUND","接口不存在。");
  if(!env.XIAODOU_EPAY_PID||!env.XIAODOU_EPAY_KEY)throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付通知暂时无法验证。");
  let parameters:Record<string,string>;
  try{parameters=parseEpayParameters(new URL(request.url).search.slice(1));}
  catch{throw new ApiFailure(400,"INVALID_PAYMENT_NOTIFY","支付通知格式无效。");}
  if(!verifyEpay(parameters,env.XIAODOU_EPAY_KEY))throw new ApiFailure(401,"INVALID_PAYMENT_SIGNATURE","支付通知签名无效。");
  if(parameters.pid!==env.XIAODOU_EPAY_PID||(parameters.type!==undefined&&parameters.type!=="alipay")||parameters.trade_status!=="TRADE_SUCCESS"||(parameters.currency!==undefined&&parameters.currency!=="CNY"))throw new ApiFailure(409,"PAYMENT_MISMATCH","支付通知与订单不符。");
  if(!/^[A-Za-z0-9_-]{6,64}$/.test(parameters.out_trade_no??"")||!/^[A-Za-z0-9_-]{1,128}$/.test(parameters.trade_no??""))throw new ApiFailure(400,"INVALID_PAYMENT_NOTIFY","支付通知订单标识无效。");
  let amountFen:number;
  try{amountFen=moneyToFen(parameters.money);}catch{throw new ApiFailure(400,"INVALID_PAYMENT_NOTIFY","支付通知金额无效。");}
  const transaction=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.provider='xiaodou' AND t.merchant_provider='xiaodou' AND t.payment_protocol='epay' AND t.provider_trade_id=?").bind(parameters.out_trade_no).first<PaymentTransaction>();
  if(!transaction)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
  if(transaction.epay_pid!==parameters.pid||transaction.currency!=="CNY"||transaction.amount_fen!==amountFen||(transaction.epay_trade_no&&transaction.epay_trade_no!==parameters.trade_no))throw new ApiFailure(409,"PAYMENT_MISMATCH","支付通知与订单不符。");
  await applyPaymentEvent(env,transaction,{eventId:`epay-paid:${parameters.out_trade_no}`,eventType:"PAYMENT_SUCCEEDED",amountFen,currency:"CNY",epayTradeNo:parameters.trade_no});
  return new Response("success",{status:200,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
}

async function submitRefund(request:Request,env:Env,transaction:PaymentTransaction,spec:{kind:"ordinary"|"special";principal:number;fee:number;credits:number;reason:string;reasonCategory:string;actorId:string|null;confirmed:boolean}):Promise<Response>{
  if(transaction.merchant_provider==="mk99")throw new ApiFailure(409,"REFUND_MANUAL_REVIEW_REQUIRED","MK99退款需要独立可信核对，当前不调用退款或调整额度。");
  if(transaction.payment_protocol==="epay")throw new ApiFailure(409,"REFUND_MANUAL_REVIEW_REQUIRED","易支付退款需人工核对并通过商户后台处理，当前接口不会冻结或扣减额度。");
  if(!spec.confirmed||!Number.isSafeInteger(spec.principal)||spec.principal<0||!Number.isSafeInteger(spec.fee)||spec.fee<0||!Number.isSafeInteger(spec.credits)||spec.credits<0||spec.principal+spec.fee<1||spec.reason.length<4||spec.reason.length>256)throw new ApiFailure(400,"INVALID_REFUND","退款需要有效金额、原因和二次确认。");
  if(transaction.order_status!=="paid"||transaction.status!=="paid"||!transaction.credited_at)throw new ApiFailure(409,"ORDER_NOT_REFUNDABLE","只有已支付到账订单才能申请退款。");
  if(transaction.provider==="xiaodou"&&!realPaymentsEnabled(env))throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付暂未开放。");
  if(transaction.provider==="local_mock"&&!isLocalMock(env,request))localOnlyError();
  const principal=Number(transaction.base_amount_fen??transaction.amount_fen),fee=Number(transaction.service_fee_fen??0);
  const outstanding=await env.DB.prepare("SELECT COALESCE(sum(CASE WHEN status='succeeded' THEN base_amount_fen ELSE 0 END),0) principal_done,COALESCE(sum(CASE WHEN status IN ('requested','pending','unknown') THEN base_amount_fen ELSE 0 END),0) principal_pending,COALESCE(sum(CASE WHEN status='succeeded' THEN service_fee_amount_fen ELSE 0 END),0) fee_done,COALESCE(sum(CASE WHEN status IN ('requested','pending','unknown') THEN service_fee_amount_fen ELSE 0 END),0) fee_pending FROM payment_refunds WHERE transaction_id=?").bind(transaction.id).first<{principal_done:number;principal_pending:number;fee_done:number;fee_pending:number}>();
  if(spec.principal>principal-(outstanding?.principal_done??0)-(outstanding?.principal_pending??0)||spec.fee>fee-(outstanding?.fee_done??0)-(outstanding?.fee_pending??0))throw new ApiFailure(409,"REFUND_LIMIT_EXCEEDED","累计退款金额不能超过订单尚未退款的对应金额。");
  const lot=await env.DB.prepare("SELECT * FROM credit_batches WHERE source_order_id=? AND user_id=? AND source_kind='purchase'").bind(transaction.order_id,transaction.order_user_id).first<Record<string,unknown>>();
  if(spec.kind==="ordinary"){
    if(spec.principal!==principal||spec.fee!==0||spec.credits!==Number(transaction.order_credits)||!lot||lot.history_confidence!=="tracked"||lot.status!=="active"||Number(lot.consumed_credits)!==0||Number(lot.remaining_credits)!==Number(lot.grant_credits)||Number(lot.generation_reserved_credits)!==0||Number(lot.refund_reserved_credits)!==0)throw new ApiFailure(409,"ORDINARY_REFUND_NOT_ELIGIBLE","该次数包已使用、正在处理或无法确认，不能申请普通退款。");
    const previous=await env.DB.prepare("SELECT count(*) n FROM payment_refunds WHERE credit_batch_id=? AND status IN ('requested','pending','unknown','succeeded')").bind(lot.id).first<{n:number}>();
    if(Number(previous?.n)>0)throw new ApiFailure(409,"ORDINARY_REFUND_NOT_ELIGIBLE","该订单已有退款记录，不能重复申请普通退款。");
  }
  if(spec.credits>0&&(!lot||Number(lot.remaining_credits)-Number(lot.generation_reserved_credits)-Number(lot.refund_reserved_credits)<spec.credits))throw new ApiFailure(409,"REFUND_CREDIT_RESERVATION_FAILED","该订单可冻结的未使用额度不足。");
  const amountFen=spec.principal+spec.fee,now=nowMs(),refundId=uuid(),outRefundNo=`XRH_R_${refundId.replaceAll("-","")}`;
  const statements=[
    env.DB.prepare(`INSERT INTO payment_refunds(id,transaction_id,out_refund_no,amount_fen,status,reason,credits_reserved,base_amount_fen,service_fee_amount_fen,refund_kind,credits_to_revoke,actor_user_id,reviewer_user_id,reason_category,credit_adjustment_confirmed,credit_batch_id,created_at,updated_at)
      SELECT ?,?,?,?,'requested',?,?,?,?,?,?,?, ?,?,?,?, ?,?
      WHERE EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status='paid')
        AND ?<=(SELECT t.base_amount_fen-COALESCE((SELECT sum(r.base_amount_fen) FROM payment_refunds r WHERE r.transaction_id=t.id AND r.status IN ('requested','pending','unknown','succeeded')),0) FROM payment_transactions t WHERE t.id=?)
        AND ?<=(SELECT t.service_fee_fen-COALESCE((SELECT sum(r.service_fee_amount_fen) FROM payment_refunds r WHERE r.transaction_id=t.id AND r.status IN ('requested','pending','unknown','succeeded')),0) FROM payment_transactions t WHERE t.id=?)`).bind(refundId,transaction.id,outRefundNo,amountFen,spec.reason,spec.credits,spec.principal,spec.fee,spec.kind,spec.credits,spec.actorId,spec.kind==="special"?spec.actorId:null,spec.reasonCategory,spec.kind==="special"?1:0,lot?.id??null,now,now,transaction.id,spec.principal,transaction.id,spec.fee,transaction.id),
    env.DB.prepare("UPDATE credit_batches SET refund_reserved_credits=refund_reserved_credits+?,status='refund_pending' WHERE id=? AND status='active' AND remaining_credits-generation_reserved_credits-refund_reserved_credits>=? AND EXISTS(SELECT 1 FROM payment_refunds WHERE id=? AND status='requested') AND ?>0").bind(spec.credits,lot?.id??null,spec.credits,refundId,spec.credits),
    env.DB.prepare("UPDATE credit_accounts SET paid_reserved_for_refunds=paid_reserved_for_refunds+?,version=version+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM payment_refunds WHERE id=? AND status='requested') AND ?>0").bind(spec.credits,now,transaction.order_user_id,refundId,spec.credits),
    env.DB.prepare(`INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,before_json,after_json,created_at)
      SELECT ?,?, 'special_refund_requested',?,?,?,?,? WHERE ?='special' AND EXISTS(SELECT 1 FROM payment_refunds WHERE id=? AND status='requested')`).bind(uuid(),spec.actorId,refundId,spec.reason,JSON.stringify({status:transaction.status,principalRemainingFen:principal-(outstanding?.principal_done??0)-(outstanding?.principal_pending??0),serviceFeeRemainingFen:fee-(outstanding?.fee_done??0)-(outstanding?.fee_pending??0),sourceLotRemaining:lot?Number(lot.remaining_credits):null}),JSON.stringify({refundKind:spec.kind,baseAmountFen:spec.principal,serviceFeeAmountFen:spec.fee,totalAmountFen:amountFen,feeRateBps:transaction.fee_rate_bps??0,creditsToRevoke:spec.credits,creditBatchId:lot?.id??null,reasonCategory:spec.reasonCategory}),now,spec.kind,refundId),
    env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM payment_refunds r WHERE r.id=? AND r.status='requested' AND r.amount_fen=r.base_amount_fen+r.service_fee_amount_fen AND ((r.credits_to_revoke=0) OR EXISTS(SELECT 1 FROM credit_batches b WHERE b.id=r.credit_batch_id AND b.refund_reserved_credits>=r.credits_to_revoke AND b.status='refund_pending')) AND EXISTS(SELECT 1 FROM credit_accounts a WHERE a.user_id=? AND a.paid_reserved_for_refunds=(SELECT COALESCE(sum(refund_reserved_credits),0) FROM credit_batches WHERE user_id=? AND bucket='paid')) AND (r.refund_kind<>'special' OR EXISTS(SELECT 1 FROM admin_audit_logs WHERE target_id=r.id AND action='special_refund_requested'))) THEN 1 ELSE 0 END`).bind(refundId,refundId,transaction.order_user_id,transaction.order_user_id),
    env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(refundId),
  ];
  try{await env.DB.batch(statements);}catch{
    const latest=await env.DB.prepare("SELECT t.base_amount_fen-COALESCE(sum(CASE WHEN r.status IN ('requested','pending','unknown','succeeded') THEN r.base_amount_fen ELSE 0 END),0) principal_left,t.service_fee_fen-COALESCE(sum(CASE WHEN r.status IN ('requested','pending','unknown','succeeded') THEN r.service_fee_amount_fen ELSE 0 END),0) fee_left FROM payment_transactions t LEFT JOIN payment_refunds r ON r.transaction_id=t.id WHERE t.id=? GROUP BY t.id").bind(transaction.id).first<{principal_left:number;fee_left:number}>();
    if(latest&&(spec.principal>latest.principal_left||spec.fee>latest.fee_left))throw new ApiFailure(409,"REFUND_LIMIT_EXCEEDED","累计退款金额不能超过订单尚未退款的对应金额。");
    throw new ApiFailure(409,"REFUND_CREDIT_RESERVATION_FAILED","退款或额度冻结状态已变化，请刷新订单后重试。");
  }
  if(transaction.provider==="local_mock")return response({ok:true,refund:{id:refundId,outRefundNo,amountFen,principalRefundFen:spec.principal,serviceFeeRefundFen:spec.fee,creditsToRevoke:spec.credits,status:"pending"},message:"本地模拟退款已建立，尚未改变余额。"},201,env,request);
  try{
    const result=await paymentClient(env).createRefund({outTradeNo:transaction.provider_trade_id!,outRefundNo,refundAmountFen:amountFen,reason:spec.reason},{requestId:`xrh-r-${refundId}`});
    const state=String(result.status??"PENDING").toLowerCase();
    await env.DB.prepare("UPDATE payment_refunds SET status=?,updated_at=? WHERE id=? AND status='requested'").bind(state==="unknown"?"unknown":"pending",nowMs(),refundId).run();
  }catch{await env.DB.prepare("UPDATE payment_refunds SET status='unknown',updated_at=? WHERE id=? AND status='requested'").bind(nowMs(),refundId).run();}
  const current=await env.DB.prepare("SELECT id,out_refund_no,amount_fen,base_amount_fen,service_fee_amount_fen,credits_to_revoke,status FROM payment_refunds WHERE id=?").bind(refundId).first();
  return response({ok:true,refund:current},201,env,request);
}

export async function requestUserRefund(request:Request,env:Env,orderId:string):Promise<Response>{
  const session=await webSession(request,env,true),transaction=await paymentTransactionForOwner(env,orderId,session.user_id),body=await jsonBody(request,1024);
  if(body.confirm!==true)throw new ApiFailure(400,"INVALID_REFUND","请确认普通退款规则后再提交。");
  return submitRefund(request,env,transaction,{kind:"ordinary",principal:Number(transaction.base_amount_fen??transaction.amount_fen),fee:0,credits:Number(transaction.order_credits),reason:"用户申请未使用次数包退款",reasonCategory:"customer_request",actorId:session.user_id,confirmed:true});
}

export async function requestRefund(request:Request,env:Env,orderId:string):Promise<Response>{
  const actor=await requireAdminSession(request,env,true),body=await jsonBody(request,2048),transaction=await transactionForOrder(env,orderId);
  if(!transaction)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
  const principal=Number(body.baseAmountFen),fee=Number(body.serviceFeeAmountFen),credits=Number(body.creditsToRevoke),reason=typeof body.reason==="string"?body.reason.trim():"",reasonCategory=typeof body.reasonCategory==="string"?body.reasonCategory:"merchant_or_legal";
  const lot=await env.DB.prepare("SELECT remaining_credits,generation_reserved_credits,refund_reserved_credits FROM credit_batches WHERE source_order_id=?").bind(orderId).first<{remaining_credits:number;generation_reserved_credits:number;refund_reserved_credits:number}>();
  if(body.confirm!==true||(!lot&&credits!==0)||!Number.isSafeInteger(credits)||credits<0||(lot&&credits>lot.remaining_credits-lot.generation_reserved_credits-lot.refund_reserved_credits)||!Number.isSafeInteger(principal)||!Number.isSafeInteger(fee)||body.creditAdjustmentConfirmed!==true)throw new ApiFailure(400,"INVALID_SPECIAL_REFUND","特殊退款需明确确认退款金额和该订单的额度回收数量。");
  return submitRefund(request,env,transaction,{kind:"special",principal,fee,credits,reason,reasonCategory,actorId:actor.user_id,confirmed:true});
}
export async function simulateRefund(request:Request,env:Env,outRefundNo:string):Promise<Response>{
  if(!isLocalMock(env,request))localOnlyError();
  await requireAdminSession(request,env,true);
  const body=await jsonBody(request,1024),eventId=cleanId(body.eventId,/^[A-Za-z0-9_-]{8,80}$/),eventType=body.eventType??"REFUND_SUCCEEDED";
  if(eventType!=="REFUND_SUCCEEDED"&&eventType!=="REFUND_FAILED")throw new ApiFailure(400,"INVALID_REFUND_EVENT","模拟退款状态无效。");
  const refund=await env.DB.prepare("SELECT r.* FROM payment_refunds r WHERE r.out_refund_no=?").bind(outRefundNo).first<Record<string,unknown>>();
  if(!refund)throw new ApiFailure(404,"REFUND_NOT_FOUND","退款记录不存在。");
  const transaction=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.id=?").bind(refund.transaction_id).first<PaymentTransaction>();
  if(!transaction||transaction.provider!=="local_mock")localOnlyError();
  const simulatedEvent={outRefundNo:body.outRefundNo??refund.out_refund_no,outTradeNo:body.outTradeNo??transaction.provider_trade_id,grossAmountFen:body.grossAmountFen??transaction.amount_fen,eventAmountFen:body.eventAmountFen??refund.amount_fen};
  if(!refundEventMatchesTransaction(simulatedEvent,refund,transaction))throw new ApiFailure(409,"REFUND_MISMATCH","退款事件与原订单或退款记录不符。");
  const result=await applyRefundEvent(env,transaction,refund,{eventId,eventType:String(eventType),amountFen:Number(simulatedEvent.eventAmountFen),currency:"CNY"});
  return response({ok:true,alreadyProcessed:result.duplicate,refundStatus:result.status,quota:result.quota},200,env,request);
}
