import type {Env} from "./types";
import {ApiFailure} from "./types";
import {sessionFor} from "./auth";
import {requireAdminSession} from "./admin-auth";
import {response} from "./http";
import {jsonBody,nowMs} from "./security";
import {REPORT_LIMIT,manualCandidatePlan,manualEvidenceBatchPlan,manualOrderEstimate,summarizeManualOrders,parseManualRecord,candidateInTerm} from "./partner-manual-calculation.mjs";

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
 const [total,records]=await Promise.all([
  env.DB.prepare("SELECT COALESCE(SUM(amount_fen),0) total FROM partner_manual_records WHERE partner_user_id=?").bind(userId).first<{total:number}>(),
  env.DB.prepare("SELECT id,amount_fen,transferred_at"+(admin?",external_reference,reason":"")+" FROM partner_manual_records WHERE partner_user_id=? ORDER BY transferred_at DESC,id DESC LIMIT 30").bind(userId).all()
 ]);
 const summary=summarizeManualOrders(orders,Number(total?.total??0),complete);
 const latest=orders.sort((a,b)=>b.paidAt-a.paidAt||a.domain.localeCompare(b.domain)||a.orderId.localeCompare(b.orderId)).slice(0,30);
 return {enabled:true,summary,orders:latest.map(o=>admin?o:{domain:o.domain,orderId:o.orderId,paidAt:o.paidAt,rateBps:o.rateBps,state:o.state,principalFen:o.principalFen,commissionFen:o.commissionFen}),records:records.results};
}
export async function myManualPartnerReport(request:Request,env:Env){
 const {session}=await sessionFor(request,env);
 if(session.kind!=="web")throw new ApiFailure(403,"FORBIDDEN","请使用网页登录账户。");
 if(!await enabled(env))return response({enabled:false},200,env,request);
 const user=await env.DB.prepare("SELECT 1 FROM users WHERE id=? AND role='user' AND status='active' AND email_verified_at IS NOT NULL AND archived_at IS NULL AND is_test_account=0").bind(session.user_id).first();
 if(!user||!await assigned(env,session.user_id))return response({enabled:false},200,env,request);
 return response(await report(env,session.user_id,false),200,env,request);
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
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(userId))throw new ApiFailure(400,"INVALID_REQUEST","用户标识无效。");
  if(!await assigned(env,userId))throw new ApiFailure(404,"USER_NOT_FOUND","尚未指定该推广伙伴。");
  return response(await report(env,userId,true),200,env,request);
 }
 const now=nowMs();
 let p;
 try{p=parseManualRecord(await jsonBody(request,4096),now);}catch{throw new ApiFailure(400,"INVALID_REQUEST","人工转账记录参数无效。");}
 if(p.userId===actor.user_id)throw new ApiFailure(400,"INVALID_REQUEST","不能登记本人。");
 // Bookkeeping of an already completed external transfer, never approval,
 // allocation of available funds, or a payment instruction. Singleton admin
 // and both feature switches rechecked in the same statement.
 const result=await env.DB.prepare(`INSERT INTO partner_manual_records(id,partner_user_id,amount_fen,transferred_at,external_reference,reason,recorded_by,created_at)
 SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM partner_policy_versions WHERE user_id=? AND effective_at<=?)
 AND EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id WHERE a.id=1 AND a.user_id=? AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1')=2
 ON CONFLICT DO NOTHING`).bind(p.operationId,p.userId,p.amountFen,p.transferredAt,p.reference,p.reason,actor.user_id,now,p.userId,now,actor.user_id).run();
 if(result.meta.changes!==1)throw new ApiFailure(409,"PARTNER_RECORD_CONFLICT","记录编号重复或资格已变化，请重新查询。");
 return response({ok:true},200,env,request);
}
