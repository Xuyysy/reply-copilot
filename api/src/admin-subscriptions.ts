import type { Env } from './types';
import { ApiFailure } from './types';
import { requireAdminSession } from './admin-auth';
import { jsonBody,nowMs,requireWebOrigin } from './security';
import { commitOperation,operation } from './admin-operations';
import { response } from './http';
import { orderById,querySubscriptionPayment } from './subscription-settlement';
import { takeRate } from './auth';
import { checkoutEnabled } from './subscription-checkout';
import { paymentControl } from './payment-policy';
import { subscriptionsEnabled } from './subscription-account';
import {SUBSCRIPTION_30D_USAGE_SQL} from './admin-subscription-finance-queries.js';

// Subscription routes are independently gated from legacy commerce.
function requireSubscriptionFeature(env: Env): void {
  if (!subscriptionsEnabled(env))
    throw new ApiFailure(404, 'NOT_FOUND', '接口不存在。');
}

/** Public catalog for the subscription-first pricing page, only after rollout. */
export async function publicSubscriptionPlans(request: Request, env: Env): Promise<Response> {
  requireSubscriptionFeature(env);
  const rows=await env.DB.prepare(`SELECT plan_code,price_fen,daily_limit,duration_days,name_zh,name_en,
    description_zh,description_en FROM subscription_plan_versions
    WHERE current=1 AND active=1 ORDER BY daily_limit`).all();
  const control=checkoutEnabled(env)?await paymentControl(env):null;
  const paymentMethods=control&&['mk99','xiaodou'].includes(control.activeMerchant)?control.methods.filter(method=>method.provider===control.activeMerchant).map(method=>method.channel):[];
  return response({plans:rows.results,autoRenew:false,checkoutAvailable:paymentMethods.length>0,paymentMethods},200,env,request);
}

export async function adminSubscriptionPlans(request: Request, env: Env): Promise<Response> {
  await requireAdminSession(request,env);
  requireSubscriptionFeature(env);
  const rows=await env.DB.prepare(`SELECT id,plan_code,version,price_fen,daily_limit,duration_days,
    name_zh,name_en,description_zh,description_en,active,current,updated_at
    FROM subscription_plan_versions WHERE current=1
    ORDER BY daily_limit`).all();
  return response({plans:rows.results},200,env,request);
}

