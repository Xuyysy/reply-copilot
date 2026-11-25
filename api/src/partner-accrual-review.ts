import type {Env} from "./types";
import {ApiFailure} from "./types";
import {requireAdminSession} from "./admin-auth";
import {jsonBody,nowMs} from "./security";
import {response} from "./http";
import {paymentEvidencePlan,classifyPaymentEvidence} from "./partner-payment-proof.mjs";
import {accrualEnqueuePlan,recoveryFailurePlan} from "./partner-recovery.mjs";
import {attributionPlan,reviewedFacts,reviewedAccrualBatch} from "./partner-accrual-review.mjs";
import {accrualSnapshot,accrualApprovalPlan} from "./partner-accrual-approval.mjs";
import {accrualQueuePlan,reopenAccrualPlan} from "./partner-accrual-queue.mjs";
import {commissionFen,termEnd} from "./partner-ledger.mjs";

// Pilot only: no production execution even if a flag is misconfigured.
// Explicit runtime binding AND DB switch are required. No live activation here.
export async function adminPartnerAccrualReview(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env,request.method==="POST");
 if(!['development','staging'].includes(env.ENVIRONMENT)||env.PARTNER_ACCRUAL_REVIEW_ENABLED!=='1')
 throw new ApiFailure(404,'NOT_FOUND','功能未开放。');
 const gate=await env.DB.prepare("SELECT COUNT(*) n FROM system_settings WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled','partner_accrual_review_enabled') AND value='1'").first<{n:number}>();
 if(gate?.n!==3)throw new ApiFailure(409,'PARTNER_ACCRUAL_DISABLED','计佣测试尚未启用。');
 if(request.method==='GET'){
  const q=new URL(request.url).searchParams;
  if(q.get('action')==='inspect'){
   const domain=q.get('domain')||'',orderId=q.get('orderId')||'';
   if(!['recharge','subscription'].includes(domain)||!/^[A-Za-z0-9_-]{1,80}$/.test(orderId))throw new ApiFailure(400,'INVALID_REQUEST','订单参数无效。');
   const p=paymentEvidencePlan(domain,orderId);
   const rows=(await env.DB.prepare(p.sql).bind(...p.params).all<Record<string,unknown>>()).results;
   const proof=classifyPaymentEvidence(domain,rows);
   if(!proof.eligible||!('paidAt' in proof))return response({ok:false,reason:proof.reason},200,env,request);
   const job=await env.DB.prepare(`SELECT j.*,w.hold_ms FROM partner_accrual_jobs j JOIN partner_accrual_windows w ON w.id=j.window_id WHERE j.order_domain=? AND j.order_id=?`).bind(domain,orderId).first();
   const a=attributionPlan(rows[0].buyer_id,proof.paidAt);
   const attribution=await env.DB.prepare(a.sql).bind(...a.params).first();
   const input=reviewedFacts({orderDomain:domain,orderId,rows,attribution,job,now:nowMs()});
   if(!input)return response({ok:false,reason:'policy_review'},200,env,request);
   const f=input.facts;
   if(f.termMonths!==null&&f.paidAt>=termEnd(Math.max(f.registeredAt,f.firstAuthorizedAt),f.termMonths))return response({ok:false,reason:'term_expired'},200,env,request);
   const candidateFen=commissionFen(f.principalFen-input.refundPrincipalFen,f.rateBps);
   if(candidateFen===0)return response({ok:false,reason:'zero_commission'},200,env,request);
   return response({ok:true,snapshot:await accrualSnapshot(input,rows[0]),provider:rows[0].merchant_provider,principalFen:f.principalFen,refundedFen:input.refundPrincipalFen,rateBps:f.rateBps,candidateFen,policyVersion:f.policyVersion,holdUntil:f.holdUntil},200,env,request);
  }
  const state=q.get('state')||'pending';
  if(!['pending','review','done'].includes(state))throw new ApiFailure(400,'INVALID_REQUEST','队列状态无效。');
  const at=q.get('afterAt'),domain=q.get('afterDomain'),id=q.get('afterId');
  let cursor:null|{updatedAt:number;domain:string;orderId:string}=null;
  if(at!==null||domain!==null||id!==null){
   if(!at||!/^\d{1,16}$/.test(at)||!Number.isSafeInteger(Number(at))||Number(at)<=0||!domain||!['recharge','subscription'].includes(domain)||!id||!/^[A-Za-z0-9_-]{1,80}$/.test(id))throw new ApiFailure(400,'INVALID_REQUEST','分页参数无效。');
   cursor={updatedAt:Number(at),domain,orderId:id};
  }
  const p=accrualQueuePlan(state,30,cursor);
  const rows=(await env.DB.prepare(p.sql).bind(...p.params).all<{updated_at:number;order_domain:string;order_id:string}>()).results;
  const last=rows[rows.length-1];
  const next=rows.length===30&&last?{updatedAt:last.updated_at,domain:last.order_domain,orderId:last.order_id}:null;
  const scheduled=await env.DB.prepare("SELECT value FROM system_settings WHERE key='partner_scheduled_accrual_enabled'").first<{value:string}>();
  return response({ok:true,scheduled:env.PARTNER_SCHEDULED_ACCRUAL_ENABLED==='1'&&scheduled?.value==='1',rows,next},200,env,request);
 }
 const b=await jsonBody(request,2048);
 if(Object.keys(b).some(k=>!['domain','orderId','action','operationId','reason','riskReviewed','expectedSnapshot','attempt'].includes(k))||
 !['recharge','subscription'].includes(String(b.domain))||typeof b.orderId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.orderId)||
 !['enqueue','record','approve_for_queue','reopen'].includes(String(b.action))||typeof b.operationId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.operationId)||
 typeof b.reason!=='string'||b.reason.trim().length<8||b.reason.trim().length>500||b.riskReviewed!==true)
 throw new ApiFailure(400,'PARTNER_ACCRUAL_INVALID','订单、人工复核或操作参数无效。');
 const domain=String(b.domain),orderId=b.orderId,now=nowMs();
 if(b.action==='reopen'){
  if(typeof b.attempt!=='number'||!Number.isSafeInteger(b.attempt)||b.attempt<0||b.attempt>=19)throw new ApiFailure(400,'INVALID_REQUEST','重审次数无效。');
  const work=reopenAccrualPlan({domain,orderId,attempt:b.attempt,actorId:actor.user_id,operationId:b.operationId,reason:b.reason,now});
  try{await env.DB.batch(work.map(p=>env.DB.prepare(p.sql).bind(...p.params)));}catch{throw new ApiFailure(409,'PARTNER_ACCRUAL_CONFLICT','任务状态已变化，请刷新。');}
  return response({ok:true,state:'pending',pilot:true},200,env,request);
 }
 const plan=paymentEvidencePlan(domain,orderId);
 const rows=(await env.DB.prepare(plan.sql).bind(...plan.params).all<Record<string,unknown>>()).results;
 const proof=classifyPaymentEvidence(domain,rows);
 if(!proof.eligible||!('paidAt' in proof)||!('principalFen' in proof))
 return response({ok:false,reason:proof.reason},409,env,request);
 if(b.action==='enqueue'){
  const p=accrualEnqueuePlan({orderDomain:domain,orderId,paidAt:proof.paidAt,now});
  const r=await env.DB.prepare(p.sql).bind(...p.params).run();
  return response({ok:r.meta.changes===1,state:r.meta.changes===1?'pending':'not_enqueued'},r.meta.changes===1?200:409,env,request);
 }
 const job=await env.DB.prepare(`SELECT j.*,w.hold_ms FROM partner_accrual_jobs j JOIN partner_accrual_windows w ON w.id=j.window_id
 WHERE j.order_domain=? AND j.order_id=?`).bind(domain,orderId).first<{state:string;attempts:number;paid_at:number;window_id:string;hold_ms:number;next_attempt_at:number}>();
 if(!job||job.state!=='pending'||job.next_attempt_at>now)
 throw new ApiFailure(409,'PARTNER_ACCRUAL_CONFLICT','订单未进入可处理队列。');
 const a=attributionPlan(rows[0].buyer_id,proof.paidAt);
 const attribution=await env.DB.prepare(a.sql).bind(...a.params).first();
 const input=reviewedFacts({orderDomain:domain,orderId,rows,attribution,job,now});
 if(!input){
  const p=recoveryFailurePlan({orderDomain:domain,orderId,attempts:job.attempts,now,code:'policy_review',review:true});
  await env.DB.prepare(p.sql).bind(...p.params).run();
  return response({ok:false,state:'review'},409,env,request);
 }
 if(b.action==='approve_for_queue'){
  if(env.PARTNER_SCHEDULED_ACCRUAL_ENABLED!=='1')throw new ApiFailure(409,'PARTNER_ACCRUAL_DISABLED','后台计佣测试尚未开启。');
  const digest=await accrualSnapshot(input,rows[0]);
  if(b.expectedSnapshot!==digest)throw new ApiFailure(409,'PARTNER_ACCRUAL_CONFLICT','订单证据已变化，请重新核对。');
  const p=accrualApprovalPlan({input,digest,actorId:actor.user_id,operationId:b.operationId,reason:b.reason,now});
  const r=await env.DB.prepare(p.sql).bind(...p.params).run();
  return response({ok:r.meta.changes===1,state:r.meta.changes===1?'approved':'conflict',pilot:true},r.meta.changes===1?200:409,env,request);
 }
 const work=reviewedAccrualBatch({input,row:rows[0],actorId:actor.user_id,reason:b.reason,operationId:b.operationId});
 if(!work){
  const p=recoveryFailurePlan({orderDomain:domain,orderId,attempts:job.attempts,now,code:'policy_review',review:true});
  await env.DB.prepare(p.sql).bind(...p.params).run();
  return response({ok:false,state:'review'},409,env,request);
 }
 try{await env.DB.batch(work.map(p=>env.DB.prepare(p.sql).bind(...p.params)));}
 catch{throw new ApiFailure(409,'PARTNER_ACCRUAL_CONFLICT','证据或队列状态已变化，请重新核对。');}
 return response({ok:true,state:'done',pilot:true},200,env,request);
}
