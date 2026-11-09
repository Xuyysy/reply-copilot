import type { Env } from './types';
import { ApiFailure } from './types';
import { sessionFor, requireCsrf, takeRate } from './auth';
import { requireWebOrigin, nowMs, uuid, sha256 } from './security';
import { response } from './http';
import { Mk99Client, mk99Config, Mk99Error, type Mk99PaymentEvent } from './mk99';
import { SUBSCRIPTION_PERIOD_MS } from '../../domain/subscription-policy.js';
import { subscriptionsEnabled } from './subscription-account';

// A new payment domain: NEVER call applyPaymentEvent() for subscriptions.
// This endpoint cannot create charges, and stays OFF even if read-only
// subscription metrics are enabled. Historical order refresh may later be
// enabled independently of new sales, after a migration is approved.
const purchasesReady = (env:Env) => subscriptionsEnabled(env) && env.SUBSCRIPTION_PURCHASES_ENABLED==='1';

type Order = {
  id:string;user_id:string;kind:string;plan_version_id:string;status:string;
  amount_fen:number;price_fen:number;daily_limit:number;duration_days:number;
  transaction_id:string;merchant_provider:string;merchant_account:string|null;
  notification_sign_type:string|null;provider_trade_id:string;provider_payment_id:string|null;
  payment_status:string;risk_state:string;payment_amount_fen:number;payment_currency:string;
  payment_channel:string;
};

async function orderById(env:Env,id:string):Promise<Order|null>{
 return env.DB.prepare(`SELECT o.id,o.user_id,o.kind,o.plan_version_id,o.status,o.amount_fen,
     v.price_fen,v.daily_limit,v.duration_days,t.id transaction_id,
     t.merchant_provider,t.merchant_account,t.notification_sign_type,t.provider_trade_id,
     t.provider_payment_id,t.status payment_status,t.risk_state,t.amount_fen payment_amount_fen,
     t.currency payment_currency,t.payment_channel
   FROM subscription_orders o JOIN subscription_plan_versions v ON v.id=o.plan_version_id
   JOIN subscription_payment_transactions t ON t.order_id=o.id WHERE o.id=?`)
   .bind(id).first<Order>();
}

function validateOrder(env:Env,o:Order,event:Mk99PaymentEvent):void{
 const config=mk99Config(env);
 if(o.kind!=='purchase'&&o.kind!=='renewal')
   throw new ApiFailure(409,'SUBSCRIPTION_UPGRADE_NOT_READY','升级支付暂时不可结算。');
 if(o.status==='closed'||o.status==='refunded'||o.status==='failed'||o.status==='refund_pending'||o.status==='manual_review' ||
    !['pending','unknown','paid'].includes(o.status) ||
    !['pending','unknown','paid'].includes(o.payment_status)||o.risk_state!=='clear')
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_HELD','该订单当前不可结算，请人工核对。');
 if(o.merchant_provider!=='mk99'||o.merchant_account!==config.pid||o.notification_sign_type!==config.notifySignType||
    o.payment_currency!=='CNY'||o.payment_amount_fen!==o.amount_fen||
    o.amount_fen!==o.price_fen||o.duration_days!==30||
    !['ALIPAY_H5','WECHAT_H5'].includes(o.payment_channel)||
    o.provider_trade_id!==event.outTradeNo||
    (o.provider_payment_id!=null&&o.provider_payment_id!==event.tradeNo)||
    event.provider!=='mk99'||event.verification!=='authenticated_query'||
    event.tradeStatus!=='TRADE_SUCCESS'||event.amountFen!==o.amount_fen||
    (event.currency!==undefined&&event.currency!=='CNY')||
    (event.merchantId!==undefined&&event.merchantId!==config.pid)||
    (event.paytypeCode!==undefined&&event.paytypeCode!==(o.payment_channel==='WECHAT_H5'?'wxpay':'alipay'))||
    !/^[A-Za-z0-9_-]{1,128}$/.test(event.tradeNo))
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','支付结果与订阅订单不符。');
}

/**
 * Only called after Mk99Client.query() has returned a provider result from its
 * fixed, merchant-authenticated HTTPS endpoint. Idempotent settlement grants
 * one 30-day period, or one QUEUED period when an existing period is active.
 *
 * D1 batch is an atomic SQLite transaction; the final assertions deliberately
 * abort it if any statement becomes a no-op due to a concurrent state change.
 */
