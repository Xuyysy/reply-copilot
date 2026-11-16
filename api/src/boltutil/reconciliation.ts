import type {Env} from "../types";
import {ApiFailure} from "../types";
import {requireAdminSession} from "../admin-auth";
import {response} from "../http";
import {boltReadSchemaReady} from "./environment";
import {SUPPORTED_BOLT_NETWORKS} from "./contract";

/**
 * Read-only recorded evidence. No provider calls, chain queries, or
 * financial/entitlement mutations. A stored digest is NOT independent proof
 * of on-chain payment or provider signature validity.
 */
const BASE=[
 "SELECT b.id,b.external_order_id,b.user_id,u.email,b.network,b.product_type,",
 "b.credit_order_id,b.subscription_order_id,b.status,b.base_amount_fen,",
 "b.quoted_usdt_micros,b.payable_usdt_micros,b.paid_usdt_micros,b.tx_hash,",
 "b.paid_at,b.applied_at,b.created_at,b.expires_at,",
 "(SELECT COUNT(*) FROM boltutil_payment_events e",
 "WHERE e.external_order_id=b.external_order_id AND e.network=b.network",
 "AND e.tx_hash=b.tx_hash AND length(e.body_sha256)>0) AS recorded_receipts,",
 "CASE",
 "WHEN b.status='manual_review' THEN 'manual_review'",
 "WHEN b.status='paid' AND b.applied_at IS NULL THEN 'paid_unapplied'",
 "WHEN b.status='paid' AND (b.tx_hash IS NULL OR NOT EXISTS(",
 "SELECT 1 FROM boltutil_payment_events e",
 "WHERE e.external_order_id=b.external_order_id AND e.network=b.network",
 "AND e.tx_hash=b.tx_hash AND length(e.body_sha256)>0",
 ")) THEN 'missing_recorded_receipt'",
 "WHEN b.status='paid' AND b.product_type='credits' AND NOT EXISTS(",
 "SELECT 1 FROM recharge_orders r WHERE r.id=b.credit_order_id AND r.user_id=b.user_id",
 "AND r.status='paid' AND r.credited_at IS NOT NULL",
 ") THEN 'missing_credit_order_state'",
 "WHEN b.status='paid' AND b.product_type='credits' AND NOT EXISTS(",
 "SELECT 1 FROM credit_ledger l",
 "WHERE l.kind='purchase_grant' AND l.reference_id=b.credit_order_id",
 ") THEN 'missing_credit_ledger'",
 "WHEN b.status='paid' AND b.product_type='subscription' AND",
 "(NOT EXISTS(SELECT 1 FROM subscription_orders o",
 "WHERE o.id=b.subscription_order_id AND o.applied_at IS NOT NULL)",
 "OR NOT EXISTS(SELECT 1 FROM subscription_periods p",
 "WHERE p.source_order_id=b.subscription_order_id",
 "UNION ALL SELECT 1 FROM subscription_tier_changes t",
 "WHERE t.order_id=b.subscription_order_id)) THEN 'missing_subscription_entitlement'",
 "WHEN b.status IN ('creating','pending','unknown') AND b.expires_at IS NOT NULL",
 "AND b.expires_at<? THEN 'expired_unresolved'",
 "WHEN b.status='unknown' THEN 'unknown_status'",
 "ELSE NULL END AS review_reason",
 "FROM boltutil_orders b JOIN users u ON u.id=b.user_id"
].join(" ");

