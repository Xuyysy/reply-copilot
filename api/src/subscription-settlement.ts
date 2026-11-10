import type { Env } from './types';
import { ApiFailure } from './types';
import { sessionFor, requireCsrf, takeRate } from './auth';
import { requireWebOrigin, nowMs, uuid, sha256 } from './security';
import { response } from './http';
import { Mk99Client, mk99Config, Mk99Error, type Mk99PaymentEvent } from './mk99';
import { SUBSCRIPTION_PERIOD_MS } from '../../domain/subscription-policy.js';
import { recordSubscriptionRisk } from './subscription-risk';
import { subscriptionsEnabled } from './subscription-account';
import {createConfiguredXiaodouClient} from './xiaodou-client';
import {validateFeeProjection} from './xiaodou.js';

// A new payment domain: NEVER call applyPaymentEvent() for subscriptions.
// This endpoint cannot create charges, and stays OFF even if read-only
// subscription metrics are enabled. Historical order refresh may later be
// enabled independently of new sales, after a migration is approved.
const purchasesReady = (env:Env) => subscriptionsEnabled(env) && env.SUBSCRIPTION_PURCHASES_ENABLED==='1';

export type Order = {
  id:string;user_id:string;kind:string;plan_version_id:string;status:string;
  amount_fen:number;price_fen:number;daily_limit:number;duration_days:number;
  transaction_id:string;merchant_provider:string;merchant_account:string|null;
  notification_sign_type:string|null;provider_trade_id:string;provider_payment_id:string|null;
  payment_status:string;risk_state:string;payment_amount_fen:number;payment_currency:string;
  payment_channel:string;target_period_id:string|null;
};

export async function orderById(env:Env,id:string):Promise<Order|null>{
 return env.DB.prepare(`SELECT o.id,o.user_id,o.kind,o.target_period_id,o.plan_version_id,o.status,o.amount_fen,
     v.price_fen,v.daily_limit,v.duration_days,t.id transaction_id,
     t.merchant_provider,t.merchant_account,t.notification_sign_type,t.provider_trade_id,
     t.provider_payment_id,t.status payment_status,t.risk_state,t.amount_fen payment_amount_fen,
     t.currency payment_currency,t.payment_channel
   FROM subscription_orders o JOIN subscription_plan_versions v ON v.id=o.plan_version_id
   JOIN subscription_payment_transactions t ON t.order_id=o.id WHERE o.id=?`)
   .bind(id).first<Order>();
}

type VerifiedSubscriptionPayment=Omit<Mk99PaymentEvent,'provider'>&{provider:'mk99'|'xiaodou'};

/** Dedicated XA validation: only verified and authenticated RSA2 QUERY may grant subscription. */
function validateXiaodouOrder(env:Env,o:Order,event:VerifiedSubscriptionPayment):void{
 if(!env.XIAODOU_APP_ID||o.merchant_provider!=='xiaodou'||o.merchant_account!==env.XIAODOU_APP_ID||
   o.notification_sign_type!=='RSA-SHA256'||o.payment_currency!=='CNY'||
   o.payment_amount_fen!==o.amount_fen||(o.kind!=='upgrade'&&o.amount_fen!==o.price_fen)||
   o.duration_days!==30||o.payment_channel!=='ALIPAY_H5'||o.provider_trade_id!==event.outTradeNo||
   (o.provider_payment_id!==null&&o.provider_payment_id!==event.tradeNo)||
   !['purchase','renewal','upgrade'].includes(o.kind)||o.risk_state!=='clear'||
   !['pending','unknown','paid'].includes(o.status)||!['pending','unknown','paid'].includes(o.payment_status)||
   event.provider!=='xiaodou'||event.verification!=='authenticated_query'||event.tradeStatus!=='TRADE_SUCCESS'||
   event.amountFen!==o.amount_fen||event.currency!=='CNY'||event.paytypeCode!=='alipay'||
   !/^[A-Za-z0-9_-]{1,128}$/.test(event.tradeNo))
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','小豆 RSA2 查单证据与订阅商家、金额或渠道不一致。');
}

