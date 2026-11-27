import type {Env} from "./types";
import {ApiFailure} from "./types";
import {sessionFor,requireCsrf} from "./auth";
import {requireAdminSession} from "./admin-auth";
import {response} from "./http";
import {jsonBody,nowMs} from "./security";
import {REPORT_LIMIT,manualCandidatePlan,manualEvidenceBatchPlan,manualOrderEstimate,summarizeManualOrders,requestableFen,candidateInTerm,MIN_REQUEST_FEN} from "./partner-manual-calculation.mjs";

type Candidate={order_id:string;buyer_id:string;paid_at:number;registered_at:number;version:number;status:string;rate_bps:number;term_months:number|null;first_authorized_at:number;buyer_eligible:number};
type Domain="recharge"|"subscription";
async function enabled(env:Env){
 const row=await env.DB.prepare("SELECT COUNT(*) n FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1'").first<{n:number}>();
 return row?.n===2;
}
async function assigned(env:Env,userId:string){
 return !!await env.DB.prepare("SELECT 1 FROM partner_policy_versions WHERE user_id=? AND effective_at<=? LIMIT 1").bind(userId,nowMs()).first();
}
async function report(env:Env,userId:string,admin:boolean){
 let complete=true;
 const orders=[];
 for(const domain of ["recharge","subscription"] as Domain[]){
  const p=manualCandidatePlan(domain,userId);
  const found=(await env.DB.prepare(p.sql).bind(...p.params).all<Candidate>()).results;
  if(found.length>REPORT_LIMIT)complete=false;
  const candidates=found.slice(0,REPORT_LIMIT).filter(candidateInTerm);
  for(let i=0;i<candidates.length;i+=40){
   const chunk=candidates.slice(i,i+40),plan=manualEvidenceBatchPlan(domain,chunk.map(x=>x.order_id));
   const evidence=(await env.DB.prepare(plan.sql).bind(...plan.params).all<Record<string,unknown>>()).results;
   if(evidence.length>=121)complete=false;
   for(const c of chunk){
    const estimate=manualOrderEstimate(domain,c,evidence.filter(e=>e.order_id===c.order_id));
    if(estimate)orders.push(estimate);
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
 return {enabled:true,summary,minRequestFen:MIN_REQUEST_FEN,requestableFen:requestableFen(summary,!!pending),pendingId:pending?.id??null,orders:latest.map(o=>admin?o:{domain:o.domain,orderId:o.orderId,paidAt:o.paidAt,rateBps:o.rateBps,state:o.state,principalFen:o.principalFen,commissionFen:o.commissionFen}),records:records.results};
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
 const current=await report(env,session.user_id,false);
 if(!write)return response(current,200,env,request);
 const body=await jsonBody(request,4096);
 const amount=current.requestableFen;
 if(Object.keys(body).length!==1||!Number.isSafeInteger(body.expectedAmountFen)||amount===null||body.expectedAmountFen!==amount||amount>1000000000000)
  throw new ApiFailure(409,"PARTNER_REQUEST_UNAVAILABLE","未达到10元、已有申请或金额已变化，请刷新后重试。");
 const now=nowMs();
 // This is an application for HUMAN reconciliation only, not a payment
 // instruction. Recheck completed sum, current membership and gates at insert.
 const result=await env.DB.prepare(`INSERT INTO partner_manual_requests(id,partner_user_id,amount_fen,created_at)
 SELECT ?,?,?,? WHERE
 EXISTS(SELECT 1 FROM users WHERE id=? AND role='user' AND status='active' AND email_verified_at IS NOT NULL AND archived_at IS NULL AND is_test_account=0)
 AND EXISTS(SELECT 1 FROM partner_policy_versions WHERE user_id=? AND effective_at<=?)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1')=2
 AND (SELECT COALESCE(SUM(amount_fen),0) FROM partner_manual_requests WHERE partner_user_id=? AND status='completed')=?
 ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),session.user_id,amount,now,session.user_id,session.user_id,now,session.user_id,current.summary.recordedFen).run();
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
  const userId=new URL(request.url).searchParams.get("userId")||"";
  if(!userId){
   const queue=await env.DB.prepare("SELECT r.id,r.partner_user_id,r.amount_fen,r.created_at,u.email FROM partner_manual_requests r JOIN users u ON u.id=r.partner_user_id WHERE r.status='pending' ORDER BY r.created_at,r.id LIMIT 50").all();
   return response({enabled:true,queue:queue.results},200,env,request);
  }
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(userId))throw new ApiFailure(400,"INVALID_REQUEST","用户标识无效。");
  if(!await assigned(env,userId))throw new ApiFailure(404,"USER_NOT_FOUND","尚未指定该推广伙伴。");
  return response(await report(env,userId,true),200,env,request);
 }
 const body=await jsonBody(request,4096);
 const {requestId,action,operationId,reason}=body;
 if(Object.keys(body).sort().join(",")!=="action,operationId,reason,requestId"||
 typeof requestId!=="string"||! /^[a-f0-9-]{36}$/i.test(requestId)||
 typeof operationId!=="string"||! /^[a-f0-9-]{36}$/i.test(operationId)||
 (action!=="completed"&&action!=="rejected")||typeof reason!=="string"||reason.trim().length<8||reason.trim().length>500)
 throw new ApiFailure(400,"INVALID_REQUEST","申请处理参数无效。");
 // Completion is solely the administrator's declaration that the external
 // transfer was already made. No provider calls, bank details or transfer.
 const result=await env.DB.prepare(`UPDATE partner_manual_requests SET status=?,resolved_at=?,resolved_by=?,reason=?
 WHERE id=? AND status='pending' AND partner_user_id<>?
 AND EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id WHERE a.id=1 AND a.user_id=? AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1')=2`).bind(action,nowMs(),actor.user_id,reason.trim(),requestId,actor.user_id,actor.user_id).run();
 if(result.meta.changes!==1)throw new ApiFailure(409,"PARTNER_REQUEST_CONFLICT","该申请已处理或状态变化，请刷新。");
 return response({ok:true},200,env,request);
}
