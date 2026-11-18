import type { Env } from './types';
import { ApiFailure } from './types';
import { sessionFor, requireCsrf, takeRate } from './auth';
import { requireWebOrigin, nowMs, uuid, sha256 } from './security';
import { response } from './http';
import { Mk99Client, mk99Config, Mk99Error, type Mk99PaymentEvent } from './mk99';
import { XiaodouProviderError } from './xiaodou.js';
import { configuredXiaodouMerchant } from './xiaodou-merchant';
import { SUBSCRIPTION_PERIOD_MS } from '../../domain/subscription-policy.js';
import { recordSubscriptionRisk } from './subscription-risk';
import { subscriptionsEnabled } from './subscription-account';
import {verifiedSubscriptionSourceSql} from './subscription-payment-proof';

// A new payment domain: NEVER call applyPaymentEvent() for subscriptions.
// This endpoint cannot create charges, and stays OFF even if read-only
// subscription metrics are enabled. Historical order refresh may later be
// enabled independently of new sales, after a migration is approved.
const purchasesReady = (env:Env) => subscriptionsEnabled(env) && env.SUBSCRIPTION_PURCHASES_ENABLED==='1';

export type VerifiedSubscriptionEvent=Omit<Mk99PaymentEvent,'provider'>&{provider:'mk99'|'xiaodou'};

