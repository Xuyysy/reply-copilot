import type {Env} from "./types";
import {ApiFailure} from "./types";
import {sessionFor,requireCsrf} from "./auth";
import {requireAdminSession} from "./admin-auth";
import {response} from "./http";
import {jsonBody,nowMs} from "./security";
import {payoutEnabled,recipientReady,verifiedRecipientVersion} from "./partner-payout";
import {boltReadSchemaReady} from "./boltutil/environment";
import {commissionLedgerEnabled,ledgerReport,ledgerBalance,syncCommissionLedger,checkLedgerSettlement} from "./partner-commission-ledger";
import {REPORT_LIMIT,manualCandidatePlan,manualEvidenceBatchPlan,manualOrderEstimate,summarizeManualOrders,requestableFen,candidateInTerm,MIN_REQUEST_FEN} from "./partner-manual-calculation.mjs";

type Candidate={order_id:string;buyer_id:string;paid_at:number;registered_at:number;version:number;status:string;rate_bps:number;term_months:number|null;first_authorized_at:number;buyer_eligible:number;payment_source:'fiat'|'boltutil'};
type Domain="recharge"|"subscription";
async function enabled(env:Env){
 const row=await env.DB.prepare("SELECT COUNT(*) n FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1'").first<{n:number}>();
 return row?.n===2;
}
async function assigned(env:Env,userId:string){
 return !!await env.DB.prepare("SELECT 1 FROM partner_policy_versions WHERE user_id=? AND effective_at<=? LIMIT 1").bind(userId,nowMs()).first();
}
async function legacyReport(env:Env,userId:string,admin:boolean){
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
 const payout=await payoutEnabled(env),ready=!payout||await recipientReady(env,userId);
 const latest=orders.sort((a,b)=>b.paidAt-a.paidAt||a.domain.localeCompare(b.domain)||a.orderId.localeCompare(b.orderId)).slice(0,30);
 return {enabled:true,summary,minRequestFen:MIN_REQUEST_FEN,requestableFen:ready?requestableFen(summary,!!pending):null,...(payout?{payoutProfileRequired:true,recipientReady:ready}:{}),pendingId:pending?.id??null,orders:latest.map(o=>admin?o:{domain:o.domain,orderId:o.orderId,paidAt:o.paidAt,rateBps:o.rateBps,state:o.state,principalFen:o.principalFen,commissionFen:o.commissionFen}),records:records.results};
}
async function report(env:Env,userId:string,admin:boolean,ledger:boolean,cursor:string|null=null){
 if(!ledger){if(cursor!==null)throw new ApiFailure(400,"INVALID_REQUEST","订单分页尚未开放。");return {...await legacyReport(env,userId,admin),ledgerEnabled:false,syncPending:false,nextCursor:null};}
 const r=await ledgerReport(env,userId,admin,cursor);
 const payout=await payoutEnabled(env),ready=!payout||await recipientReady(env,userId);
 return {...r,requestableFen:ready?r.requestableFen:null,...(payout?{payoutProfileRequired:true,recipientReady:ready}:{})};
}
export async function myManualPartnerReport(request:Request,env:Env){
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=="web")throw new ApiFailure(403,"FORBIDDEN","请使用网页登录账户。");
 const write=request.method==="POST";
 if(write)await requireCsrf(request,env,token);
 if(!await enabled(env)){
  if(write)throw new ApiFailure(409,"PARTNER_PROGRAM_DISABLED","人工结算暂未开放。");
  return response({enabled:false},200,env,request);
 }
 const user=await env.DB.prepare("SELECT 1 FROM users WHERE id=? AND role='user' AND status='active' AND email_verified_at IS NOT NULL AND archived_at IS NULL AND is_test_account=0").bind(session.user_id).first();
 if(!user||!await assigned(env,session.user_id)){
  if(write)throw new ApiFailure(403,"FORBIDDEN","当前账户未获得推广资格。");
  return response({enabled:false},200,env,request);
 }
 const ledger=await commissionLedgerEnabled(env);
 if(!write)return response(await report(env,session.user_id,false,ledger,new URL(request.url).searchParams.get("cursor")),200,env,request);
 const body=await jsonBody(request,4096);
 if(Object.keys(body).length===1&&body.sync===true){
  if(!ledger)throw new ApiFailure(409,"PARTNER_LEDGER_DISABLED","账本尚未开放。");
  await syncCommissionLedger(env,session.user_id);
  return response(await report(env,session.user_id,false,true),200,env,request);
 }
 // A settlement submission needs only the balance, not a history page.
 const current=ledger?await (async()=>{
  const balance=await ledgerBalance(env,session.user_id),payout=await payoutEnabled(env),ready=!payout||await recipientReady(env,session.user_id);
  return {...balance,requestableFen:ready?balance.requestableFen:null,payoutProfileRequired:payout};
 })():await legacyReport(env,session.user_id,false);
 const amount=current.requestableFen;
 if(Object.keys(body).length!==1||!Number.isSafeInteger(body.expectedAmountFen)||amount===null||body.expectedAmountFen!==amount||amount>1000000000000)
  throw new ApiFailure(409,"PARTNER_REQUEST_UNAVAILABLE","未达到10元、已有申请或金额已变化，请刷新后重试。");
 // Only a valid submission authenticates the encrypted recipient. Bind its
 // verified version in the same guarded INSERT so a concurrent edit cannot
 // switch the account between validation and the trigger's snapshot.
 const recipientVersion=current.payoutProfileRequired?await verifiedRecipientVersion(env,session.user_id):null;
 if(current.payoutProfileRequired&&recipientVersion===null)throw new ApiFailure(409,"PAYOUT_NOT_CONFIGURED","收款资料无法核实，请重新填写后再申请。");
 const recipientGuard=current.payoutProfileRequired?" AND (SELECT MAX(version) FROM partner_payout_profiles WHERE user_id=?)=?":"";
 const recipientParams=current.payoutProfileRequired?[session.user_id,recipientVersion]:[];
 const ledgerGuard=ledger?" AND NOT EXISTS(SELECT 1 FROM partner_commission_dirty WHERE partner_user_id=?) AND COALESCE((SELECT earned_fen-settled_fen FROM partner_commission_totals WHERE partner_user_id=?),0)=?":"";
 const ledgerParams=ledger?[session.user_id,session.user_id,amount]:[];
 const settledGuard=ledger?"COALESCE((SELECT settled_fen FROM partner_commission_totals WHERE partner_user_id=?),0)":"(SELECT COALESCE(SUM(amount_fen),0) FROM partner_manual_requests WHERE partner_user_id=? AND status='completed')";
 const now=nowMs();
 // This is an application for HUMAN reconciliation only, not a payment
 // instruction. Recheck completed sum, current membership and gates at insert.
 const result=await env.DB.prepare(`INSERT INTO partner_manual_requests(id,partner_user_id,amount_fen,created_at)
 SELECT ?,?,?,? WHERE
 EXISTS(SELECT 1 FROM users WHERE id=? AND role='user' AND status='active' AND email_verified_at IS NOT NULL AND archived_at IS NULL AND is_test_account=0)
 AND EXISTS(SELECT 1 FROM partner_policy_versions WHERE user_id=? AND effective_at<=?)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1')=2
 AND ${settledGuard}=?
 AND COALESCE((SELECT value FROM system_settings WHERE key='partner_commission_ledger_enabled'),'0')=?${ledgerGuard}
 AND COALESCE((SELECT value FROM system_settings WHERE key='partner_payout_profile_enabled'),'0')=?${recipientGuard}
 ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),session.user_id,amount,now,session.user_id,session.user_id,now,session.user_id,current.summary.recordedFen,ledger?'1':'0',...ledgerParams,current.payoutProfileRequired?'1':'0',...recipientParams).run();
 if(result.meta.changes!==1)throw new ApiFailure(409,"PARTNER_REQUEST_CONFLICT","申请状态已变化，请刷新。");
 return response({ok:true},200,env,request);
}
export async function adminManualPartnerReport(request:Request,env:Env){
 const write=request.method==="POST";
 const actor=await requireAdminSession(request,env,write);
 if(!await enabled(env)){
  if(write)throw new ApiFailure(409,"PARTNER_PROGRAM_DISABLED","人工结算记录尚未开放。");
  return response({enabled:false},200,env,request);
 }
 if(!write){
  const params=new URL(request.url).searchParams;
  const requestId=params.get("requestId");
  if(requestId!==null){
   if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new ApiFailure(400,"INVALID_REQUEST","申请标识无效。");
   if(!await commissionLedgerEnabled(env))return response({ledgerEnabled:false,settlementReady:null},200,env,request);
   const r=await env.DB.prepare("SELECT partner_user_id FROM partner_manual_requests WHERE id=? AND status='pending'").bind(requestId).first<{partner_user_id:string}>();
   return response({ledgerEnabled:true,settlementReady:!!r&&await checkLedgerSettlement(env,r.partner_user_id,requestId)},200,env,request);
  }
  const userId=params.get("userId")||"";
  if(!userId){
   const payout=await payoutEnabled(env);
   const queue=await env.DB.prepare("SELECT r.id,r.partner_user_id,r.amount_fen,r.created_at,u.email"+(payout?",EXISTS(SELECT 1 FROM partner_request_recipients s WHERE s.request_id=r.id) recipient_available":"")+" FROM partner_manual_requests r JOIN users u ON u.id=r.partner_user_id WHERE r.status='pending' ORDER BY r.created_at,r.id LIMIT 50").all();
   return response({enabled:true,queue:queue.results,ledgerEnabled:await commissionLedgerEnabled(env),...(payout?{payoutProfileEnabled:true}:{})},200,env,request);
  }
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(userId))throw new ApiFailure(400,"INVALID_REQUEST","用户标识无效。");
  if(!await assigned(env,userId))throw new ApiFailure(404,"USER_NOT_FOUND","尚未指定该推广伙伴。");
  return response(await report(env,userId,true,await commissionLedgerEnabled(env),params.get('cursor')),200,env,request);
 }
 const body=await jsonBody(request,4096);
 if(body.sync===true){
  if(Object.keys(body).sort().join(",")!=="operationId,sync,userId"||typeof body.userId!=="string"||!/^[A-Za-z0-9_-]{1,80}$/.test(body.userId)||typeof body.operationId!=="string"||!/^[a-f0-9-]{36}$/i.test(body.operationId))throw new ApiFailure(400,"INVALID_REQUEST","账本同步参数无效。");
  if(!await commissionLedgerEnabled(env)||!await assigned(env,body.userId))throw new ApiFailure(409,"PARTNER_LEDGER_DISABLED","账本或合伙人尚未开放。");
  await syncCommissionLedger(env,body.userId);
  return response(await report(env,body.userId,true,true),200,env,request);
 }
 const {requestId,action,operationId,reason}=body;
 if(Object.keys(body).sort().join(",")!=="action,operationId,reason,requestId"||
 typeof requestId!=="string"||! /^[a-f0-9-]{36}$/i.test(requestId)||
 typeof operationId!=="string"||! /^[a-f0-9-]{36}$/i.test(operationId)||
 (action!=="completed"&&action!=="rejected")||typeof reason!=="string"||reason.trim().length<8||reason.trim().length>500)
 throw new ApiFailure(400,"INVALID_REQUEST","申请处理参数无效。");
 if(action==="completed"&&await payoutEnabled(env)&&!await env.DB.prepare("SELECT 1 FROM partner_request_recipients WHERE request_id=?").bind(requestId).first())throw new ApiFailure(409,"PAYOUT_NOT_CONFIGURED","该申请没有收款资料快照，请核对后驳回并重新申请。");
 // Completion is solely the administrator's declaration that the external
 // transfer was already made. No provider calls, bank details or transfer.
 const result=await env.DB.prepare(`UPDATE partner_manual_requests SET status=?,resolved_at=?,resolved_by=?,reason=?
 WHERE id=? AND status='pending' AND partner_user_id<>?
 AND EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id WHERE a.id=1 AND a.user_id=? AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1')=2`).bind(action,nowMs(),actor.user_id,reason.trim(),requestId,actor.user_id,actor.user_id).run();
 if(result.meta.changes!==1)throw new ApiFailure(409,"PARTNER_REQUEST_CONFLICT","该申请已处理或状态变化，请刷新。");
 return response({ok:true},200,env,request);
}