export async function adminSubscriptionUsers(request: Request, env: Env): Promise<Response> {
  await requireAdminSession(request,env);
  requireSubscriptionFeature(env);
  const params=new URL(request.url).searchParams;
  const status=params.get('status')??'';
  const plan=params.get('plan')??'';
  if (status && !['active','queued','expired','refund_pending','revoked'].includes(status))
    throw new ApiFailure(400,'INVALID_FILTER','订阅状态筛选无效。');
  if (plan && !['basic','pro','max','ultra'].includes(plan))
    throw new ApiFailure(400,'INVALID_FILTER','订阅档位筛选无效。');
  const now=Date.now();
  // Subscription eligibility already accepts verified BoltUtil payments; the
  // administrator's display must follow the same proof without granting quotas.
  // Never reference crypto tables if their independent migration is not ready.
  const cryptoReady=['staging','production'].includes(env.ENVIRONMENT)&&env.BOLTUTIL_SCHEMA_READY==='1';
  const cryptoProof=cryptoReady ? `
    EXISTS(SELECT 1 FROM boltutil_orders b
      WHERE b.subscription_order_id=o.id AND b.user_id=p.user_id
        AND o.user_id=p.user_id
        AND b.status='paid' AND b.paid_at IS NOT NULL AND b.applied_at IS NOT NULL
        AND b.product_type='subscription' AND b.tx_hash IS NOT NULL AND b.receiving_address IS NOT NULL
        AND b.payable_usdt_micros>=1000000 AND b.paid_usdt_micros>=b.payable_usdt_micros
        AND EXISTS(SELECT 1 FROM boltutil_payment_events e
          WHERE e.external_order_id=b.external_order_id AND e.network=b.network
            AND e.tx_hash=b.tx_hash AND e.body_sha256 IS NOT NULL))` : '0';
  const rows=await env.DB.prepare(`SELECT p.id period_id,p.user_id,u.email,u.username,u.status account_status,
    p.status period_status,v.plan_code,p.daily_limit,p.start_at,p.end_at,p.created_at,
    u.archived_at account_archived_at,
    o.id order_id,o.kind order_kind,o.amount_fen,o.status order_status,
    o.paid_at order_paid_at,o.applied_at order_applied_at,
    t.status payment_status,t.risk_state,t.paid_at transaction_paid_at,
    t.currency payment_currency,t.amount_fen payment_amount_fen,t.merchant_provider,
    EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id
      AND e.merchant_provider=t.merchant_provider AND e.event_type='PAYMENT_SUCCEEDED'
      AND e.amount_fen=t.amount_fen
      AND (t.merchant_provider='local_mock' OR e.body_sha256 IS NOT NULL)) verified_paid_event,
    ${cryptoProof} verified_crypto_paid_event,
    COALESCE(d.used,0) used_today,COALESCE(d.reserved,0) reserved_today
    FROM subscription_periods p
    JOIN users u ON u.id=p.user_id
    JOIN subscription_plan_versions v ON v.id=p.plan_version_id
    JOIN subscription_orders o ON o.id=p.source_order_id
    LEFT JOIN subscription_payment_transactions t ON t.order_id=o.id
    LEFT JOIN subscription_daily_usage d ON d.period_id=p.id AND d.day_index=
      CASE WHEN p.start_at IS NOT NULL AND p.end_at IS NOT NULL
        AND p.start_at<=? AND p.end_at>? THEN CAST((?-p.start_at)/86400000 AS INTEGER) ELSE -1 END
    WHERE (?='' OR p.status=?) AND (?='' OR v.plan_code=?)
    ORDER BY p.created_at DESC,p.id DESC LIMIT 100`)
      .bind(now,now,now,status,status,plan,plan).all();
  return response({users:rows.results.map((row:Record<string,unknown>)=>{
    // A crypto subscription has no corresponding fiat transaction row.
    // Retain the original strict fiat proof for CNY subscriptions.
    const fiatVerified=row.payment_status==='paid'&&row.transaction_paid_at!=null&&
      row.risk_state==='clear'&&row.verified_paid_event===1&&
      row.payment_currency==='CNY'&&row.payment_amount_fen===row.amount_fen&&
      (env.ENVIRONMENT!=='production'||['mk99','xiaodou'].includes(String(row.merchant_provider)));
    const cryptoVerified=cryptoReady&&row.verified_crypto_paid_event===1;
    const active=row.period_status==='active'&&typeof row.start_at==='number'&&
      typeof row.end_at==='number'&&row.start_at<=now&&now<row.end_at&&
      row.order_status==='paid'&&row.order_paid_at!=null&&row.order_applied_at!=null&&
      row.account_status==='active'&&row.account_archived_at==null&&
      (fiatVerified||cryptoVerified);
    const used=Number(row.used_today)||0,reserved=Number(row.reserved_today)||0;
    const effectiveStatus=row.order_status==='refunded'?'revoked':
      ['refund_pending','manual_review'].includes(String(row.order_status))?'refund_pending':
      active?'active':row.period_status==='active'?'expired_or_unverified':row.period_status;
    return {...row,effective_status:effectiveStatus,
      remaining_today:active?Math.max(0,Number(row.daily_limit)-used-reserved):0};
  })},200,env,request);
}


/** Bounded, verified-read-only order audit. No manual grant or paid-state mutation. */
export async function adminSubscriptionOrders(request: Request, env: Env): Promise<Response> {
  await requireAdminSession(request,env);
  requireSubscriptionFeature(env);
  const params=new URL(request.url).searchParams;
  const kind=params.get('kind')??'';
  const status=params.get('status')??'';
  if(kind&&!['purchase','renewal','upgrade'].includes(kind))
    throw new ApiFailure(400,'INVALID_FILTER','订阅订单类型无效。');
  if(status&&!['pending','unknown','paid','closed','failed','refund_pending','refunded','manual_review'].includes(status))
    throw new ApiFailure(400,'INVALID_FILTER','订阅订单状态无效。');
  const rows=await env.DB.prepare(`SELECT o.id,o.user_id,u.email,o.kind,o.amount_fen,o.status,
    o.plan_version_id,v.plan_code,o.target_period_id,o.quoted_at,o.quote_expires_at,
    o.created_at,o.paid_at,o.applied_at,t.merchant_provider,t.provider_trade_id,
    t.status payment_status,t.risk_state,t.paid_at transaction_paid_at,
    (SELECT COUNT(*) FROM subscription_payment_events e WHERE e.transaction_id=t.id
       AND e.merchant_provider=t.merchant_provider AND e.event_type='PAYMENT_SUCCEEDED'
       AND e.amount_fen=t.amount_fen
       AND (t.merchant_provider='local_mock' OR e.body_sha256 IS NOT NULL)) verified_event_count
    FROM subscription_orders o JOIN users u ON u.id=o.user_id
    JOIN subscription_plan_versions v ON v.id=o.plan_version_id
    LEFT JOIN subscription_payment_transactions t ON t.order_id=o.id
    WHERE (?='' OR o.kind=?) AND (?='' OR o.status=?)
    ORDER BY o.created_at DESC,o.id DESC LIMIT 100`)
    .bind(kind,kind,status,status).all();
  return response({orders:rows.results},200,env,request);
}

