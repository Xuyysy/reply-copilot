import type {Env} from "./types";
import {ApiFailure} from "./types";
import {boltReadSchemaReady} from "./boltutil/environment";
import {manualCandidatePlan,manualEvidenceBatchPlan,manualOrderEstimate,requestableFen} from "./partner-manual-calculation.mjs";
type Domain="recharge"|"subscription";
type Dirty={domain:Domain;order_id:string;token:string;buyer_id:string};
type Candidate={order_id:string;buyer_id:string;paid_at:number;registered_at:number;version:number;status:string;rate_bps:number;term_months:number|null;first_authorized_at:number;buyer_eligible:number;payment_source:'fiat'|'boltutil'};
type Entry={domain:Domain;orderId:string;buyerId:string;paidAt:number;rateBps:number;state:string;principalFen:number|null;commissionFen:number|null;reason:string|null};
export const COMMISSION_SYNC_LIMIT=20;
export async function commissionLedgerEnabled(env:Env){
 const enabled=(await env.DB.prepare("SELECT value FROM system_settings WHERE key='partner_commission_ledger_enabled'").first<{value:string}>())?.value==='1';
 if(enabled&&!boltReadSchemaReady(env))throw new ApiFailure(503,"PARTNER_LEDGER_UNAVAILABLE","支付数据库尚未就绪，暂不能结算。");
 return enabled;
}
export function parseCommissionCursor(value:string|null){
 if(value===null)return null;
 const parts=value.split(":");
 const paidAt=Number(parts[0]);
 if(parts.length!==3||!Number.isSafeInteger(paidAt)||paidAt<0||String(paidAt)!==parts[0]||!['recharge','subscription'].includes(parts[1])||!/^[A-Za-z0-9_-]{1,80}$/.test(parts[2]))throw new ApiFailure(400,"INVALID_REQUEST","无效的订单分页参数。");
 return {paidAt,domain:parts[1],orderId:parts[2]};
}
export async function syncCommissionLedger(env:Env,userId:string){
 // GETs are read-only. Explicit authorized POST refresh drains a bounded
 // queue; no provider request, no cron, no scan of already processed orders.
 const dirty=(await env.DB.prepare(`SELECT q.domain,q.order_id,q.token,
 CASE WHEN q.domain='recharge' THEN (SELECT user_id FROM recharge_orders WHERE id=q.order_id)
 ELSE (SELECT user_id FROM subscription_orders WHERE id=q.order_id) END buyer_id
 FROM partner_commission_dirty q WHERE q.partner_user_id=? ORDER BY q.domain,q.order_id LIMIT ?`).bind(userId,COMMISSION_SYNC_LIMIT).all<Dirty>()).results;
 if(!dirty.length)return;
 const boltReady=boltReadSchemaReady(env);
 const estimates=new Map<string,Entry>();
 for(const domain of ["recharge","subscription"] as Domain[]){
  const jobs=dirty.filter(q=>q.domain===domain);
  if(!jobs.length)continue;
  const p=manualCandidatePlan(domain,userId,boltReady,jobs.map(x=>x.order_id));
  const candidates=(await env.DB.prepare(p.sql).bind(...p.params).all<Candidate>()).results;
  for(const source of ["fiat","boltutil"] as const){
   const group=candidates.filter(c=>c.payment_source===source);
   if(!group.length)continue;
   // Crypto schema must be ready for ledger activation. Keep a crypto order
   // pending if readiness is lost rather than silently dropping its value.
   if(source==="boltutil"&&!boltReady)throw new ApiFailure(503,"PARTNER_LEDGER_UNAVAILABLE","支付记录暂不可核实，请稍后刷新。");
   const plan=manualEvidenceBatchPlan(domain,group.map(x=>x.order_id),source==="boltutil");
   const evidence=(await env.DB.prepare(plan.sql).bind(...plan.params).all<Record<string,unknown>>()).results;
   if(evidence.length>=121)throw new ApiFailure(409,"PARTNER_LEDGER_EVIDENCE_LIMIT","支付证据异常，请联系管理员。");
   const byOrder=new Map<unknown,Record<string,unknown>[]>();
   for(const e of evidence){const rows=byOrder.get(e.order_id);if(rows)rows.push(e);else byOrder.set(e.order_id,[e]);}
   for(const c of group){
    const e=manualOrderEstimate(domain,c,byOrder.get(c.order_id)??[]);
    if(e)estimates.set(domain+":"+c.order_id,e as Entry);
   }
  }
 }
 // One guarded statement per dirty item; trigger atomically updates the
 // aggregate and acknowledges the exact token. A payment/risk change during
 // verification rotates the token; stale processors then do nothing.
 await env.DB.batch(dirty.map(q=>{
  const e=estimates.get(q.domain+":"+q.order_id);
  if(!q.buyer_id)throw new ApiFailure(409,"PARTNER_LEDGER_EVIDENCE_MISSING","原始订单不存在，请联系管理员。");
  return env.DB.prepare(`INSERT INTO partner_commission_entries(domain,order_id,partner_user_id,buyer_user_id,paid_at,rate_bps,state,principal_fen,commission_fen,reason,source_token)
 SELECT domain,order_id,partner_user_id,?,?,?,?,?,?,?,token FROM partner_commission_dirty
 WHERE domain=? AND order_id=? AND partner_user_id=? AND token=?
 AND (SELECT value FROM system_settings WHERE key='partner_commission_ledger_enabled')='1'
 ON CONFLICT(domain,order_id) DO UPDATE SET paid_at=excluded.paid_at,rate_bps=excluded.rate_bps,state=excluded.state,principal_fen=excluded.principal_fen,commission_fen=excluded.commission_fen,reason=excluded.reason,source_token=excluded.source_token`)
 .bind(q.buyer_id,e?.paidAt??0,e?.rateBps??0,e?.state??'excluded',e?.principalFen??null,e?.commissionFen??null,e?.reason??null,q.domain,q.order_id,userId,q.token);
 }));
}
export async function ledgerBalance(env:Env,userId:string){
 const totals=await env.DB.prepare(`SELECT COALESCE(t.earned_fen,0) earned,COALESCE(t.settled_fen,0) settled,COALESCE(t.verified_count,0) verified,COALESCE(t.review_count,0) review,
 EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.partner_user_id=u.id) dirty,
 (SELECT id FROM partner_manual_requests r WHERE r.partner_user_id=u.id AND r.status='pending') pendingId,
 CASE WHEN ?='staging' AND EXISTS(SELECT 1 FROM system_settings s WHERE s.key='partner_staging_min_request_user' AND s.value=u.id AND s.updated_at>CAST(unixepoch('now') AS INTEGER)*1000) THEN 200 ELSE 1000 END minRequestFen
 FROM users u LEFT JOIN partner_commission_totals t ON t.partner_user_id=u.id WHERE u.id=?`).bind(env.ENVIRONMENT,userId).first<{earned:number;settled:number;verified:number;review:number;dirty:number;pendingId:string|null;minRequestFen:number}>();
 if(!totals)throw new ApiFailure(404,"USER_NOT_FOUND","账户不存在。");
 const complete=totals.dirty===0;
 const summary={verifiedOrders:totals.verified,reviewCount:totals.review,estimatedFen:complete?totals.earned:null,recordedFen:totals.settled,differenceFen:complete?totals.earned-totals.settled:null,complete};
 return {summary,requestableFen:requestableFen(summary,!!totals.pendingId,totals.minRequestFen),minRequestFen:totals.minRequestFen,pendingId:totals.pendingId,syncPending:!complete};
}
export async function ledgerReport(env:Env,userId:string,admin:boolean,cursor:string|null){
 const before=parseCommissionCursor(cursor);
 const pageGuard=before?" AND (paid_at,domain,order_id)<(?,?,?)":"";
 const [balance,records,page]=await Promise.all([
  ledgerBalance(env,userId),
  env.DB.prepare("SELECT id,amount_fen,status,created_at,resolved_at"+(admin?",reason":"")+" FROM partner_manual_requests WHERE partner_user_id=? ORDER BY created_at DESC,id DESC LIMIT 30").bind(userId).all(),
  env.DB.prepare("SELECT domain,order_id orderId,paid_at paidAt,rate_bps rateBps,state,principal_fen principalFen,commission_fen commissionFen"+(admin?",buyer_user_id buyerId,reason":"")+" FROM partner_commission_entries WHERE partner_user_id=? AND state<>'excluded'"+pageGuard+" ORDER BY paid_at DESC,domain DESC,order_id DESC LIMIT 31").bind(userId,...(before?[before.paidAt,before.domain,before.orderId]:[])).all<Entry>()
 ]);
 const orders=page.results.slice(0,30),last=orders.at(-1);
 return {enabled:true,ledgerEnabled:true,...balance,orders,records:records.results,nextCursor:page.results.length>30&&last?last.paidAt+":"+last.domain+":"+last.orderId:null};
}
export async function checkLedgerSettlement(env:Env,userId:string,requestId:string){
 const row=await env.DB.prepare(`SELECT 1 FROM partner_manual_requests r JOIN users u ON u.id=r.partner_user_id JOIN partner_commission_totals t ON t.partner_user_id=r.partner_user_id
 WHERE r.id=? AND r.partner_user_id=? AND r.status='pending' AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0
 AND t.earned_fen-t.settled_fen>=r.amount_fen AND NOT EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.partner_user_id=r.partner_user_id)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled','partner_commission_ledger_enabled') AND value='1')=3`).bind(requestId,userId).first();
 return !!row;
}