export async function reconcileVerifiedSubscriptionPurchase(env:Env,o:Order,event:Mk99PaymentEvent,now=nowMs()){
 validateOrder(env,o,event);
 const eventKey='mk99-sub-paid:'+event.tradeNo;
 const evidence=await sha256(`authenticated_mk99_query:${o.provider_trade_id}:${event.tradeNo}:${event.amountFen}:TRADE_SUCCESS`);
 const claim=uuid(),periodId=uuid();
 const proof=`EXISTS(SELECT 1 FROM subscription_payment_events e
    WHERE e.transaction_id=? AND e.merchant_provider='mk99'
      AND e.provider_event_id=? AND e.event_type='PAYMENT_SUCCEEDED'
      AND e.amount_fen=? AND e.body_sha256=?)`;
 const statements=[
  env.DB.prepare(`UPDATE subscription_periods SET status='expired',updated_at=?
    WHERE user_id=? AND status='active' AND end_at<=?`).bind(now,o.user_id,now),
  env.DB.prepare(`INSERT INTO subscription_payment_events
    (id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at)
    SELECT ? ,t.id,'mk99',?,'PAYMENT_SUCCEEDED',t.amount_fen,?,?
    FROM subscription_payment_transactions t JOIN subscription_orders x ON x.id=t.order_id
    WHERE t.id=? AND x.id=? AND x.user_id=? AND x.status IN ('pending','unknown','paid')
      AND t.status IN ('pending','unknown','paid') AND t.risk_state='clear' AND t.merchant_provider='mk99'
      AND t.provider_trade_id=? AND (t.provider_payment_id IS NULL OR t.provider_payment_id=?)
      AND t.amount_fen=? AND t.amount_fen=x.amount_fen
      AND x.amount_fen=(SELECT price_fen FROM subscription_plan_versions WHERE id=x.plan_version_id)
    ON CONFLICT(merchant_provider,provider_event_id) DO NOTHING`)
    .bind(uuid(),eventKey,evidence,now,o.transaction_id,o.id,o.user_id,o.provider_trade_id,event.tradeNo,event.amountFen),
  env.DB.prepare(`UPDATE subscription_payment_transactions SET status='paid',paid_at=COALESCE(paid_at,?),
      provider_payment_id=COALESCE(provider_payment_id,?),updated_at=?
    WHERE id=? AND merchant_provider='mk99' AND status IN ('pending','unknown','paid')
      AND risk_state='clear' AND (provider_payment_id IS NULL OR provider_payment_id=?)
      AND ${proof}`)
    .bind(now,event.tradeNo,now,o.transaction_id,event.tradeNo,o.transaction_id,eventKey,event.amountFen,evidence),
  env.DB.prepare(`UPDATE subscription_orders SET status='paid',paid_at=COALESCE(paid_at,?),updated_at=?
    WHERE id=? AND user_id=? AND status IN ('pending','unknown','paid')
      AND EXISTS(SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=subscription_orders.id
        AND t.id=? AND t.status='paid' AND t.risk_state='clear' AND t.provider_payment_id=?
        AND t.amount_fen=subscription_orders.amount_fen AND ${proof})`)
    .bind(now,now,o.id,o.user_id,o.transaction_id,event.tradeNo,o.transaction_id,eventKey,event.amountFen,evidence),
  env.DB.prepare(`INSERT INTO subscription_periods
     (id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at)
     SELECT ?,x.user_id,x.id,x.plan_version_id,v.daily_limit,
       CASE WHEN EXISTS(SELECT 1 FROM subscription_periods existing WHERE existing.user_id=x.user_id
         AND existing.status IN ('active','queued')) THEN 'queued' ELSE 'active' END,
       CASE WHEN EXISTS(SELECT 1 FROM subscription_periods existing WHERE existing.user_id=x.user_id
         AND existing.status IN ('active','queued')) THEN NULL ELSE ? END,
       CASE WHEN EXISTS(SELECT 1 FROM subscription_periods existing WHERE existing.user_id=x.user_id
         AND existing.status IN ('active','queued')) THEN NULL ELSE ? END,
       ?,?
     FROM subscription_orders x JOIN subscription_plan_versions v ON v.id=x.plan_version_id
     WHERE x.id=? AND x.user_id=? AND x.status='paid' AND x.paid_at IS NOT NULL
       AND x.kind IN ('purchase','renewal')
       AND EXISTS(SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=x.id
         AND t.id=? AND t.status='paid' AND t.risk_state='clear' AND ${proof})
     ON CONFLICT(source_order_id) DO NOTHING`)
    .bind(periodId,now,now+SUBSCRIPTION_PERIOD_MS,now,now,o.id,o.user_id,o.transaction_id,o.transaction_id,eventKey,event.amountFen,evidence),
  env.DB.prepare(`UPDATE subscription_orders SET applied_at=COALESCE(applied_at,?),updated_at=?
    WHERE id=? AND user_id=? AND status='paid' AND EXISTS(SELECT 1 FROM subscription_periods
       WHERE source_order_id=subscription_orders.id AND user_id=subscription_orders.user_id)`)
    .bind(now,now,o.id,o.user_id),
  env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?, CASE WHEN
     EXISTS(SELECT 1 FROM subscription_orders x JOIN subscription_payment_transactions t ON t.order_id=x.id
       JOIN subscription_periods p ON p.source_order_id=x.id
       JOIN subscription_plan_versions v ON v.id=x.plan_version_id
       WHERE x.id=? AND x.user_id=? AND x.status='paid' AND x.paid_at IS NOT NULL
         AND x.applied_at IS NOT NULL AND t.status='paid' AND t.risk_state='clear'
         AND t.provider_payment_id=? AND t.amount_fen=x.amount_fen AND x.amount_fen=v.price_fen
         AND p.user_id=x.user_id AND p.daily_limit=v.daily_limit
         AND ((p.status='active' AND p.end_at=p.start_at+2592000000)
          OR (p.status='queued' AND p.start_at IS NULL AND p.end_at IS NULL))
         AND ${proof}) THEN 1 ELSE 0 END`)
    .bind(claim,o.id,o.user_id,event.tradeNo,o.transaction_id,eventKey,event.amountFen,evidence),
  env.DB.prepare('DELETE FROM credit_operation_assertions WHERE operation_id=?').bind(claim)
 ];
 try{await env.DB.batch(statements);}
 catch{throw new ApiFailure(409,'SUBSCRIPTION_SETTLEMENT_UNCONFIRMED','订阅结算尚未确认，请保留原订单并重试查询。');}
 const period=await env.DB.prepare(`SELECT id,status,start_at,end_at,daily_limit FROM subscription_periods
   WHERE source_order_id=? AND user_id=?`).bind(o.id,o.user_id).first<{id:string;status:string;start_at:number|null;end_at:number|null;daily_limit:number}>();
 if(!period)throw new ApiFailure(503,'SUBSCRIPTION_SETTLEMENT_UNCONFIRMED','订阅结算尚未确认。');
 return {orderId:o.id,status:'paid',period};
}

/** Authenticated fixed-endpoint query: NOT a user-submitted paid flag or URL. */
export async function refreshSubscriptionMk99Payment(request:Request,env:Env,orderId:string):Promise<Response>{
 if(!purchasesReady(env))throw new ApiFailure(404,'NOT_FOUND','接口不存在。');
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=='web')throw new ApiFailure(403,'WEB_SESSION_REQUIRED','请在官网登录后操作。');
 requireWebOrigin(request,env);
 await requireCsrf(request,env,token);
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(orderId))throw new ApiFailure(400,'INVALID_ORDER_ID','订单号无效。');
 const row=await orderById(env,orderId);
 // Never disclose another user's order existence or merchant transaction ID.
 if(!row||row.user_id!==session.user_id)throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');
 if(!await takeRate(env,'subscription-payment-refresh:'+row.user_id,8,60_000,nowMs()))
   throw new ApiFailure(429,'TOO_MANY_REQUESTS','查询太频繁，请稍后再试。');
 const config=mk99Config(env);
 if(row.merchant_provider!=='mk99'||row.merchant_account!==config.pid||row.notification_sign_type!==config.notifySignType)
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','支付平台与原订单不匹配。');
 let event:Mk99PaymentEvent;
 try{event=await new Mk99Client(config).query(row.provider_trade_id);}
 catch(error){throw new ApiFailure(502,error instanceof Mk99Error?error.code:'MK99_QUERY_UNAVAILABLE','支付平台暂时无法确认付款，请稍后重试。');}
 if(event.tradeStatus!=='TRADE_SUCCESS') {
   // Never convert provider UNKNOWN/CLOSED/FREEZE into a free grant.
   return response({ok:true,orderStatus:row.status,verificationSource:'authenticated_https_query',
     paymentConfirmed:false,providerStatus:event.tradeStatus},200,env,request);
 }
 const settled=await reconcileVerifiedSubscriptionPurchase(env,row,event);
 return response({ok:true,orderStatus:settled.status,verificationSource:'authenticated_https_query',
   paymentConfirmed:true,period:settled.period},200,env,request);
}
