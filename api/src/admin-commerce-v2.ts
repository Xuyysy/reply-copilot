import type {Env} from './types';
import {ApiFailure} from './types';
import {requireAdminSession} from './admin-auth';
import {response} from './http';

const DAY=86_400_000;
type Kind='credit'|'subscription';
type OrderRow={
  id:string;user_id:string;email:string;created_at:number;paid_at:number|null;
  product_type:Kind;product_name:string;order_kind:string;order_status:string;
  payment_status:string|null;merchant_provider:string|null;amount_fen:number|null;
  currency:string|null;credits:number|null;entitlement_status:string;
  payment_evidence:'verified_event'|'credited_legacy'|'unverified';
};
type Cursor={at:number;kind:Kind;id:string};

function dates(p:URLSearchParams){
 const now=Date.now(),from=p.has('from')?Number(p.get('from')):now-90*DAY,to=p.has('to')?Number(p.get('to')):now+1;
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<=from||to>now+DAY||to-from>366*DAY)
   throw new ApiFailure(400,'INVALID_RANGE','请使用最长366天的有效时间范围。');
 return {from,to};
}
function params(request:Request){
 const p=new URL(request.url).searchParams;
 const product=p.get('product')||'all',status=p.get('status')||'';
 const q=(p.get('q')||'').trim();
 if(!['all','credit','subscription'].includes(product)||q.length>120||
   (status&&!['pending','awaiting_payment','unknown','paid','failed','closed','expired','refunded','refund_pending','manual_review'].includes(status)))
   throw new ApiFailure(400,'INVALID_FILTER','订单筛选无效。');
 const cursorRaw=p.get('cursor')||'';
 let cursor:Cursor|null=null;
 if(cursorRaw){
   const m=/^(\d{1,15}):(credit|subscription):([A-Za-z0-9_-]{1,100})$/.exec(cursorRaw);
   if(!m)throw new ApiFailure(400,'INVALID_CURSOR','分页游标无效。');
   cursor={at:Number(m[1]),kind:m[2] as Kind,id:m[3]};
   if(!Number.isSafeInteger(cursor.at))throw new ApiFailure(400,'INVALID_CURSOR','分页游标无效。');
 }
 return {...dates(p),product,status,q,cursor};
}
function filters(source:Kind,at:{from:number;to:number;status:string;q:string;cursor:Cursor|null}){
 const where=['o.created_at>=?','o.created_at<?'],args:(number|string)[]=[at.from,at.to];
 if(at.status){
   // Pending subscriptions and top-ups have different historical enum values.
   where.push('o.status=?');args.push(at.status);
 }
 if(at.q){
   where.push('(o.id=? OR o.user_id=? OR u.email=? COLLATE NOCASE)');
   args.push(at.q,at.q,at.q);
 }
 if(at.cursor){
   const rank=source==='subscription'?1:0,cursorRank=at.cursor.kind==='subscription'?1:0;
   where.push('(o.created_at<? OR (o.created_at=? AND (?<? OR (?=? AND o.id<?))))');
   args.push(at.cursor.at,at.cursor.at,rank,cursorRank,rank,cursorRank,at.cursor.id);
 }
 return {where:where.join(' AND '),args};
}
const creditProof=`EXISTS(SELECT 1 FROM provider_payment_events e
  WHERE e.transaction_id=t.id AND e.merchant_provider=t.merchant_provider
   AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen
   AND e.currency='CNY' AND e.body_sha256 IS NOT NULL)`;
const subscriptionProof=`EXISTS(SELECT 1 FROM subscription_payment_events e
  WHERE e.transaction_id=t.id AND e.merchant_provider=t.merchant_provider
   AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen
   AND e.body_sha256 IS NOT NULL)`;

