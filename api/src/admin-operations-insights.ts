import type {Env} from './types';
import {requireAdminSession} from './admin-auth';
import {response} from './http';
import {ApiFailure} from './types';
import {jsonBody,nowMs} from './security';
import {operation,commitOperation} from './admin-operations';

const DAY=86_400_000;
const DELIVERIES_LIMIT=1000;
type Delivery={
 request_id:string;user_id:string;created_at:number;
 period_id:string|null;plan_code:string|null;
 source:string|null;model:string|null;estimated_cost_micro_usd:number|null;
};
type Alert={
 key:string;type:'subscription_review'|'credit_payment_unknown'|'credit_entitlement_gap'|'subscription_entitlement_gap'|'ai_budget';
 severity:'attention'|'warning';title:string;detail:string;
 order_id?:string;user_id?:string;created_at?:number;count?:number;order_status?:string;target:'orders'|'subscriptions'|'cost'
};
type PlanRow={
 plan:string;deliveries:number;costMicroUsd:number;
 periods:Set<string>;withCost:number;
};
export async function adminOperationsInsights(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 const now=Date.now(),from=now-7*DAY;
 const day=new Date(now).toISOString().slice(0,10);
 const view=new URL(request.url).searchParams.get('view');
 const needAlerts=view!=='plans',needPlans=view!=='alerts';
 // Index: ai_requests_delivered_at_idx. Rows are capped and explicitly labelled
 // as sampled if more than 1000; never claim incomplete cohorts are exact.
 const [deliveries,subscriptionReview,creditUnknown,budget,setting,creditUnfulfilled,subscriptionUnfulfilled]=await Promise.all([
  needPlans?env.DB.prepare(`SELECT r.request_id,r.user_id,r.delivery_confirmed_at created_at,
     sa.period_id,v.plan_code,
     CASE WHEN ca.state='consumed' AND cb.bucket IN ('free','paid') THEN cb.bucket
       WHEN ca.id IS NULL AND sa.id IS NULL AND r.credit_source IN ('free','paid') THEN r.credit_source
       ELSE NULL END source,c.model,c.estimated_cost_micro_usd
    FROM ai_requests r
    LEFT JOIN subscription_ai_allocations sa
      ON sa.user_id=r.user_id AND sa.request_id=r.request_id AND sa.state='consumed'
    LEFT JOIN ai_credit_allocations ca ON ca.user_id=r.user_id AND ca.request_id=r.request_id
    LEFT JOIN credit_batches cb ON cb.id=ca.credit_batch_id
    LEFT JOIN subscription_periods sp ON sp.id=sa.period_id
    LEFT JOIN subscription_plan_versions v ON v.id=sp.plan_version_id
    LEFT JOIN ai_usage_costs c ON c.user_id=r.user_id AND c.request_id=r.request_id
    WHERE r.status='succeeded' AND r.consumed=1
      AND r.delivery_confirmation_id IS NOT NULL AND r.delivery_confirmation_id<>''
      AND r.delivery_confirmed_at>=? AND r.delivery_confirmed_at<?
    ORDER BY r.delivery_confirmed_at DESC LIMIT ?`)
   .bind(from,now+1,DELIVERIES_LIMIT+1).all<Delivery>():Promise.resolve({results:[] as Delivery[]}),
  // The existing pending-status partial index makes this list cheap.
  needAlerts?env.DB.prepare(`SELECT id,user_id,status,created_at FROM subscription_orders
     WHERE status IN ('pending','unknown','manual_review') AND status<>'pending' AND created_at>=?
     ORDER BY created_at DESC,id DESC LIMIT 8`).bind(now-30*DAY)
   .all<{id:string;user_id:string;status:string;created_at:number}>():Promise.resolve({results:[] as {id:string;user_id:string;status:string;created_at:number}[]}),
  // Existing (provider,status,updated_at) index; legacy protocol provider
  // remains 'xiaodou' even when merchant_provider is MK99.
  needAlerts?env.DB.prepare(`SELECT t.order_id,t.merchant_provider,t.updated_at,o.user_id,o.status order_status
    FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id
    LEFT JOIN system_settings ack ON ack.key='admin_credit_unknown_ack:'||t.order_id
    WHERE t.provider='xiaodou' AND t.status='unknown'
      AND t.merchant_provider IN ('mk99','xiaodou') AND t.updated_at>=?
      AND (ack.value IS NULL OR ack.value<>t.id||':'||t.updated_at)
    ORDER BY t.updated_at DESC LIMIT 8`).bind(now-30*DAY)
    .all<{order_id:string;merchant_provider:string;updated_at:number;user_id:string;order_status:string}>():Promise.resolve({results:[] as {order_id:string;merchant_provider:string;updated_at:number;user_id:string;order_status:string}[]}),
  env.DB.prepare('SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days WHERE budget_day=?')
    .bind(day).first<{reserved_micro_usd:number;settled_micro_usd:number}>(),
  env.DB.prepare(`SELECT value FROM system_settings WHERE key='daily_cost_limit_micro_usd'`).first<{value:string}>(),
  // Paid funds must not disappear when the separate entitlement transaction did
  // not complete. A five-minute grace window avoids transient checkout alarms.
  needAlerts?env.DB.prepare(`SELECT o.id order_id,o.user_id,t.paid_at,t.merchant_provider
    FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id
    WHERE t.provider='xiaodou' AND t.status='paid' AND t.paid_at IS NOT NULL
      AND t.updated_at>=? AND t.paid_at<=? AND o.credited_at IS NULL
      AND t.merchant_provider IN ('mk99','xiaodou') AND t.currency='CNY'
      AND t.amount_fen>0
      AND EXISTS(SELECT 1 FROM provider_payment_events e WHERE e.transaction_id=t.id
        AND e.merchant_provider=t.merchant_provider AND e.event_type='PAYMENT_SUCCEEDED'
        AND e.amount_fen=t.amount_fen AND e.currency='CNY' AND e.body_sha256 IS NOT NULL)
    ORDER BY t.updated_at DESC LIMIT 8`).bind(now-30*DAY,now-5*60_000)
    .all<{order_id:string;user_id:string;paid_at:number;merchant_provider:string}>():Promise.resolve({results:[] as {order_id:string;user_id:string;paid_at:number;merchant_provider:string}[]}),
  needAlerts?env.DB.prepare(`SELECT o.id order_id,o.user_id,t.paid_at,t.merchant_provider
    FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id
    WHERE o.created_at>=? AND t.status='paid' AND t.paid_at IS NOT NULL AND t.paid_at<=?
      AND o.applied_at IS NULL AND t.merchant_provider IN ('mk99','xiaodou')
      AND t.currency='CNY' AND t.amount_fen=o.amount_fen AND t.amount_fen>0
      AND EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id
        AND e.merchant_provider=t.merchant_provider AND e.event_type='PAYMENT_SUCCEEDED'
        AND e.amount_fen=t.amount_fen AND e.body_sha256 IS NOT NULL)
    ORDER BY o.created_at DESC LIMIT 8`).bind(now-30*DAY,now-5*60_000)
    .all<{order_id:string;user_id:string;paid_at:number;merchant_provider:string}>():Promise.resolve({results:[] as {order_id:string;user_id:string;paid_at:number;merchant_provider:string}[]})
 ]);
 const list=(deliveries.results||[]),sampled=list.slice(0,DELIVERIES_LIMIT);
 const byPlan=new Map<string,PlanRow>();
 let paid=0,free=0,subscription=0,unattributed=0;
 for(const row of sampled){
  if(row.period_id&&row.plan_code){
   subscription++;
   const plan=row.plan_code;
   const entry=byPlan.get(plan)||{plan,deliveries:0,costMicroUsd:0,periods:new Set<string>(),withCost:0};
   entry.deliveries++;
   entry.periods.add(row.period_id);
   if(row.estimated_cost_micro_usd!=null){
    entry.withCost++;
    entry.costMicroUsd+=Number(row.estimated_cost_micro_usd);
   }
   byPlan.set(plan,entry);
  }else if(row.source==='free')free++;
  else if(row.source==='paid')paid++;
  else unattributed++;
 }
 const alerts:Alert[]=[];
 for(const o of subscriptionReview.results||[]){
  alerts.push({key:'s:'+o.id,type:'subscription_review',severity:'attention',
    title:o.status==='unknown'?'Subscription payment state unknown':'Subscription order needs review',
    detail:o.status,order_id:o.id,user_id:o.user_id,created_at:o.created_at,target:'subscriptions'});
 }
 for(const o of creditUnknown.results||[]){
  alerts.push({key:'c:'+o.order_id,type:'credit_payment_unknown',severity:'attention',
    title:'Credit-pack payment state unknown',detail:o.merchant_provider,
    order_id:o.order_id,user_id:o.user_id,created_at:o.updated_at,order_status:o.order_status,target:'orders'});
 }
 for(const o of creditUnfulfilled.results||[]){
  alerts.push({key:'ungranted:'+o.order_id,type:'credit_entitlement_gap',severity:'attention',
    title:'Provider-confirmed payment without credited entitlement',
    detail:o.merchant_provider,order_id:o.order_id,user_id:o.user_id,created_at:o.paid_at,target:'orders'});
 }
 for(const o of subscriptionUnfulfilled.results||[]){
  alerts.push({key:'unapplied:'+o.order_id,type:'subscription_entitlement_gap',severity:'attention',
    title:'Provider-confirmed subscription payment without applied entitlement',
    detail:o.merchant_provider,order_id:o.order_id,user_id:o.user_id,created_at:o.paid_at,target:'subscriptions'});
 }
 const limit=Number(setting?.value||0),committed=Number(budget?.reserved_micro_usd||0)+Number(budget?.settled_micro_usd||0);
 if(needAlerts&&limit>0&&committed>=limit*.8){
  alerts.push({key:'budget:'+day,type:'ai_budget',severity:committed>=limit?'attention':'warning',
    title:committed>=limit?'AI daily budget reached':'AI daily budget above 80%',
    detail:day+' UTC',target:'cost'});
 }
 alerts.sort((a,b)=>Number(b.severity==='attention')-Number(a.severity==='attention')||
   Number(b.created_at||0)-Number(a.created_at||0));
 const plans=[...byPlan.values()].sort((a,b)=>b.deliveries-a.deliveries).map(x=>({
  plan:x.plan,deliveries:x.deliveries,observedPeriods:x.periods.size,
  deliveryCostMicroUsd:x.costMicroUsd,costedDeliveries:x.withCost,
  avgCostMicroUsd:x.withCost>0?Math.round(x.costMicroUsd/x.withCost):null
 }));
 return response({
  time:{from,to:now,timezone:'UTC',generatedAt:now},
  alerts,alertCoverage:'Bounded recent unresolved orders and provider-confirmed, 5-minute-old, unfulfilled payments; not an exhaustive historical backlog. Review first; no automatic grant or refund.',
  aiUsage:{
   rowsSampled:sampled.length,moreThanSample:Boolean(list.length>DELIVERIES_LIMIT),limit:DELIVERIES_LIMIT,
   subscription,free,paid,unattributed,plans,
   attributionNote:'Allocation ledger is authoritative for subscription/free/permanent source; a legacy request source is fallback only when neither allocation exists. Plan is current period snapshot and upgrades may change historical grouping. Cost covers successful ACK deliveries only; excludes upstream failures and is not profit.'
  },
  aiBudget:{dayUtc:day,limitMicroUsd:limit,committedMicroUsd:committed,
   percent:limit>0?Math.min(100,Math.round(100*committed/limit)):null}
 },200,env,request);
}