type Order = {
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

function validateOrder(env:Env,o:Order,event:VerifiedSubscriptionEvent):void{
 const xiaodou=o.merchant_provider==='xiaodou',config=xiaodou?null:mk99Config(env);
 if(!['purchase','renewal','upgrade'].includes(o.kind))
   throw new ApiFailure(409,'SUBSCRIPTION_UPGRADE_NOT_READY','升级支付暂时不可结算。');
 if(o.status==='closed'||o.status==='refunded'||o.status==='failed'||o.status==='refund_pending'||o.status==='manual_review'||
    !['pending','unknown','paid'].includes(o.status)||!['pending','unknown','paid'].includes(o.payment_status)||o.risk_state!=='clear')
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_HELD','该订单当前不可结算，请人工核对。');
 const matchMerchant=xiaodou
  ?o.merchant_account===env.XIAODOU_APP_ID&&/^mkid_[0-9a-f]{16}$/.test(o.notification_sign_type??'')
  :o.merchant_provider==='mk99'&&o.merchant_account===config!.pid&&o.notification_sign_type===config!.notifySignType;
 if(!matchMerchant||o.payment_currency!=='CNY'||o.payment_amount_fen!==o.amount_fen||
    (o.kind!=='upgrade'&&o.amount_fen!==o.price_fen)||o.duration_days!==30||
    (xiaodou?o.payment_channel!=='ALIPAY_H5':!['ALIPAY_H5','WECHAT_H5'].includes(o.payment_channel))||
    o.provider_trade_id!==event.outTradeNo||(o.provider_payment_id!=null&&o.provider_payment_id!==event.tradeNo)||
    event.provider!==o.merchant_provider||event.verification!=='authenticated_query'||
    event.tradeStatus!=='TRADE_SUCCESS'||event.amountFen!==o.amount_fen||
    (event.currency!==undefined&&event.currency!=='CNY')||
    (event.merchantId!==undefined&&event.merchantId!==o.merchant_account)||
    (event.paytypeCode!==undefined&&event.paytypeCode!==(o.payment_channel==='WECHAT_H5'?'wxpay':'alipay'))||
    !/^[A-Za-z0-9_-]{1,128}$/.test(event.tradeNo))
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','支付结果与订阅订单不符。');
}

// Record the authenticated money fact even when an expired or held period
// cannot accept the amendment. Support can then reconcile the original charge.
async function settleUpgrade(env:Env,o:Order,event:VerifiedSubscriptionEvent,now:number){
 const providerSql=o.merchant_provider==='xiaodou'?'xiaodou':'mk99';
 const eventKey=o.merchant_provider+'-sub-paid:'+event.tradeNo;
 const evidence=await sha256(`authenticated_${o.merchant_provider}_query:${o.provider_trade_id}:${event.tradeNo}:${event.amountFen}:TRADE_SUCCESS`);
 const quote=await env.DB.prepare(`SELECT id FROM subscription_upgrade_quotes
   WHERE order_id=? AND user_id=? AND period_id=? AND to_version_id=? AND amount_fen=?`)
   .bind(o.id,o.user_id,o.target_period_id,o.plan_version_id,o.amount_fen).first();
 if(!quote)throw new ApiFailure(409,'SUBSCRIPTION_UPGRADE_NOT_READY','升级付款缺少有效报价记录。');
 const proof=`EXISTS(SELECT 1 FROM subscription_payment_events
    WHERE transaction_id=? AND merchant_provider='${providerSql}' AND provider_event_id=?
      AND event_type='PAYMENT_SUCCEEDED' AND amount_fen=? AND body_sha256=?)`;
 const proofParams=[o.transaction_id,eventKey,event.amountFen,evidence] as const;
 const claim=uuid();
 try{await env.DB.batch([
  env.DB.prepare(`INSERT INTO subscription_payment_events
     (id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at)
    SELECT ?,t.id,'${providerSql}',?,'PAYMENT_SUCCEEDED',t.amount_fen,?,?
    FROM subscription_payment_transactions t JOIN subscription_orders x ON x.id=t.order_id
    WHERE t.id=? AND x.id=? AND x.user_id=? AND x.kind='upgrade'
      AND x.status IN ('pending','unknown','paid') AND t.status IN ('pending','unknown','paid') AND t.risk_state='clear'
      AND t.merchant_provider='${providerSql}' AND t.provider_trade_id=?
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
    WHERE x.id=? AND x.user_id=? AND x.status IN ('pending','unknown') AND x.applied_at IS NULL
      AND t.status='paid' AND t.risk_state='clear' AND t.provider_payment_id=?
      AND q.amount_fen=x.amount_fen AND t.amount_fen=x.amount_fen
      AND p.plan_version_id=q.from_version_id AND p.status='active' AND p.end_at=q.period_end_at
      AND p.start_at<=? AND p.end_at>? AND p.daily_limit<v.daily_limit
      AND u.status='active' AND u.archived_at IS NULL
      AND ${verifiedSubscriptionSourceSql(env)}
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
export async function reconcileVerifiedSubscriptionPurchase(env:Env,o:Order,event:VerifiedSubscriptionEvent,now=nowMs()){
 validateOrder(env,o,event);
 const providerSql=o.merchant_provider==='xiaodou'?'xiaodou':'mk99';
 if(o.kind==='upgrade')return settleUpgrade(env,o,event,now);
 const eventKey=o.merchant_provider+'-sub-paid:'+event.tradeNo;
 const evidence=await sha256(`authenticated_${o.merchant_provider}_query:${o.provider_trade_id}:${event.tradeNo}:${event.amountFen}:TRADE_SUCCESS`);
 const claim=uuid(),periodId=uuid();
 const proof=`EXISTS(SELECT 1 FROM subscription_payment_events e
    WHERE e.transaction_id=? AND e.merchant_provider='${providerSql}'
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
    SELECT ? ,t.id,'${providerSql}',?,'PAYMENT_SUCCEEDED',t.amount_fen,?,?
    FROM subscription_payment_transactions t JOIN subscription_orders x ON x.id=t.order_id
    WHERE t.id=? AND x.id=? AND x.user_id=? AND x.status IN ('pending','unknown','paid')
      AND t.status IN ('pending','unknown','paid') AND t.risk_state='clear' AND t.merchant_provider='${providerSql}'
      AND t.provider_trade_id=? AND (t.provider_payment_id IS NULL OR t.provider_payment_id=?)
      AND t.amount_fen=? AND t.amount_fen=x.amount_fen
      AND x.amount_fen=(SELECT price_fen FROM subscription_plan_versions WHERE id=x.plan_version_id)
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=x.user_id AND u.status='active' AND u.archived_at IS NULL)
    ON CONFLICT(merchant_provider,provider_event_id) DO NOTHING`)
    .bind(uuid(),eventKey,evidence,now,o.transaction_id,o.id,o.user_id,o.provider_trade_id,event.tradeNo,event.amountFen),
  env.DB.prepare(`UPDATE subscription_payment_transactions SET status='paid',paid_at=COALESCE(paid_at,?),
      provider_payment_id=COALESCE(provider_payment_id,?),updated_at=?
    WHERE id=? AND merchant_provider='${providerSql}' AND status IN ('pending','unknown','paid')
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
   if(event.tradeStatus==='TRADE_CLOSED'&&['pending','unknown'].includes(row.status)&&
      ['pending','unknown'].includes(row.payment_status)&&row.risk_state==='clear'){
     // Trusted MK99 HTTPS query, not local expiry, is required to release an unpaid checkout.
     await reconcileUnpaidMk99Closed(env,row,'CLOSED');
   }
   const latest=await orderById(env,row.id);
   // Never convert provider UNKNOWN/CLOSED/FREEZE into a free grant.
   return {ok:true,orderStatus:latest?.status??row.status,verificationSource:'authenticated_https_query',
     paymentConfirmed:false,providerStatus:event.tradeStatus};
 }
 // After an independently confirmed close, later proof of money goes to audit/review, never a silent grant.
 if(['closed','failed'].includes(row.status)||['closed','failed'].includes(row.payment_status)){
   await holdLateMk99Payment(env,row,event);
   return {ok:true,orderStatus:'manual_review',verificationSource:'authenticated_https_query',
     paymentConfirmed:true,entitlementApplied:false,providerStatus:event.tradeStatus};
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

/** A signed Xiaodou GET (not a browser return or checkout creation) is the
 * financial truth for subscriptions. All original MK99 orders use their
 * unchanged authenticated MK99 query and settlement path above. */

/** A signed provider CLOSED/FAILED result may unlock *unpaid* checkout.
 * Never infer closure from elapsed time, a browser return, or a webhook alone.
 * A later independently signed SUCCEEDED result is held for manual review. */
export async function reconcileUnpaidXiaodouTerminal(env:Env,row:Order,status:'CLOSED'|'FAILED'){
 const terminal=status==='CLOSED'?'closed':'failed';
 const now=nowMs();
 const safe="t.order_id=? AND t.merchant_provider='xiaodou' AND t.merchant_account=? "+
   "AND t.provider_trade_id=? AND t.amount_fen=? AND t.currency='CNY' "+
   "AND t.status IN ('pending','unknown') AND t.risk_state='clear' AND t.paid_at IS NULL "+
   "AND NOT EXISTS (SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id AND e.event_type='PAYMENT_SUCCEEDED') "+
   "AND NOT EXISTS (SELECT 1 FROM subscription_periods p WHERE p.source_order_id=t.order_id) "+
   "AND NOT EXISTS (SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=t.order_id)";
 await env.DB.batch([
   env.DB.prepare("UPDATE subscription_payment_transactions AS t SET status=?,updated_at=? WHERE "+safe)
     .bind(terminal,now,row.id,row.merchant_account,row.provider_trade_id,row.amount_fen),
   env.DB.prepare("UPDATE subscription_orders SET status=?,updated_at=? "+
     "WHERE id=? AND user_id=? AND status IN ('pending','unknown') "+
     "AND paid_at IS NULL AND applied_at IS NULL "+
     "AND EXISTS (SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=subscription_orders.id "+
     "AND t.status=? AND t.risk_state='clear' AND t.paid_at IS NULL) "+
     "AND NOT EXISTS (SELECT 1 FROM subscription_periods p WHERE p.source_order_id=subscription_orders.id) "+
     "AND NOT EXISTS (SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=subscription_orders.id)")
     .bind(terminal,now,row.id,row.user_id,terminal)
 ]);
}

/** Preserve money evidence when a previously closed/failed attempt later proves
 * paid. No entitlement or new subscription period is issued in this branch. */
async function holdLateXiaodouPayment(env:Env,row:Order,event:VerifiedSubscriptionEvent){
 validateOrder(env,{...row,status:'paid',payment_status:'paid',risk_state:'clear'},event);
 if(row.merchant_provider!=='xiaodou'||row.risk_state!=='clear')
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_HELD','原订单付款状态需人工核对。');
 const now=nowMs(),claim=uuid(),eventKey='xiaodou-sub-paid:'+event.tradeNo;
 const evidence=await sha256('authenticated_xiaodou_query:'+row.provider_trade_id+':'+event.tradeNo+':'+event.amountFen+':TRADE_SUCCESS');
 const proof="EXISTS (SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=? "+
   "AND e.merchant_provider='xiaodou' AND e.provider_event_id=? AND e.event_type='PAYMENT_SUCCEEDED' "+
   "AND e.amount_fen=? AND e.body_sha256=?)";
 try{
   await env.DB.batch([
     env.DB.prepare("INSERT INTO subscription_payment_events "+
       "(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at) "+
       "SELECT ?,t.id,'xiaodou',?,'PAYMENT_SUCCEEDED',t.amount_fen,?,? "+
       "FROM subscription_payment_transactions t JOIN subscription_orders o ON o.id=t.order_id "+
       "WHERE t.id=? AND o.id=? AND o.user_id=? "+
       "AND o.status IN ('closed','failed') AND o.paid_at IS NULL AND o.applied_at IS NULL "+
       "AND t.status IN ('closed','failed') AND t.risk_state='clear' AND t.paid_at IS NULL "+
       "AND t.merchant_provider='xiaodou' AND t.provider_trade_id=? "+
       "AND (t.provider_payment_id IS NULL OR t.provider_payment_id=?) "+
       "AND t.amount_fen=? AND t.amount_fen=o.amount_fen "+
       "AND NOT EXISTS (SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id) "+
       "AND NOT EXISTS (SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=o.id) "+
       "ON CONFLICT(merchant_provider,provider_event_id) DO NOTHING")
       .bind(uuid(),eventKey,evidence,now,row.transaction_id,row.id,row.user_id,row.provider_trade_id,event.tradeNo,event.amountFen),
     env.DB.prepare("UPDATE subscription_payment_transactions SET status='paid',risk_state='manual_review',"+
       "paid_at=COALESCE(paid_at,?),provider_payment_id=COALESCE(provider_payment_id,?),updated_at=? "+
       "WHERE id=? AND status IN ('closed','failed') AND risk_state='clear' AND paid_at IS NULL "+
       "AND (provider_payment_id IS NULL OR provider_payment_id=?) AND "+proof)
       .bind(now,event.tradeNo,now,row.transaction_id,event.tradeNo,row.transaction_id,eventKey,event.amountFen,evidence),
     env.DB.prepare("UPDATE subscription_orders SET status='manual_review',paid_at=COALESCE(paid_at,?),updated_at=? "+
       "WHERE id=? AND user_id=? AND status IN ('closed','failed') AND applied_at IS NULL "+
       "AND EXISTS (SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=subscription_orders.id "+
       "AND t.id=? AND t.status='paid' AND t.risk_state='manual_review' AND "+proof+")")
       .bind(now,now,row.id,row.user_id,row.transaction_id,row.transaction_id,eventKey,event.amountFen,evidence),
     env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?, CASE WHEN "+
       "EXISTS (SELECT 1 FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id "+
       "WHERE o.id=? AND o.user_id=? AND o.status='manual_review' AND o.applied_at IS NULL "+
       "AND t.id=? AND t.status='paid' AND t.risk_state='manual_review' AND "+proof+" "+
       "AND NOT EXISTS (SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id) "+
       "AND NOT EXISTS (SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=o.id)) "+
       "THEN 1 ELSE 0 END")
       .bind(claim,row.id,row.user_id,row.transaction_id,row.transaction_id,eventKey,event.amountFen,evidence),
     env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(claim)
   ]);
 }catch{throw new ApiFailure(409,'SUBSCRIPTION_LATE_PAYMENT_REVIEW','历史订单出现延迟付款证据，需人工核对，未自动发放权益。');}
 const latest=await orderById(env,row.id);
 if(latest?.status!=='manual_review'||latest.risk_state!=='manual_review'||latest.payment_status!=='paid')
   throw new ApiFailure(503,'SUBSCRIPTION_LATE_PAYMENT_REVIEW','延迟付款状态暂无法确认，请人工核对。');
}

/** Retain Xiaodou's independently tested flow; MK99 uses the same guarded terminal/audit invariants. */
export async function reconcileUnpaidMk99Closed(env:Env,row:Order,status:'CLOSED'){
 const terminal='closed';
 const now=nowMs();
 const safe="t.order_id=? AND t.merchant_provider='mk99' AND t.merchant_account=? "+
   "AND t.provider_trade_id=? AND t.amount_fen=? AND t.currency='CNY' "+
   "AND t.status IN ('pending','unknown') AND t.risk_state='clear' AND t.paid_at IS NULL "+
   "AND NOT EXISTS (SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id AND e.event_type='PAYMENT_SUCCEEDED') "+
   "AND NOT EXISTS (SELECT 1 FROM subscription_periods p WHERE p.source_order_id=t.order_id) "+
   "AND NOT EXISTS (SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=t.order_id)";
 await env.DB.batch([
   env.DB.prepare("UPDATE subscription_payment_transactions AS t SET status=?,updated_at=? WHERE "+safe)
     .bind(terminal,now,row.id,row.merchant_account,row.provider_trade_id,row.amount_fen),
   env.DB.prepare("UPDATE subscription_orders SET status=?,updated_at=? "+
     "WHERE id=? AND user_id=? AND status IN ('pending','unknown') "+
     "AND paid_at IS NULL AND applied_at IS NULL "+
     "AND EXISTS (SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=subscription_orders.id "+
     "AND t.status=? AND t.risk_state='clear' AND t.paid_at IS NULL) "+
     "AND NOT EXISTS (SELECT 1 FROM subscription_periods p WHERE p.source_order_id=subscription_orders.id) "+
     "AND NOT EXISTS (SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=subscription_orders.id)")
     .bind(terminal,now,row.id,row.user_id,terminal)
 ]);
}

/** Preserve money evidence when a previously closed/failed attempt later proves
 * paid. No entitlement or new subscription period is issued in this branch. */

async function holdLateMk99Payment(env:Env,row:Order,event:VerifiedSubscriptionEvent){
 validateOrder(env,{...row,status:'paid',payment_status:'paid',risk_state:'clear'},event);
 if(row.merchant_provider!=='mk99'||row.risk_state!=='clear')
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_HELD','原订单付款状态需人工核对。');
 const now=nowMs(),claim=uuid(),eventKey='mk99-sub-paid:'+event.tradeNo;
 const evidence=await sha256('authenticated_mk99_query:'+row.provider_trade_id+':'+event.tradeNo+':'+event.amountFen+':TRADE_SUCCESS');
 const proof="EXISTS (SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=? "+
   "AND e.merchant_provider='mk99' AND e.provider_event_id=? AND e.event_type='PAYMENT_SUCCEEDED' "+
   "AND e.amount_fen=? AND e.body_sha256=?)";
 try{
   await env.DB.batch([
     env.DB.prepare("INSERT INTO subscription_payment_events "+
       "(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at) "+
       "SELECT ?,t.id,'mk99',?,'PAYMENT_SUCCEEDED',t.amount_fen,?,? "+
       "FROM subscription_payment_transactions t JOIN subscription_orders o ON o.id=t.order_id "+
       "WHERE t.id=? AND o.id=? AND o.user_id=? "+
       "AND o.status IN ('closed','failed') AND o.paid_at IS NULL AND o.applied_at IS NULL "+
       "AND t.status IN ('closed','failed') AND t.risk_state='clear' AND t.paid_at IS NULL "+
       "AND t.merchant_provider='mk99' AND t.provider_trade_id=? "+
       "AND (t.provider_payment_id IS NULL OR t.provider_payment_id=?) "+
       "AND t.amount_fen=? AND t.amount_fen=o.amount_fen "+
       "AND NOT EXISTS (SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id) "+
       "AND NOT EXISTS (SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=o.id) "+
       "ON CONFLICT(merchant_provider,provider_event_id) DO NOTHING")
       .bind(uuid(),eventKey,evidence,now,row.transaction_id,row.id,row.user_id,row.provider_trade_id,event.tradeNo,event.amountFen),
     env.DB.prepare("UPDATE subscription_payment_transactions SET status='paid',risk_state='manual_review',"+
       "paid_at=COALESCE(paid_at,?),provider_payment_id=COALESCE(provider_payment_id,?),updated_at=? "+
       "WHERE id=? AND status IN ('closed','failed') AND risk_state='clear' AND paid_at IS NULL "+
       "AND (provider_payment_id IS NULL OR provider_payment_id=?) AND "+proof)
       .bind(now,event.tradeNo,now,row.transaction_id,event.tradeNo,row.transaction_id,eventKey,event.amountFen,evidence),
     env.DB.prepare("UPDATE subscription_orders SET status='manual_review',paid_at=COALESCE(paid_at,?),updated_at=? "+
       "WHERE id=? AND user_id=? AND status IN ('closed','failed') AND applied_at IS NULL "+
       "AND EXISTS (SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=subscription_orders.id "+
       "AND t.id=? AND t.status='paid' AND t.risk_state='manual_review' AND "+proof+")")
       .bind(now,now,row.id,row.user_id,row.transaction_id,row.transaction_id,eventKey,event.amountFen,evidence),
     env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?, CASE WHEN "+
       "EXISTS (SELECT 1 FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id "+
       "WHERE o.id=? AND o.user_id=? AND o.status='manual_review' AND o.applied_at IS NULL "+
       "AND t.id=? AND t.status='paid' AND t.risk_state='manual_review' AND "+proof+" "+
       "AND NOT EXISTS (SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id) "+
       "AND NOT EXISTS (SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=o.id)) "+
       "THEN 1 ELSE 0 END")
       .bind(claim,row.id,row.user_id,row.transaction_id,row.transaction_id,eventKey,event.amountFen,evidence),
     env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(claim)
   ]);
 }catch{throw new ApiFailure(409,'SUBSCRIPTION_LATE_PAYMENT_REVIEW','历史订单出现延迟付款证据，需人工核对，未自动发放权益。');}
 const latest=await orderById(env,row.id);
 if(latest?.status!=='manual_review'||latest.risk_state!=='manual_review'||latest.payment_status!=='paid')
   throw new ApiFailure(503,'SUBSCRIPTION_LATE_PAYMENT_REVIEW','延迟付款状态暂无法确认，请人工核对。');
}


async function queryXiaodouSubscriptionPayment(env:Env,row:Order){
 if(row.merchant_account!==env.XIAODOU_APP_ID||row.payment_channel!=='ALIPAY_H5'||
    !/^mkid_[0-9a-f]{16}$/.test(row.notification_sign_type??''))
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','原订单与收款账户不匹配。');
 let client:ReturnType<typeof configuredXiaodouMerchant>;
 try{client=configuredXiaodouMerchant(env);}catch{throw new ApiFailure(503,'XIAODOU_CONFIG_ERROR','原订单暂无法查询，请稍后重试。');}
 let result:Record<string,unknown>;
 try{result=await client.queryPayment(row.provider_trade_id,{requestId:'xrh-sub-q-'+uuid()});}
 catch(error){throw new ApiFailure(502,error instanceof XiaodouProviderError?error.code:'XIAODOU_QUERY_UNAVAILABLE','暂时无法确认原订单付款，请保留订单并稍后查验。');}
 if(result.outTradeNo!==row.provider_trade_id||result.currency!=='CNY'||result.amountFen!==row.amount_fen||result.channel!==row.payment_channel)
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','支付查询与原订阅金额或支付方式不一致。');
 const status=result.status;
 if(!['CREATED','PAYING','SUCCEEDED','FAILED','CLOSED','UNKNOWN'].includes(String(status)))
   throw new ApiFailure(502,'XIAODOU_QUERY_INVALID','支付平台返回了无法识别的订单状态。');
 if(status!=='SUCCEEDED'){
   if((status==='CLOSED'||status==='FAILED')&&['pending','unknown'].includes(row.status)&&
     ['pending','unknown'].includes(row.payment_status)&&row.risk_state==='clear')
     await reconcileUnpaidXiaodouTerminal(env,row,status);
   const latest=await orderById(env,row.id);
   return {ok:true,orderStatus:latest?.status??row.status,verificationSource:'xiaodou_signed_query',
     paymentConfirmed:false,providerStatus:String(status)};
 }
 const tradeNo=result.openOrderId;
 if(typeof tradeNo!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(tradeNo))
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','支付平台返回的订单标识无法核验。');
 const verified:VerifiedSubscriptionEvent={provider:'xiaodou',verification:'authenticated_query',
   outTradeNo:row.provider_trade_id,tradeNo,amountFen:row.amount_fen,tradeStatus:'TRADE_SUCCESS',
   merchantId:env.XIAODOU_APP_ID,paytypeCode:'alipay',currency:'CNY'};
 if(['closed','failed'].includes(row.status)||['closed','failed'].includes(row.payment_status)){
   await holdLateXiaodouPayment(env,row,verified);
   return {ok:true,orderStatus:'manual_review',verificationSource:'xiaodou_signed_query',
     paymentConfirmed:true,entitlementApplied:false,providerStatus:'SUCCEEDED'};
 }
 if(row.risk_state!=='clear'||['refund_pending','manual_review','refunded'].includes(row.status)){
   validateOrder(env,{...row,status:'paid',payment_status:'paid',risk_state:'clear'},verified);
   return {ok:true,orderStatus:row.status,verificationSource:'xiaodou_signed_query',
     paymentConfirmed:true,entitlementApplied:false,providerStatus:'SUCCEEDED'};
 }
 const settled=await reconcileVerifiedSubscriptionPurchase(env,row,verified);
 return {ok:true,orderStatus:settled.status,verificationSource:'xiaodou_signed_query',
   paymentConfirmed:true,entitlementApplied:settled.status==='paid',period:settled.period,providerStatus:'SUCCEEDED'};
}
