import type {Env} from './types';
import {ApiFailure} from './types';
import {uuid,nowMs} from './security';
import {orderById,querySubscriptionPayment} from './subscription-settlement';
import {validateFeeProjection} from './xiaodou.js';

/** Called only AFTER XD-Webhook-v1 verification against the raw body bytes.
 * All product entitlement changes still demand a second signed provider QUERY.
 * The historical credit-pack and MK99 subscription ledgers are never touched.
 */
export async function settleXiaodouSubscriptionWebhook(
 env:Env,outTradeNo:string,
 event:Record<string,unknown>,verified:{eventId:string;eventType:string;bodySha256:string}
):Promise<void>{
 const row=await env.DB.prepare(`SELECT o.id FROM subscription_orders o
  JOIN subscription_payment_transactions t ON t.order_id=o.id
  WHERE t.merchant_provider='xiaodou' AND t.provider_trade_id=?`).bind(outTradeNo).first<{id:string}>();
 if(!row)throw new ApiFailure(404,'ORDER_NOT_FOUND','小豆订阅订单不存在。');
 const order=await orderById(env,row.id);
 if(!order||order.merchant_provider!=='xiaodou'||order.merchant_account!==env.XIAODOU_APP_ID||
   order.notification_sign_type!=='RSA-SHA256'||order.provider_trade_id!==outTradeNo)
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','小豆回调的订阅订单身份不匹配。');
 if(event.grossAmountFen!==order.amount_fen||!Number.isSafeInteger(event.eventAmountFen)||
   (event.currency!==undefined&&event.currency!=='CNY'))
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','小豆回调金额、币种不一致。');
 if(event.feeProjection!==undefined&&!validateFeeProjection(event.feeProjection,order.amount_fen))
   throw new ApiFailure(409,'SUBSCRIPTION_FEE_PROJECTION_UNCONFIRMED','小豆事件中的结算投影无效。');
 const type=verified.eventType;
 if(type==='PAYMENT_SUCCEEDED'){
   if(event.eventAmountFen!==order.amount_fen)
     throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','小豆付款金额不一致。');
   const proof=await querySubscriptionPayment(env,order);
   if(!proof.paymentConfirmed)
     throw new ApiFailure(503,'SUBSCRIPTION_PAYMENT_UNCONFIRMED','小豆付款事件已验证，但平台查单尚未确认。');
 }else if(type==='PAYMENT_FAILED'||type==='PAYMENT_CLOSED'){
   // Provider docs: CLOSED/FAILED may later be upgraded to SUCCEEDED.
   // Keep the order recoverable; never absorb a later verified paid fact.
   if(event.eventAmountFen!==0)throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','非付款事件携带非零金额。');
 }else if(type==='REFUND_SUCCEEDED'||type==='REFUND_FAILED'){
   if(typeof event.outRefundNo!=='string'||!event.outRefundNo||
     typeof event.eventAmountFen!=='number'||event.eventAmountFen<1||event.eventAmountFen>order.amount_fen)
     throw new ApiFailure(409,'SUBSCRIPTION_REFUND_MISMATCH','订阅退款事件身份或金额异常。');
 }else throw new ApiFailure(400,'INVALID_PAYMENT_EVENT','订阅事件类型无效。');
 const claim=uuid(),time=nowMs();
 const statements=[
   env.DB.prepare(`INSERT INTO subscription_payment_events
    (id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at)
    SELECT ?,id,'xiaodou',?,?,?,?,? FROM subscription_payment_transactions
    WHERE id=? AND merchant_provider='xiaodou' AND provider_trade_id=?
    ON CONFLICT(merchant_provider,provider_event_id) DO NOTHING`)
    .bind(claim,verified.eventId,type,event.eventAmountFen,verified.bodySha256,time,order.transaction_id,outTradeNo),
 ];
 if(type==='REFUND_SUCCEEDED'){
   // Freeze entitlements for review. Neither a partial nor a full refund
   // may be silently translated into new credits or automatic period resets.
   statements.push(
    env.DB.prepare(`UPDATE subscription_payment_transactions SET risk_state='frozen',updated_at=?
       WHERE id=? AND merchant_provider='xiaodou' AND EXISTS(SELECT 1 FROM subscription_payment_events WHERE id=?)`)
      .bind(time,order.transaction_id,claim),
    env.DB.prepare(`UPDATE subscription_orders SET status='refund_pending',updated_at=?
       WHERE id=? AND status IN ('pending','unknown','paid') AND EXISTS(SELECT 1 FROM subscription_payment_events WHERE id=?)`)
      .bind(time,order.id,claim),
    env.DB.prepare(`UPDATE subscription_periods SET status='refund_pending',updated_at=?
       WHERE user_id=? AND status='active' AND (source_order_id=? OR EXISTS(
       SELECT 1 FROM subscription_tier_changes c WHERE c.period_id=subscription_periods.id AND c.order_id=?))
       AND EXISTS(SELECT 1 FROM subscription_payment_events WHERE id=?)`)
      .bind(time,order.user_id,order.id,order.id,claim)
   );
 }
 await env.DB.batch(statements);
}
