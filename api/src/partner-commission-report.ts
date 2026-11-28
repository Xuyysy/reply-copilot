import type {Env} from "./types";
import {boltReadSchemaReady} from "./boltutil/environment";
import {REPORT_LIMIT,manualCandidatePlan,manualEvidenceBatchPlan,manualOrderEstimate,summarizeManualOrders,requestableFen,candidateInTerm,MIN_REQUEST_FEN} from "./partner-manual-calculation.mjs";
type Candidate={order_id:string;buyer_id:string;paid_at:number;registered_at:number;version:number;status:string;rate_bps:number;term_months:number|null;first_authorized_at:number;buyer_eligible:number;payment_source:'fiat'|'boltutil'};
type Domain="recharge"|"subscription";
export async function partnerCommissionReport(env:Env,userId:string,admin:boolean){
 let complete=true;
 const orders=[],boltReady=boltReadSchemaReady(env);
 for(const domain of ["recharge","subscription"] as Domain[]){
  const p=manualCandidatePlan(domain,userId,boltReady);
  const found=(await env.DB.prepare(p.sql).bind(...p.params).all<Candidate>()).results;
  if(found.length>REPORT_LIMIT)complete=false;
  const candidates=found.slice(0,REPORT_LIMIT).filter(candidateInTerm);
  // Partition by persisted rail; no second evidence query for fiat-only reports,
  // never reference crypto tables until the existing schema readiness gate is on.
  for(const source of ['fiat','boltutil'] as const){
   const group=candidates.filter(c=>c.payment_source===source);
   for(let i=0;i<group.length;i+=40){
    const chunk=group.slice(i,i+40);
    const plan=source==='boltutil'&&!boltReady?null:manualEvidenceBatchPlan(domain,chunk.map(x=>x.order_id),source==='boltutil');
    const evidence=plan?(await env.DB.prepare(plan.sql).bind(...plan.params).all<Record<string,unknown>>()).results:[];
    if(evidence.length>=121)complete=false;
    const byOrder=new Map<unknown,Record<string,unknown>[]>();
    for(const e of evidence){const rows=byOrder.get(e.order_id);if(rows)rows.push(e);else byOrder.set(e.order_id,[e]);}
    for(const c of chunk){
     const estimate=manualOrderEstimate(domain,c,byOrder.get(c.order_id)??[]);
     if(estimate)orders.push(estimate);
    }
   }
  }
 }
 const [total,records,pending]=await Promise.all([
  env.DB.prepare("SELECT COALESCE(SUM(amount_fen),0) total FROM partner_manual_requests WHERE partner_user_id=? AND status='completed'").bind(userId).first<{total:number}>(),
  env.DB.prepare("SELECT id,amount_fen,status,created_at,resolved_at"+(admin?",reason":"")+" FROM partner_manual_requests WHERE partner_user_id=? ORDER BY created_at DESC,id DESC LIMIT 30").bind(userId).all(),
  env.DB.prepare("SELECT id FROM partner_manual_requests WHERE partner_user_id=? AND status='pending'").bind(userId).first<{id:string}>()
 ]);
 const summary=summarizeManualOrders(orders,Number(total?.total??0),complete);
 const latest=orders.sort((a,b)=>b.paidAt-a.paidAt||a.domain.localeCompare(b.domain)||a.orderId.localeCompare(b.orderId)).slice(0,30);
 return {enabled:true,summary,minRequestFen:MIN_REQUEST_FEN,requestableFen:requestableFen(summary,!!pending),pendingId:pending?.id??null,orders:latest.map(o=>admin?o:{domain:o.domain,orderId:o.orderId,paidAt:o.paidAt,rateBps:o.rateBps,state:o.state,principalFen:o.principalFen,commissionFen:o.commissionFen,refundedPrincipalFen:o.refundedPrincipalFen}),records:records.results};
}

/** Recheck before external transfer, never block recording a transfer
 * already made. No payment provider calls. */
export async function checkPendingSettlement(env:Env,userId:string,requestId:string){
 const request=await env.DB.prepare("SELECT r.amount_fen FROM partner_manual_requests r JOIN users u ON u.id=r.partner_user_id WHERE r.id=? AND r.partner_user_id=? AND r.status='pending' AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1')=2").bind(requestId,userId).first<{amount_fen:number}>();
 if(!request)return false;
 const report=await partnerCommissionReport(env,userId,false);
 return report.pendingId===requestId&&report.summary.complete&&report.summary.differenceFen!==null&&report.summary.differenceFen>=request.amount_fen;
}
