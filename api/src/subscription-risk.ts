import type {Env} from './types';
import {ApiFailure} from './types';
import {sha256,uuid} from './security';
import type {Mk99PaymentEvent} from './mk99';

type RiskOrder={id:string;order_id:string;amount_fen:number};

// Both callers must first verify the merchant, order, channel, amount and
// platform trade number. No path here grants quota or moves permanent credits.
export async function recordSubscriptionRisk(env:Env,row:RiskOrder,event:Mk99PaymentEvent,now:number){
 const reason=event.tradeStatus;
 if(reason!=='TRADE_REFUND'&&reason!=='TRADE_FREEZE')return;
 if(event.refundAmountFen!==undefined&&event.refundAmountFen>row.amount_fen)
   throw new ApiFailure(409,'SUBSCRIPTION_REFUND_AMOUNT_INVALID','退款金额超出原付款。');
 const fullRefund=reason==='TRADE_REFUND'&&event.refundAmountFen===row.amount_fen;
 const evidence=await sha256(JSON.stringify([event.outTradeNo,event.tradeNo,reason,event.refundAmountFen??null]));
 const claim=uuid();
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO subscription_payment_events
    (id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at)
    SELECT ?,id,'mk99',?,?,?,?,? FROM subscription_payment_transactions
    WHERE id=? AND order_id=? AND merchant_provider='mk99' AND provider_trade_id=?
      AND (provider_payment_id IS NULL OR provider_payment_id=?)
    ON CONFLICT(merchant_provider,provider_event_id) DO NOTHING`)
   .bind(claim,'sub-risk:'+evidence,reason,event.refundAmountFen??event.amountFen,evidence,now,
     row.id,row.order_id,event.outTradeNo,event.tradeNo),
  env.DB.prepare(`UPDATE subscription_payment_transactions SET risk_state='frozen',
     status=CASE WHEN ? THEN 'refunded' ELSE status END,updated_at=?
   WHERE id=? AND EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.id=?)`)
   .bind(Number(fullRefund),now,row.id,claim),
  env.DB.prepare(`UPDATE subscription_orders SET status=CASE WHEN ? THEN 'refunded' ELSE 'refund_pending' END,updated_at=?
   WHERE id=? AND status<>'refunded' AND EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.id=?)`)
   .bind(Number(fullRefund),now,row.order_id,claim),
  // Applied upgrades can have later amendments and days above their old cap.
  // Suspend the entire period for review, leaving all usage and ACKs intact.
  // Unstarted periods have null timestamps and remain queued structurally.
  // Their refunded/held order prevents activation.
  env.DB.prepare(`UPDATE subscription_periods SET status=CASE WHEN ? THEN 'revoked' ELSE 'refund_pending' END,updated_at=?
   WHERE (source_order_id=? OR id IN (SELECT period_id FROM subscription_tier_changes WHERE order_id=?))
    AND status IN ('active','refund_pending') AND EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.id=?)`)
   .bind(Number(fullRefund),now,row.order_id,row.order_id,claim)
 ]);
}