async function creditOrders(env:Env,at:ReturnType<typeof params>,limit:number){
 const f=filters('credit',at);
 const sql=`SELECT o.id,o.user_id,u.email,o.created_at,o.paid_at,
  'credit' product_type,o.package_name product_name,'one_time' order_kind,
  o.status order_status,COALESCE(t.status,o.status) payment_status,
  t.merchant_provider,t.amount_fen,t.currency,o.credits,
  CASE WHEN o.credited_at IS NOT NULL THEN 'granted' ELSE 'not_granted' END entitlement_status,
  CASE WHEN o.credited_at IS NOT NULL AND t.merchant_provider IN ('mk99','xiaodou')
      AND t.currency='CNY' AND t.amount_fen>0 AND ${creditProof}
    THEN 'verified_event' WHEN o.credited_at IS NOT NULL THEN 'credited_legacy'
    ELSE 'unverified' END payment_evidence
  FROM recharge_orders o JOIN users u ON u.id=o.user_id
  LEFT JOIN payment_transactions t ON t.order_id=o.id
  WHERE ${f.where} ORDER BY o.created_at DESC,o.id DESC LIMIT ?`;
 return (await env.DB.prepare(sql).bind(...f.args,limit).all<OrderRow>()).results||[];
}
async function subscriptionOrders(env:Env,at:ReturnType<typeof params>,limit:number){
 const f=filters('subscription',at);
 const sql=`SELECT o.id,o.user_id,u.email,o.created_at,o.paid_at,
  'subscription' product_type,v.plan_code product_name,o.kind order_kind,
  o.status order_status,COALESCE(t.status,o.status) payment_status,
  t.merchant_provider,o.amount_fen,o.currency,NULL credits,
  CASE WHEN o.status IN ('manual_review','refund_pending','refunded') THEN 'under_review'
    WHEN o.applied_at IS NOT NULL THEN 'applied' ELSE 'not_applied' END entitlement_status,
  CASE WHEN o.paid_at IS NOT NULL AND t.paid_at IS NOT NULL
     AND t.merchant_provider IN ('mk99','xiaodou')
     AND t.currency='CNY' AND t.amount_fen=o.amount_fen
     AND ${subscriptionProof} THEN 'verified_event' ELSE 'unverified' END payment_evidence
  FROM subscription_orders o JOIN users u ON u.id=o.user_id
  JOIN subscription_plan_versions v ON v.id=o.plan_version_id
  LEFT JOIN subscription_payment_transactions t ON t.order_id=o.id
  WHERE ${f.where} ORDER BY o.created_at DESC,o.id DESC LIMIT ?`;
 return (await env.DB.prepare(sql).bind(...f.args,limit).all<OrderRow>()).results||[];
}
function orderCompare(a:OrderRow,b:OrderRow){
 return b.created_at-a.created_at||Number(b.product_type==='subscription')-Number(a.product_type==='subscription')||
   b.id.localeCompare(a.id,'en');
}
/** Two existing order ledgers, one bounded operator projection; never write either ledger. */
export async function adminCommerceOrders(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 const at=params(request),pageSize=40;
 const [credits,subscriptions]=await Promise.all([
   at.product==='subscription'?Promise.resolve([]):creditOrders(env,at,pageSize+1),
   at.product==='credit'?Promise.resolve([]):subscriptionOrders(env,at,pageSize+1)
 ]);
 const merged=[...credits,...subscriptions].sort(orderCompare);
 const items=merged.slice(0,pageSize),last=items.at(-1);
 return response({items,hasMore:merged.length>pageSize,
   nextCursor:merged.length>pageSize&&last?`${last.created_at}:${last.product_type}:${last.id}`:null,
   range:{from:at.from,to:at.to},limit:pageSize,
   caveat:'verified_event requires provider evidence; credited_legacy is NOT proof of external settlement'
 },200,env,request);
}

/** Financial receipts require matched, signed external provider events.
 * Refunds are shown independently; a gross amount is not net revenue. */
export async function adminCommerceSummary(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 const p=new URL(request.url).searchParams,{from,to}=dates(p);
 const [credit,subscription,creditRefunds]=await Promise.all([
  env.DB.prepare(`SELECT COUNT(*) orders,COUNT(DISTINCT o.user_id) buyers,
    COALESCE(SUM(t.amount_fen),0) gross_fen FROM recharge_orders o
    JOIN payment_transactions t ON t.order_id=o.id
    WHERE t.paid_at>=? AND t.paid_at<? AND o.credited_at IS NOT NULL
      AND t.status IN ('paid','refunded') AND t.merchant_provider IN ('mk99','xiaodou')
      AND t.currency='CNY' AND t.amount_fen>0 AND ${creditProof}`).bind(from,to).first(),
  env.DB.prepare(`SELECT o.kind,COUNT(*) orders,COUNT(DISTINCT o.user_id) buyers,
    COALESCE(SUM(o.amount_fen),0) gross_fen FROM subscription_orders o
    JOIN subscription_payment_transactions t ON t.order_id=o.id
    WHERE t.paid_at>=? AND t.paid_at<? AND o.paid_at IS NOT NULL
      AND t.status IN ('paid','refunded') AND t.merchant_provider IN ('mk99','xiaodou')
      AND t.currency='CNY' AND t.amount_fen=o.amount_fen AND ${subscriptionProof}
    GROUP BY o.kind`).bind(from,to).all(),
  env.DB.prepare(`SELECT COUNT(*) refunds,COALESCE(SUM(r.amount_fen),0) amount_fen
    FROM payment_refunds r JOIN payment_transactions t ON t.id=r.transaction_id
    WHERE r.status='succeeded' AND r.succeeded_at>=? AND r.succeeded_at<?
      AND t.merchant_provider IN ('mk99','xiaodou')`).bind(from,to).first()
 ]);
 const subs=(subscription.results||[]) as Array<{kind:string;orders:number;buyers:number;gross_fen:number}>;
 return response({from,to,currency:'CNY',verifiedCredit:credit,verifiedSubscription:subs,
   verifiedGrossFen:Number((credit as {gross_fen?:number}|null)?.gross_fen||0)+subs.reduce((sum,x)=>sum+Number(x.gross_fen||0),0),
   creditConfirmedRefunds:creditRefunds,
   caveat:'Verified gross receipts, not net proceeds. Subscription refund settlement is not included in the refund amount; no profit is asserted.'
 },200,env,request);
}

