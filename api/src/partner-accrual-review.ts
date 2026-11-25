import type {Env} from "./types";
import {ApiFailure} from "./types";
import {requireAdminSession} from "./admin-auth";
import {jsonBody,nowMs} from "./security";
import {response} from "./http";
import {paymentEvidencePlan,classifyPaymentEvidence} from "./partner-payment-proof.mjs";
import {accrualEnqueuePlan,recoveryFailurePlan} from "./partner-recovery.mjs";
import {attributionPlan,reviewedFacts,reviewedAccrualBatch} from "./partner-accrual-review.mjs";
import {accrualSnapshot,accrualApprovalPlan} from "./partner-accrual-approval.mjs";

// Pilot only: no production execution even if a flag is misconfigured.
// Explicit runtime binding AND DB switch are required. No live activation here.
export async function adminPartnerAccrualReview(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env,true);
 if(!['development','staging'].includes(env.ENVIRONMENT)||env.PARTNER_ACCRUAL_REVIEW_ENABLED!=='1')
 throw new ApiFailure(404,'NOT_FOUND','功能未开放。');
 const gate=await env.DB.prepare("SELECT COUNT(*) n FROM system_settings WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled','partner_accrual_review_enabled') AND value='1'").first<{n:number}>();
 if(gate?.n!==3)throw new ApiFailure(409,'PARTNER_ACCRUAL_DISABLED','计佣测试尚未启用。');
 const b=await jsonBody(request,2048);
 if(Object.keys(b).some(k=>!['domain','orderId','action','operationId','reason','riskReviewed'].includes(k))||
 !['recharge','subscription'].includes(String(b.domain))||typeof b.orderId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.orderId)||
 !['enqueue','record','approve_for_queue'].includes(String(b.action))||typeof b.operationId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(b.operationId)||
 typeof b.reason!=='string'||b.reason.trim().length<8||b.reason.trim().length>500||b.riskReviewed!==true)
 throw new ApiFailure(400,'PARTNER_ACCRUAL_INVALID','订单、人工复核或操作参数无效。');
 const domain=String(b.domain),orderId=b.orderId,now=nowMs();
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
