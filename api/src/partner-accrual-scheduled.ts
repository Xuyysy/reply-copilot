import type {Env} from "./types";
import {paymentEvidencePlan,classifyPaymentEvidence} from "./partner-payment-proof.mjs";
import {attributionPlan,reviewedFacts,reviewedAccrualBatch} from "./partner-accrual-review.mjs";
import {accrualSnapshot,approvedDuePlan,approvedAccrualBatch} from "./partner-accrual-approval.mjs";
import {recoveryFailurePlan} from "./partner-recovery.mjs";
type Approval={operation_id:string;order_domain:string;order_id:string;attempt:number;actor_id:string;reason:string;snapshot_sha256:string;approved_at:number;expires_at:number};
async function defer(env:Env,a:Approval,now:number,code:string,review:boolean){
 const p=recoveryFailurePlan({orderDomain:a.order_domain,orderId:a.order_id,attempts:a.attempt,now,code,review});
 p.sql+=" AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled','partner_accrual_review_enabled','partner_scheduled_accrual_enabled') AND value='1')=4";
 await env.DB.prepare(p.sql).bind(...p.params).run();
}
async function recordApproved(env:Env,a:Approval,now:number){
 if(now>=a.expires_at){await defer(env,a,now,'temporary_failure',false);return;}
 const p=paymentEvidencePlan(a.order_domain,a.order_id);
 const rows=(await env.DB.prepare(p.sql).bind(...p.params).all<Record<string,unknown>>()).results;
 const proof=classifyPaymentEvidence(a.order_domain,rows);
 if(!proof.eligible||!('paidAt' in proof)){await defer(env,a,now,'proof_missing',true);return;}
 const job=await env.DB.prepare(`SELECT j.*,w.hold_ms FROM partner_accrual_jobs j JOIN partner_accrual_windows w ON w.id=j.window_id
 WHERE j.order_domain=? AND j.order_id=?`).bind(a.order_domain,a.order_id).first<{state:string;attempts:number;paid_at:number;window_id:string;hold_ms:number;next_attempt_at:number}>();
 if(!job||job.state!=='pending'||job.attempts!==a.attempt||job.next_attempt_at>now)return;
 const q=attributionPlan(rows[0].buyer_id,proof.paidAt);
 const attribution=await env.DB.prepare(q.sql).bind(...q.params).first();
 const input=reviewedFacts({orderDomain:a.order_domain,orderId:a.order_id,rows,attribution,job,now});
 if(!input){await defer(env,a,now,'policy_review',true);return;}
 const digest=await accrualSnapshot(input,rows[0]);
 if(digest!==a.snapshot_sha256){await defer(env,a,now,'risk_review',true);return;}
 const work=reviewedAccrualBatch({input,row:rows[0],actorId:a.actor_id,operationId:a.operation_id,reason:a.reason});
 if(!work){await defer(env,a,now,'policy_review',true);return;}
 const batch=approvedAccrualBatch({approval:a,digest,work,now});
 if(!batch)return;
 await env.DB.batch(batch.map(p=>env.DB.prepare(p.sql).bind(...p.params)));
}
// No unattended fraud approval. Only explicitly reviewed per-order snapshots,
// with bounded execution, independent switches and no production path.
export async function scheduledPartnerAccrual(env:Env,now:number):Promise<void>{
 if(!['development','staging'].includes(env.ENVIRONMENT)||env.PARTNER_ACCRUAL_REVIEW_ENABLED!=='1'||env.PARTNER_SCHEDULED_ACCRUAL_ENABLED!=='1')return;
 try{
  const p=approvedDuePlan(now,2);
  const rows=(await env.DB.prepare(p.sql).bind(...p.params).all<Approval>()).results;
  for(const a of rows){
   try{await recordApproved(env,a,Date.now());}
   catch{
    // Re-read on a future explicit approval; avoid retrying stale attestation.
    try{await defer(env,a,Date.now(),'temporary_failure',false);}catch{}
    console.warn("PARTNER_APPROVED_ACCRUAL_FAILED");
   }
  }
 }catch{console.warn("PARTNER_ACCRUAL_SCHEDULER_FAILED");}
}