/**
 * Acknowledge an already-expired, UNCONFIRMED credit checkout as an operator
 * task. This NEVER declares a merchant payment closed, changes a transaction,
 * grants credits, or alters financial evidence. The marker is scoped to the
 * transaction ID plus its last update so later payment activity re-alerts.
 * Reuse the existing PK-indexed settings store; no schema migration is needed.
 */
export async function acknowledgeExpiredCreditAlert(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env,true);
 const body=await jsonBody(request,4096);
 const id=body.orderId;
 if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  throw new ApiFailure(400,'INVALID_ORDER_ID','订单编号无效。');
 if(body.confirm!==true)
  throw new ApiFailure(400,'ADMIN_CONFIRM_REQUIRED','请确认仅结束异常提醒，不代表商户已经关闭收款。');
 const op=await operation(env,actor,body,'credit_unknown_alert_ack',id);
 const row=await env.DB.prepare(`SELECT t.id transaction_id,t.updated_at
   FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id
   WHERE o.id=? AND o.status='expired' AND o.paid_at IS NULL AND o.credited_at IS NULL
     AND t.provider='xiaodou' AND t.status='unknown' AND t.risk_state='clear'
     AND t.merchant_provider IN ('mk99','xiaodou') AND t.paid_at IS NULL
     AND COALESCE(t.actual_paid_fen,0)=0
     AND NOT EXISTS(SELECT 1 FROM provider_payment_events e
       WHERE e.transaction_id=t.id AND e.event_type='PAYMENT_SUCCEEDED')
     AND NOT EXISTS(SELECT 1 FROM payment_refunds r WHERE r.transaction_id=t.id)
   ORDER BY t.updated_at DESC LIMIT 1`).bind(id)
   .first<{transaction_id:string;updated_at:number}>();
 if(!row)throw new ApiFailure(409,'ORDER_REVIEW_NOT_ELIGIBLE','该订单已变动或存在付款风险，不能结束提醒，请先核验原单。');
 const key='admin_credit_unknown_ack:'+id;
 const marker=row.transaction_id+':'+row.updated_at;
 const old=await env.DB.prepare('SELECT value FROM system_settings WHERE key=?').bind(key).first<{value:string}>();
 if(old?.value===marker)return response({ok:true,alertAcknowledged:true,alreadyAcknowledged:true,paymentStatusUnchanged:true},200,env,request);
 // A subsequent transaction update invalidates this old marker automatically.
 // This is an operator acknowledgment only, not a merchant close or a refund.
 await commitOperation(env,op,[
  env.DB.prepare(`INSERT INTO system_settings(key,value,updated_at,updated_by)
   VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE
   SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
   .bind(key,marker,nowMs(),actor.user_id)
 ],{marker:old?.value??null,financialStatus:'unchanged'},
   {marker,financialStatus:'unchanged',latePaymentReviewRequired:true});
 return response({ok:true,alertAcknowledged:true,paymentStatusUnchanged:true},200,env,request);
}