const EMPTY={total:0,attention:0,manual_review:0,paid_unapplied:0,paid:0,pending:0};
type Scope="all"|"attention"|"paid"|"open";
function parseFilter(request:Request){
 const q=new URL(request.url).searchParams;
 const network=q.get("network")??"all";
 const scope=q.get("scope")??"attention";
 const limit=q.get("limit")??"25";
 const cursor=q.get("cursor");
 if((network!=="all"&&!SUPPORTED_BOLT_NETWORKS.some(n=>n===network))||
    !["all","attention","paid","open"].includes(scope)||
    !/^[1-9][0-9]?$/.test(limit)||Number(limit)>50||
    (cursor!==null&&!/^([1-9][0-9]{0,15})\.([0-9a-f-]{36})$/i.test(cursor)))
   throw new ApiFailure(400,"BOLTUTIL_REPORT_FILTER_INVALID","USDT 对账筛选参数无效。");
 const match=cursor?.match(/^([1-9][0-9]{0,15})\.([0-9a-f-]{36})$/i);
 return {network,scope:scope as Scope,limit:Number(limit),
   before:match?{time:Number(match[1]),id:match[2]}:null};
}
export async function adminBoltReconciliation(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 const filter=parseFilter(request);
 if(!boltReadSchemaReady(env))
  return response({schemaReady:false,summary:EMPTY,orders:[],nextCursor:null,
    scope:filter.scope,network:filter.network,reportCurrency:"USDT",
    message:"USDT tables are not declared ready; no historical records were queried."},200,env,request);
 const now=Date.now();
 const summarySql="WITH classified AS ("+BASE+") SELECT COUNT(*) total,"+
  "COALESCE(SUM(CASE WHEN review_reason IS NOT NULL THEN 1 ELSE 0 END),0) attention,"+
  "COALESCE(SUM(CASE WHEN review_reason='manual_review' THEN 1 ELSE 0 END),0) manual_review,"+
  "COALESCE(SUM(CASE WHEN review_reason='paid_unapplied' THEN 1 ELSE 0 END),0) paid_unapplied,"+
  "COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END),0) paid,"+
  "COALESCE(SUM(CASE WHEN status IN ('creating','pending','unknown') THEN 1 ELSE 0 END),0) pending"+
  " FROM classified";
 const summary=(await env.DB.prepare(summarySql).bind(now).first<Record<string,number>>())??EMPTY;
 const sql="WITH classified AS ("+BASE+") SELECT * FROM classified WHERE "+
  "(?='all' OR network=?) AND "+
  "(?='all' OR (?='attention' AND review_reason IS NOT NULL) "+
  "OR (?='paid' AND status='paid') "+
  "OR (?='open' AND status IN ('creating','pending','unknown'))) "+
  "AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) "+
  "ORDER BY created_at DESC,id DESC LIMIT ?";
 const before=filter.before;
 const result=await env.DB.prepare(sql).bind(
   now,filter.network,filter.network,
   filter.scope,filter.scope,filter.scope,filter.scope,
   before?.time??null,before?.time??null,before?.time??null,before?.id??null,
   filter.limit+1
 ).all<Record<string,unknown>>();
 const rows=result.results??[];
 const hasNext=rows.length>filter.limit;
 const orders=rows.slice(0,filter.limit);
 const last=orders.at(-1);
 const nextCursor=hasNext&&last?String(last.created_at)+"."+String(last.id):null;
 return response({schemaReady:true,summary,orders,nextCursor,scope:filter.scope,
   network:filter.network,reportCurrency:"USDT",
   note:"Stored provider receipt digests are not independent on-chain verification; amounts use USDT micros."},200,env,request);
}
export async function adminBoltOrderEvidence(request:Request,env:Env,id:string):Promise<Response>{
 await requireAdminSession(request,env);
 if(!boltReadSchemaReady(env))
   throw new ApiFailure(404,"BOLTUTIL_NOT_FOUND","USDT 订单证据暂不可读取。");
 if(!/^[0-9a-f-]{36}$/i.test(id))
   throw new ApiFailure(404,"BOLTUTIL_NOT_FOUND","未找到对应的 USDT 订单。");
 const order=await env.DB.prepare(
  "SELECT b.id,b.external_order_id,b.user_id,u.email,b.network,b.product_type,"+
  "b.credit_order_id,b.subscription_order_id,b.status,b.base_amount_fen,"+
  "b.quoted_usdt_micros,b.payable_usdt_micros,b.paid_usdt_micros,b.tx_hash,"+
  "b.receiving_address,b.token_contract,b.paid_at,b.applied_at,b.created_at,b.expires_at "+
  "FROM boltutil_orders b JOIN users u ON u.id=b.user_id WHERE b.id=?"
 ).bind(id).first<Record<string,unknown>>();
 if(!order)throw new ApiFailure(404,"BOLTUTIL_NOT_FOUND","未找到对应的 USDT 订单。");
 const events=await env.DB.prepare(
  "SELECT event_id,status,network,tx_hash,received_at,"+
  "CASE WHEN length(body_sha256)>0 THEN 1 ELSE 0 END has_recorded_digest "+
  "FROM boltutil_payment_events WHERE external_order_id=? ORDER BY received_at DESC,event_id DESC LIMIT 25"
 ).bind(order.external_order_id).all<Record<string,unknown>>();
 const receiptRows=events.results??[];
 const matched=receiptRows.filter(e=>e.has_recorded_digest===1&&
   e.network===order.network&&e.tx_hash===order.tx_hash).length;
 const credit=order.product_type==="credits"?
  await env.DB.prepare(
    "SELECT o.status,o.credited_at,"+
    "(SELECT COUNT(*) FROM credit_ledger l WHERE l.reference_id=o.id AND l.kind='purchase_grant') ledger_grants,"+
    "(SELECT COUNT(*) FROM credit_batches cb WHERE cb.source_order_id=o.id AND cb.source_kind='purchase') batch_grants "+
    "FROM recharge_orders o WHERE o.id=? AND o.user_id=?"
  ).bind(order.credit_order_id,order.user_id).first():null;
 const subscription=order.product_type==="subscription"?
  await env.DB.prepare(
    "SELECT o.status,o.paid_at,o.applied_at,"+
    "(SELECT COUNT(*) FROM subscription_periods p WHERE p.source_order_id=o.id) period_count,"+
    "(SELECT COUNT(*) FROM subscription_tier_changes t WHERE t.order_id=o.id) upgrade_count "+
    "FROM subscription_orders o WHERE o.id=? AND o.user_id=?"
  ).bind(order.subscription_order_id,order.user_id).first():null;
 return response({order,providerEvents:receiptRows,matchedRecordedReceipts:matched,
  entitlement:{kind:order.product_type,credit,subscription},
  evidenceLimit:25,readOnly:true,
  note:"Historical database evidence only. No independent on-chain verification or settlement is performed."},200,env,request);
}