export async function adminCommerceUser(request:Request,env:Env,userId:string):Promise<Response>{
 await requireAdminSession(request,env);
 const user=await env.DB.prepare('SELECT id,email,status,archived_at FROM users WHERE id=?').bind(userId)
  .first<{id:string;email:string;status:string;archived_at:number|null}>();
 if(!user)throw new ApiFailure(404,'USER_NOT_FOUND','用户不存在。');
 const now=Date.now();
 const [balance,periods,orders]=await Promise.all([
  env.DB.prepare('SELECT free_balance,paid_balance FROM credit_accounts WHERE user_id=?')
   .bind(userId).first(),
  env.DB.prepare(`SELECT p.id period_id,p.status period_status,p.daily_limit,p.start_at,p.end_at,
    v.plan_code, o.id source_order_id, o.status order_status,o.applied_at,
    t.status payment_status,t.merchant_provider,t.risk_state,
    COALESCE(d.used,0) used_today,COALESCE(d.reserved,0) reserved_today,
    CASE WHEN o.paid_at IS NOT NULL AND o.applied_at IS NOT NULL
      AND t.paid_at IS NOT NULL AND t.status='paid' AND t.risk_state='clear'
      AND t.merchant_provider IN ('mk99','xiaodou') AND t.amount_fen=o.amount_fen
      AND t.currency='CNY' AND ${subscriptionProof} THEN 1 ELSE 0 END real_payment_verified
    FROM subscription_periods p JOIN subscription_plan_versions v ON v.id=p.plan_version_id
    JOIN subscription_orders o ON o.id=p.source_order_id
    LEFT JOIN subscription_payment_transactions t ON t.order_id=o.id
    LEFT JOIN subscription_daily_usage d ON d.period_id=p.id AND d.day_index=
      CASE WHEN p.start_at<=? AND p.end_at>? THEN CAST((?-p.start_at)/86400000 AS INTEGER) ELSE -1 END
    WHERE p.user_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT 12`)
   .bind(now,now,now,userId).all(),
  env.DB.prepare(`SELECT o.id,o.kind,o.amount_fen,o.created_at,o.status,v.plan_code,
    t.status payment_status,t.merchant_provider
    FROM subscription_orders o JOIN subscription_plan_versions v ON v.id=o.plan_version_id
    LEFT JOIN subscription_payment_transactions t ON t.order_id=o.id
    WHERE o.user_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 20`)
    .bind(userId).all()
 ]);
 const list=(periods.results||[]).map((row:Record<string,unknown>)=>{
  const real=row.real_payment_verified===1;
  const active=real&&row.period_status==='active'&&row.order_status==='paid'&&user.status==='active'
    &&user.archived_at===null&&typeof row.start_at==='number'&&typeof row.end_at==='number'
    &&row.start_at<=now&&row.end_at>now;
  const used=Number(row.used_today)||0,reserved=Number(row.reserved_today)||0;
  return {...row,effective_active:active,remaining_today:active?Math.max(0,Number(row.daily_limit)-used-reserved):0};
 });
 return response({user,creditBalances:balance??{free_balance:0,paid_balance:0},
  subscriptionPeriods:list,subscriptionOrders:orders.results??[],asOf:now,
  caveat:'Subscription daily allowance is independent of permanent balances; mock payments never verify real purchases'
 },200,env,request);
}