function validateOrder(env:Env,o:Order,event:Mk99PaymentEvent):void{
 const config=mk99Config(env);
 if(!['purchase','renewal','upgrade'].includes(o.kind))
   throw new ApiFailure(409,'SUBSCRIPTION_UPGRADE_NOT_READY','升级支付暂时不可结算。');
 if(o.status==='closed'||o.status==='refunded'||o.status==='failed'||o.status==='refund_pending'||o.status==='manual_review' ||
    !['pending','unknown','paid'].includes(o.status) ||
    !['pending','unknown','paid'].includes(o.payment_status)||o.risk_state!=='clear')
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_HELD','该订单当前不可结算，请人工核对。');
 if(o.merchant_provider!=='mk99'||o.merchant_account!==config.pid||o.notification_sign_type!==config.notifySignType||
    o.payment_currency!=='CNY'||o.payment_amount_fen!==o.amount_fen||
    (o.kind!=='upgrade'&&o.amount_fen!==o.price_fen)||o.duration_days!==30||
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

// Record the authenticated money fact even when an expired or held period
// cannot accept the amendment. Support can then reconcile the original charge.
async function settleUpgrade(env:Env,o:Order,event:VerifiedSubscriptionPayment,now:number){
 const eventKey=event.provider+'-sub-paid:'+event.tradeNo;
 const evidence=await sha256(`authenticated_${event.provider}_query:${o.provider_trade_id}:${event.tradeNo}:${event.amountFen}:TRADE_SUCCESS`);
 const quote=await env.DB.prepare(`SELECT id FROM subscription_upgrade_quotes
   WHERE order_id=? AND user_id=? AND period_id=? AND to_version_id=? AND amount_fen=?`)
   .bind(o.id,o.user_id,o.target_period_id,o.plan_version_id,o.amount_fen).first();
 if(!quote)throw new ApiFailure(409,'SUBSCRIPTION_UPGRADE_NOT_READY','升级付款缺少有效报价记录。');
 const proof=`EXISTS(SELECT 1 FROM subscription_payment_events
    WHERE transaction_id=? AND merchant_provider='${event.provider}' AND provider_event_id=?
      AND event_type='PAYMENT_SUCCEEDED' AND amount_fen=? AND body_sha256=?)`;
 const proofParams=[o.transaction_id,eventKey,event.amountFen,evidence] as const;
 const claim=uuid();
 try{await env.DB.batch([
  env.DB.prepare(`INSERT INTO subscription_payment_events
     (id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at)
    SELECT ?,t.id,'${event.provider}',?,'PAYMENT_SUCCEEDED',t.amount_fen,?,?
    FROM subscription_payment_transactions t JOIN subscription_orders x ON x.id=t.order_id
    WHERE t.id=? AND x.id=? AND x.user_id=? AND x.kind='upgrade'
      AND x.status IN ('pending','unknown','paid') AND t.status IN ('pending','unknown','paid') AND t.risk_state='clear'
      AND t.merchant_provider='${event.provider}' AND t.provider_trade_id=?
      AND (t.provider_payment_id IS NULL OR t.provider_payment_id=?)
      AND t.amount_fen=? AND t.amount_fen=x.amount_fen
    ON CONFLICT(merchant_provider,provider_event_id) DO NOTHING`)
    .bind(uuid(),eventKey,evidence,now,o.transaction_id,o.id,o.user_id,o.provider_trade_id,event.tradeNo,event.amountFen),
  env.DB.prepare(`UPDATE subscription_payment_transactions SET status='paid',
      paid_at=COALESCE(paid_at,?),provider_payment_id=COALESCE(provider_payment_id,?),updated_at=?
    WHERE id=? AND risk_state='clear' AND status IN ('pending','unknown','paid')
      AND (provider_payment_id IS NULL OR provider_payment_id=?) AND ${proof}`)
    .bind(now,event.tradeNo,now,o.transaction_id,event.tradeNo,...proofParams),
  env.DB.prepare(`INSERT INTO subscription_tier_changes
     (id,period_id,order_id,previous_plan_version_id,next_plan_version_id,previous_daily_limit,
      next_daily_limit,charged_fen,effective_at,original_expires_at)
    SELECT ?,p.id,x.id,p.plan_version_id,v.id,p.daily_limit,v.daily_limit,x.amount_fen,?,p.end_at
    FROM subscription_orders x
    JOIN subscription_upgrade_quotes q ON q.order_id=x.id AND q.user_id=x.user_id AND q.period_id=x.target_period_id
    JOIN subscription_periods p ON p.id=q.period_id AND p.user_id=x.user_id
    JOIN subscription_plan_versions v ON v.id=x.plan_version_id AND v.id=q.to_version_id
    JOIN subscription_payment_transactions t ON t.order_id=x.id
    JOIN users u ON u.id=x.user_id
    JOIN subscription_orders source ON source.id=p.source_order_id AND source.user_id=p.user_id
    JOIN subscription_payment_transactions origin ON origin.order_id=source.id
    WHERE x.id=? AND x.user_id=? AND x.status IN ('pending','unknown') AND x.applied_at IS NULL
      AND t.status='paid' AND t.risk_state='clear' AND t.provider_payment_id=?
      AND q.amount_fen=x.amount_fen AND t.amount_fen=x.amount_fen
      AND p.plan_version_id=q.from_version_id AND p.status='active' AND p.end_at=q.period_end_at
      AND p.start_at<=? AND p.end_at>? AND p.daily_limit<v.daily_limit
      AND u.status='active' AND u.archived_at IS NULL
      AND source.status='paid' AND source.applied_at IS NOT NULL AND origin.status='paid' AND origin.risk_state='clear'
      AND ${proof}
    ON CONFLICT(order_id) DO NOTHING`).bind(claim,now,o.id,o.user_id,event.tradeNo,now,now,...proofParams),
  env.DB.prepare(`UPDATE subscription_periods SET plan_version_id=?,daily_limit=?,updated_at=?
    WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.id=? AND c.period_id=subscription_periods.id)`)
    .bind(o.plan_version_id,o.daily_limit,now,o.target_period_id,o.user_id,claim),
  env.DB.prepare(`UPDATE subscription_orders SET status='paid',paid_at=COALESCE(paid_at,?),
      applied_at=COALESCE(applied_at,?),updated_at=?
    WHERE id=? AND user_id=? AND status IN ('pending','unknown','paid') AND ${proof}
      AND EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=subscription_orders.id AND c.period_id=subscription_orders.target_period_id)`)
    .bind(now,now,now,o.id,o.user_id,...proofParams),
  env.DB.prepare(`UPDATE subscription_orders SET status='manual_review',paid_at=COALESCE(paid_at,?),updated_at=?
    WHERE id=? AND user_id=? AND status IN ('pending','unknown') AND applied_at IS NULL AND ${proof}
      AND NOT EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=subscription_orders.id)`)
    .bind(now,now,o.id,o.user_id,...proofParams),
  env.DB.prepare(`UPDATE subscription_payment_transactions SET risk_state='manual_review',updated_at=?
    WHERE id=? AND provider_payment_id=? AND status='paid' AND risk_state='clear'
      AND EXISTS(SELECT 1 FROM subscription_orders x WHERE x.id=subscription_payment_transactions.order_id AND x.status='manual_review')`)
    .bind(now,o.transaction_id,event.tradeNo),
  env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok)
    SELECT ?,CASE WHEN ${proof} AND EXISTS(
      SELECT 1 FROM subscription_orders x JOIN subscription_payment_transactions t ON t.order_id=x.id
      WHERE x.id=? AND x.user_id=? AND t.id=? AND t.status='paid' AND t.provider_payment_id=?
        AND ((x.status='paid' AND x.applied_at IS NOT NULL AND t.risk_state='clear'
          AND EXISTS(SELECT 1 FROM subscription_tier_changes c JOIN subscription_periods p ON p.id=c.period_id
            WHERE c.order_id=x.id AND p.id=x.target_period_id AND p.user_id=x.user_id
              AND p.daily_limit>=c.next_daily_limit AND p.end_at=c.original_expires_at))
          OR (x.status='manual_review' AND x.applied_at IS NULL AND t.risk_state='manual_review'))
    ) THEN 1 ELSE 0 END`).bind(claim,...proofParams,o.id,o.user_id,o.transaction_id,event.tradeNo),
  env.DB.prepare('DELETE FROM credit_operation_assertions WHERE operation_id=?').bind(claim)
 ]);}catch{
  throw new ApiFailure(409,'SUBSCRIPTION_SETTLEMENT_UNCONFIRMED','订阅结算尚未确认，请保留原订单并重试查询。');
 }
 const latest=await orderById(env,o.id);
 const period=latest?.status==='paid'?await env.DB.prepare(`SELECT id,status,start_at,end_at,daily_limit
   FROM subscription_periods WHERE id=? AND user_id=?`).bind(o.target_period_id,o.user_id).first():null;
 return {orderId:o.id,status:latest?.status==='paid'?'paid':'manual_review',period};
}

/**
 * Only called after Mk99Client.query() has returned a provider result from its
 * fixed, merchant-authenticated HTTPS endpoint. Idempotent settlement grants
 * one 30-day period, or one QUEUED period when an existing period is active.
 *
 * D1 batch is an atomic SQLite transaction; the final assertions deliberately
 * abort it if any statement becomes a no-op due to a concurrent state change.
 */
export async function reconcileVerifiedSubscriptionPurchase(env:Env,o:Order,event:VerifiedSubscriptionPayment,now=nowMs()){
 if(event.provider==='xiaodou')validateXiaodouOrder(env,o,event);
 else validateOrder(env,o,event as Mk99PaymentEvent);
 if(o.kind==='upgrade')return settleUpgrade(env,o,event,now);
 const eventKey=event.provider+'-sub-paid:'+event.tradeNo;
 const evidence=await sha256(`authenticated_${event.provider}_query:${o.provider_trade_id}:${event.tradeNo}:${event.amountFen}:TRADE_SUCCESS`);
 const claim=uuid(),periodId=uuid();
 const proof=`EXISTS(SELECT 1 FROM subscription_payment_events e
    WHERE e.transaction_id=? AND e.merchant_provider='${event.provider}'
      AND e.provider_event_id=? AND e.event_type='PAYMENT_SUCCEEDED'
      AND e.amount_fen=? AND e.body_sha256=?)`;
 const predecessor=`EXISTS(SELECT 1 FROM subscription_periods existing WHERE existing.user_id=x.user_id
         AND ((existing.status IN ('active','refund_pending','revoked') AND existing.end_at>?)
           OR (existing.status='queued' AND EXISTS(SELECT 1 FROM subscription_orders q
              WHERE q.id=existing.source_order_id AND q.status='paid'))))`;
 const statements=[
  env.DB.prepare(`UPDATE subscription_periods SET status='expired',updated_at=?
    WHERE user_id=? AND status='active' AND end_at<=?`).bind(now,o.user_id,now),
  env.DB.prepare(`INSERT INTO subscription_payment_events
    (id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at)
    SELECT ? ,t.id,'${event.provider}',?,'PAYMENT_SUCCEEDED',t.amount_fen,?,?
    FROM subscription_payment_transactions t JOIN subscription_orders x ON x.id=t.order_id
    WHERE t.id=? AND x.id=? AND x.user_id=? AND x.status IN ('pending','unknown','paid')
      AND t.status IN ('pending','unknown','paid') AND t.risk_state='clear' AND t.merchant_provider='${event.provider}'
      AND t.provider_trade_id=? AND (t.provider_payment_id IS NULL OR t.provider_payment_id=?)
      AND t.amount_fen=? AND t.amount_fen=x.amount_fen
      AND x.amount_fen=(SELECT price_fen FROM subscription_plan_versions WHERE id=x.plan_version_id)
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=x.user_id AND u.status='active' AND u.archived_at IS NULL)
    ON CONFLICT(merchant_provider,provider_event_id) DO NOTHING`)
    .bind(uuid(),eventKey,evidence,now,o.transaction_id,o.id,o.user_id,o.provider_trade_id,event.tradeNo,event.amountFen),
  env.DB.prepare(`UPDATE subscription_payment_transactions SET status='paid',paid_at=COALESCE(paid_at,?),
      provider_payment_id=COALESCE(provider_payment_id,?),updated_at=?
    WHERE id=? AND merchant_provider='${event.provider}' AND status IN ('pending','unknown','paid')
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
       CASE WHEN ${predecessor} THEN 'queued' ELSE 'active' END,
       CASE WHEN ${predecessor} THEN NULL ELSE ? END,
       CASE WHEN ${predecessor} THEN NULL ELSE ? END,
       ?,?
     FROM subscription_orders x JOIN subscription_plan_versions v ON v.id=x.plan_version_id
     WHERE x.id=? AND x.user_id=? AND x.status='paid' AND x.paid_at IS NOT NULL
       AND x.kind IN ('purchase','renewal')
       AND EXISTS(SELECT 1 FROM users u WHERE u.id=x.user_id AND u.status='active' AND u.archived_at IS NULL)
       AND EXISTS(SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=x.id
         AND t.id=? AND t.status='paid' AND t.risk_state='clear' AND ${proof})
     ON CONFLICT(source_order_id) DO NOTHING`)
    .bind(periodId,now,now,now,now,now+SUBSCRIPTION_PERIOD_MS,now,now,o.id,o.user_id,o.transaction_id,o.transaction_id,eventKey,event.amountFen,evidence),
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
         AND p.user_id=x.user_id AND (p.daily_limit=v.daily_limit OR EXISTS(
           SELECT 1 FROM subscription_tier_changes c WHERE c.period_id=p.id AND c.next_plan_version_id=p.plan_version_id
             AND c.next_daily_limit=p.daily_limit))
         AND EXISTS(SELECT 1 FROM users u WHERE u.id=x.user_id AND u.status='active' AND u.archived_at IS NULL)
         AND ((p.status IN ('active','expired') AND p.end_at=p.start_at+2592000000)
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
 return response(await querySubscriptionPayment(env,row),200,env,request);
}

/** Same provider trust boundary for customer refresh and reauthenticated review. */
export async function querySubscriptionPayment(env:Env,row:Order){
 if(row.merchant_provider==='xiaodou')return queryXiaodouSubscriptionPayment(env,row);
 const config=mk99Config(env);
 if(row.merchant_provider!=='mk99'||row.merchant_account!==config.pid||row.notification_sign_type!==config.notifySignType)
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','支付平台与原订单不匹配。');
 let event:Mk99PaymentEvent;
 try{event=await new Mk99Client(config).query(row.provider_trade_id);}
 catch(error){throw new ApiFailure(502,error instanceof Mk99Error?error.code:'MK99_QUERY_UNAVAILABLE','支付平台暂时无法确认付款，请稍后重试。');}
 if(event.tradeStatus!=='TRADE_SUCCESS') {
   if(row.provider_trade_id!==event.outTradeNo||
      (row.provider_payment_id!==null&&row.provider_payment_id!==event.tradeNo)||
      event.amountFen!==row.amount_fen||
      (event.currency!==undefined&&event.currency!=='CNY')||
      (event.merchantId!==undefined&&event.merchantId!==config.pid)||
      (event.paytypeCode!==undefined&&event.paytypeCode!==(row.payment_channel==='WECHAT_H5'?'wxpay':'alipay')))
     throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','支付结果与订阅订单不符。');
   await recordSubscriptionRisk(env,{id:row.transaction_id,order_id:row.id,amount_fen:row.amount_fen},event,nowMs());
   if(event.tradeStatus==='TRADE_CLOSED'){
     await env.DB.batch([
       env.DB.prepare(`UPDATE subscription_payment_transactions SET status='closed',updated_at=?
         WHERE id=? AND status IN ('pending','unknown') AND risk_state='clear'`).bind(nowMs(),row.transaction_id),
       env.DB.prepare(`UPDATE subscription_orders SET status='closed',updated_at=?
         WHERE id=? AND status IN ('pending','unknown') AND EXISTS(SELECT 1 FROM subscription_payment_transactions
           WHERE order_id=subscription_orders.id AND status='closed' AND risk_state='clear')`).bind(nowMs(),row.id)
     ]);
   }
   const latest=await orderById(env,row.id);
   // Never convert provider UNKNOWN/CLOSED/FREEZE into a free grant.
   return {ok:true,orderStatus:latest?.status??row.status,verificationSource:'authenticated_https_query',
     paymentConfirmed:false,providerStatus:event.tradeStatus};
 }
 // A paid provider status never clears a previously applied risk hold.
 if(row.risk_state!=='clear'||['refund_pending','manual_review','refunded'].includes(row.status)){
   validateOrder(env,{...row,status:'paid',payment_status:'paid',risk_state:'clear'},event);
   return {ok:true,orderStatus:row.status,verificationSource:'authenticated_https_query',
     paymentConfirmed:true,entitlementApplied:false,providerStatus:event.tradeStatus};
 }
 const settled=await reconcileVerifiedSubscriptionPurchase(env,row,event);
 return {ok:true,orderStatus:settled.status,verificationSource:'authenticated_https_query',
   paymentConfirmed:true,entitlementApplied:settled.status==='paid',period:settled.period};
}

/** Merchant-authenticated RSA2 signed query. A browser return is never proof. */
async function queryXiaodouSubscriptionPayment(env:Env,row:Order){
 if(row.merchant_provider!=='xiaodou'||!env.XIAODOU_APP_ID||
   row.merchant_account!==env.XIAODOU_APP_ID||row.notification_sign_type!=='RSA-SHA256')
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','原订单小豆商户身份与配置不一致。');
 const client=createConfiguredXiaodouClient(env);
 let signed:Record<string,any>;
 try{signed=await client.queryPayment(row.provider_trade_id,{requestId:'xrh-sub-q-'+uuid()});}
 catch{throw new ApiFailure(502,'XIAODOU_QUERY_UNAVAILABLE','小豆查询无法核对付款，请保留原订单。');}
 if(!signed||signed.outTradeNo!==row.provider_trade_id||
   signed.channel!==row.payment_channel||signed.currency!=='CNY'||
   !Number.isSafeInteger(signed.amountFen)||signed.amountFen!==row.amount_fen||
   !['CREATED','PAYING','SUCCEEDED','CLOSED','FAILED','UNKNOWN'].includes(signed.status))
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','小豆查单订单身份、渠道或金额不一致。');
 if(!validateFeeProjection(signed.feeProjection,row.amount_fen))
   throw new ApiFailure(409,'SUBSCRIPTION_FEE_PROJECTION_UNCONFIRMED','小豆费用投影未核实，尚未发放订阅。');
 if(signed.status!=='SUCCEEDED')
   return {ok:true,orderStatus:row.status,verificationSource:'xiaodou_rsa2_signed_query',
    paymentConfirmed:false,providerStatus:signed.status};
 if(typeof signed.openOrderId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(signed.openOrderId))
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','小豆已付订单缺少平台身份。');
 const event:VerifiedSubscriptionPayment={
   provider:'xiaodou',verification:'authenticated_query',outTradeNo:row.provider_trade_id,
   tradeNo:signed.openOrderId,amountFen:signed.amountFen,tradeStatus:'TRADE_SUCCESS',
   currency:'CNY',paytypeCode:'alipay'
 };
 if(row.risk_state!=='clear'||['refund_pending','manual_review','refunded'].includes(row.status))
   return {ok:true,orderStatus:row.status,verificationSource:'xiaodou_rsa2_signed_query',
    paymentConfirmed:true,entitlementApplied:false,providerStatus:'SUCCEEDED'};
 const settled=await reconcileVerifiedSubscriptionPurchase(env,row,event);
 return {ok:true,orderStatus:settled.status,verificationSource:'xiaodou_rsa2_signed_query',
   paymentConfirmed:true,entitlementApplied:settled.status==='paid',period:settled.period,providerStatus:'SUCCEEDED'};
}
