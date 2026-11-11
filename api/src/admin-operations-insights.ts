import type {Env} from './types';
import {requireAdminSession} from './admin-auth';
import {response} from './http';

const DAY=86_400_000;
const DELIVERIES_LIMIT=1000;
type Delivery={
 request_id:string;user_id:string;created_at:number;
 period_id:string|null;plan_code:string|null;
 source:string|null;model:string|null;estimated_cost_micro_usd:number|null;
};
type Alert={
 key:string;type:'subscription_review'|'credit_payment_unknown'|'ai_budget'|'ai_failures';
 severity:'attention'|'warning';title:string;detail:string;
 order_id?:string;user_id?:string;created_at?:number;count?:number;target:'orders'|'subscriptions'|'cost'
};
type PlanRow={
 plan:string;deliveries:number;costMicroUsd:number;
 periods:Set<string>;withCost:number;
};
export async function adminOperationsInsights(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 const now=Date.now(),from=now-7*DAY;
 const day=new Date(now).toISOString().slice(0,10);
 // Index: ai_requests_delivered_at_idx. Rows are capped and explicitly labelled
 // as sampled if more than 1000; never claim incomplete cohorts are exact.
 const [deliveries,subscriptionReview,creditUnknown,aiFailures,budget,setting]=await Promise.all([
  env.DB.prepare(`SELECT r.request_id,r.user_id,r.delivery_confirmed_at created_at,
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
   .bind(from,now+1,DELIVERIES_LIMIT+1).all<Delivery>(),
  // The existing pending-status partial index makes this list cheap.
  env.DB.prepare(`SELECT id,user_id,status,created_at FROM subscription_orders
     WHERE status IN ('pending','unknown','manual_review') AND status<>'pending' AND created_at>=?
     ORDER BY created_at DESC,id DESC LIMIT 8`).bind(now-30*DAY)
   .all<{id:string;user_id:string;status:string;created_at:number}>(),
  // Existing (provider,status,updated_at) index; legacy protocol provider
  // remains 'xiaodou' even when merchant_provider is MK99.
  env.DB.prepare(`SELECT t.order_id,t.merchant_provider,t.updated_at,o.user_id
    FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id
    WHERE t.provider='xiaodou' AND t.status='unknown'
      AND t.merchant_provider IN ('mk99','xiaodou') AND t.updated_at>=?
    ORDER BY t.updated_at DESC LIMIT 8`).bind(now-30*DAY)
    .all<{order_id:string;merchant_provider:string;updated_at:number;user_id:string}>(),
  env.DB.prepare(`SELECT COUNT(*) n FROM ai_requests
    WHERE status IN ('upstream_failed','uncertain') AND created_at>=?`).bind(now-DAY)
    .first<{n:number}>(),
  env.DB.prepare('SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days WHERE budget_day=?')
    .bind(day).first<{reserved_micro_usd:number;settled_micro_usd:number}>(),
  env.DB.prepare(`SELECT value FROM system_settings WHERE key='daily_cost_limit_micro_usd'`).first<{value:string}>()
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
    order_id:o.order_id,user_id:o.user_id,created_at:o.updated_at,target:'orders'});
 }
 const limit=Number(setting?.value||0),committed=Number(budget?.reserved_micro_usd||0)+Number(budget?.settled_micro_usd||0);
 if(limit>0&&committed>=limit*.8){
  alerts.push({key:'budget:'+day,type:'ai_budget',severity:committed>=limit?'attention':'warning',
    title:committed>=limit?'AI daily budget reached':'AI daily budget above 80%',
    detail:day+' UTC',target:'cost'});
 }
 if((aiFailures?.n||0)>0){
  alerts.push({key:'ai-failures:'+day,type:'ai_failures',severity:'warning',
    title:'Failed or uncertain AI requests in the last 24h',
    detail:'UTC rolling 24h',count:Number(aiFailures!.n),target:'cost'});
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
  alerts,alertCoverage:'Bounded recent unresolved subscription/credit orders; not an exhaustive backlog or proof of a financial incident',
  aiUsage:{
   rowsSampled:sampled.length,moreThanSample:Boolean(list.length>DELIVERIES_LIMIT),limit:DELIVERIES_LIMIT,
   subscription,free,paid,unattributed,plans,
   attributionNote:'Allocation ledger is authoritative for subscription/free/permanent source; a legacy request source is fallback only when neither allocation exists. Plan is current period snapshot and upgrades may change historical grouping. Cost covers successful ACK deliveries only; excludes upstream failures and is not profit.'
  },
  aiBudget:{dayUtc:day,limitMicroUsd:limit,committedMicroUsd:committed,
   percent:limit>0?Math.min(100,Math.round(100*committed/limit)):null},
  aiFailures24h:Number(aiFailures?.n||0)
 },200,env,request);
}