export async function publishSubscriptionPlan(request:Request,env:Env,code:string):Promise<Response>{
 requireSubscriptionFeature(env);
 const actor=await requireAdminSession(request,env,true);
 requireWebOrigin(request,env);
 const body=await jsonBody(request,8192);
 const {expectedId,priceFen,nameZh,nameEn,descriptionZh,descriptionEn,active}=body;
 if(Object.keys(body).some(key=>!['operationId','reason','expectedId','priceFen','nameZh','nameEn','descriptionZh','descriptionEn','active'].includes(key))||
    typeof expectedId!=='string'||typeof priceFen!=='number'||!Number.isSafeInteger(priceFen)||priceFen<1||priceFen>10_000_000||
    typeof nameZh!=='string'||!nameZh.trim()||nameZh.length>80||typeof nameEn!=='string'||!nameEn.trim()||nameEn.length>80||
    typeof descriptionZh!=='string'||descriptionZh.length>1500||typeof descriptionEn!=='string'||descriptionEn.length>1500||
    typeof active!=='boolean')
   throw new ApiFailure(400,'INVALID_SUBSCRIPTION_PLAN','订阅套餐配置无效。');
 const op=await operation(env,actor,body,'subscription_plan_publish',code);
 if(op.replayed)return response({ok:true,replayed:true},200,env,request);
 const before=await env.DB.prepare('SELECT * FROM subscription_plan_versions WHERE plan_code=? AND current=1')
   .bind(code).first<{id:string;version:number;daily_limit:number}>();
 if(!before||before.id!==expectedId)throw new ApiFailure(409,'SUBSCRIPTION_PLAN_CONFLICT','套餐已变更，请重新加载。');
 const now=nowMs();
 const after={id:op.id,version:before.version+1,priceFen,nameZh,nameEn,descriptionZh,descriptionEn,active};
 await commitOperation(env,op,[
   env.DB.prepare('UPDATE subscription_plan_versions SET current=0 WHERE id=? AND current=1').bind(before.id),
   env.DB.prepare(`INSERT INTO subscription_plan_versions
     (id,plan_code,version,price_fen,daily_limit,name_zh,name_en,description_zh,description_en,active,created_at,updated_at)
     SELECT ?,plan_code,version+1,?,daily_limit,?,?,?,?,?,?,? FROM subscription_plan_versions WHERE id=? AND current=0`)
    .bind(op.id,priceFen,nameZh.trim(),nameEn.trim(),descriptionZh.trim(),descriptionEn.trim(),Number(active),now,now,before.id),
   env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN
    EXISTS(SELECT 1 FROM subscription_plan_versions v WHERE v.id=? AND v.current=1)
     AND NOT EXISTS(SELECT 1 FROM subscription_plan_versions v WHERE v.current=1
      AND ((v.daily_limit<? AND v.price_fen>=?) OR (v.daily_limit>? AND v.price_fen<=?)))
    THEN 1 ELSE 0 END`).bind(op.id,op.id,before.daily_limit,priceFen,before.daily_limit,priceFen),
   env.DB.prepare('DELETE FROM credit_operation_assertions WHERE operation_id=?').bind(op.id)
 ],before,after);
 return response({ok:true,replayed:op.replayed},200,env,request);
}

/** Audited hold for chargeback or refund review. Releases and already recorded
 * consumption remain intact. Only provider evidence may mark a refund final. */
export async function holdSubscriptionOrder(request:Request,env:Env,id:string):Promise<Response>{
 requireSubscriptionFeature(env);
 const actor=await requireAdminSession(request,env,true);
 requireWebOrigin(request,env);
 const body=await jsonBody(request,2048);
 if(Object.keys(body).some(key=>key!=='operationId'&&key!=='reason'))
   throw new ApiFailure(400,'INVALID_REQUEST','复核请求只能包含操作编号和原因。');
 const op=await operation(env,actor,body,'subscription_order_hold',id);
 if(op.replayed)return response({ok:true,replayed:true},200,env,request);
 const before=await env.DB.prepare(`SELECT o.status,t.risk_state,t.id transaction_id
   FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id WHERE o.id=?`)
   .bind(id).first<{status:string;risk_state:string;transaction_id:string}>();
 if(!before)throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');
 if(!['paid','refund_pending','manual_review'].includes(before.status))
   throw new ApiFailure(409,'SUBSCRIPTION_HOLD_UNAVAILABLE','该订单不能进入此复核流程。');
 const now=nowMs();
 await commitOperation(env,op,[
   env.DB.prepare(`INSERT INTO credit_operation_assertions(operation_id,ok)
    SELECT ?,EXISTS(SELECT 1 FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id
    WHERE o.id=? AND o.status=? AND t.id=? AND t.risk_state=?)`).bind(op.id,id,before.status,before.transaction_id,before.risk_state),
   env.DB.prepare("UPDATE subscription_payment_transactions SET risk_state='frozen',updated_at=? WHERE id=?").bind(now,before.transaction_id),
   env.DB.prepare("UPDATE subscription_orders SET status='refund_pending',updated_at=? WHERE id=?").bind(now,id),
   env.DB.prepare(`UPDATE subscription_periods SET status='refund_pending',updated_at=?
     WHERE status='active' AND (source_order_id=? OR id IN (SELECT period_id FROM subscription_tier_changes WHERE order_id=?))`).bind(now,id,id),
   env.DB.prepare('DELETE FROM credit_operation_assertions WHERE operation_id=?').bind(op.id)
 ],before,{status:'refund_pending',riskState:'frozen'});
 return response({ok:true,replayed:op.replayed},200,env,request);
}

export async function adminSubscriptionFinance(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 requireSubscriptionFeature(env);
 const from=nowMs()-30*86400000;
 // Keep verified payment totals fresh, but only load 30-day subscription usage
 // and AI provider cost history when specifically requested by an operator.
 // Requests without view=summary retain the full legacy response.
 const summaryOnly=new URL(request.url).searchParams.get('view')==='summary';
 const [orders,usage]=await Promise.all([
  env.DB.prepare(`SELECT o.kind,COUNT(*) orders,SUM(o.amount_fen) gross_paid_fen,
    SUM(CASE WHEN o.status='refunded' THEN o.amount_fen ELSE 0 END) full_refunded_fen,
    SUM(CASE WHEN o.status IN ('manual_review','refund_pending') THEN 1 ELSE 0 END) held_orders
   FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id
   WHERE o.paid_at>=? AND t.merchant_provider IN ('mk99','xiaodou')
     AND EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=o.amount_fen AND e.body_sha256 IS NOT NULL)
   GROUP BY o.kind`).bind(from).all(),
  summaryOnly?Promise.resolve(null):env.DB.prepare(SUBSCRIPTION_30D_USAGE_SQL).bind(from,from).first()
 ]);
 return response({from,orders:orders.results??[],usage,detailScope:summaryOnly?'summary':'full'},200,env,request);
}


export async function reviewSubscriptionPayment(request:Request,env:Env,id:string):Promise<Response>{
 requireSubscriptionFeature(env);
 const actor=await requireAdminSession(request,env,true);
 requireWebOrigin(request,env);
 const body=await jsonBody(request,2048);
 if(Object.keys(body).some(key=>key!=='operationId'&&key!=='reason'))
   throw new ApiFailure(400,'INVALID_REQUEST','复核请求只能包含操作编号和原因。');
 const op=await operation(env,actor,body,'subscription_order_verify',id);
 if(op.replayed)return response({ok:true,replayed:true},200,env,request);
 if(!await takeRate(env,'admin-subscription-review:'+actor.user_id,8,60000,nowMs()))
   throw new ApiFailure(429,'TOO_MANY_REQUESTS','复核操作过于频繁。');
 const order=await orderById(env,id);
 if(!order)throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');
 // Audit intent before the read-only merchant query. Any verified change to
 // money/entitlement state is separately atomic in the payment event ledger.
 await commitOperation(env,op,[],{status:order.status},{merchantQueryRequested:true});
 if(op.replayed)return response({ok:true,replayed:true},200,env,request);
 return response(await querySubscriptionPayment(env,order),200,env,request);
}
