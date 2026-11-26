import type {Env} from "./types";
import {ApiFailure} from "./types";
import {requireAdminSession} from "./admin-auth";
import {response} from "./http";
import {paymentEvidencePlan,classifyPaymentEvidence} from "./partner-payment-proof.mjs";
import {commissionFen,termEnd} from "./partner-ledger.mjs";

// Exact order lookup, read-only. No runtime payment-path overhead and no
// automatic cash entitlement. Do not enable against unreviewed remote schema.
export async function adminPartnerOrderPreview(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 const gate=await env.DB.prepare("SELECT value FROM system_settings WHERE key='partner_order_preview_enabled'").first<{value:string}>();
 if(gate?.value!=='1')return response({enabled:false},200,env,request);
 const query=new URL(request.url).searchParams,domain=query.get('domain')||'',id=query.get('id')||'';
 if(!['recharge','subscription'].includes(domain)||! /^[A-Za-z0-9_-]{1,80}$/.test(id))throw new ApiFailure(400,'INVALID_REQUEST','订单参数无效。');
 const plan=paymentEvidencePlan(domain,id);
 const result=await env.DB.prepare(plan.sql).bind(...plan.params).all<{buyer_id:string;paid_at:number}>();
 const evidence=classifyPaymentEvidence(domain,result.results);
 if(!evidence.eligible||!('principalFen' in evidence)||!('refundedPrincipalFen' in evidence))return response({enabled:true,evidence},200,env,request);
 const row=result.results[0];
 const attribution=await env.DB.prepare(`SELECT r.inviter_user_id,r.registered_at,p.version,p.status,p.rate_bps,p.term_months,
 (SELECT MIN(v.effective_at) FROM partner_policy_versions v WHERE v.user_id=p.user_id AND v.status='active') first_authorized_at
 FROM referral_invites r JOIN partner_policy_versions p ON p.user_id=r.inviter_user_id
 JOIN users u ON u.id=r.inviter_user_id JOIN users b ON b.id=r.invited_user_id
 WHERE r.invited_user_id=? AND r.registered_at<=? AND r.inviter_user_id<>r.invited_user_id
 AND p.effective_at<=? AND u.role='user' AND b.role='user' AND u.status='active' AND b.status='active'
 AND u.is_test_account=0 AND b.is_test_account=0 AND u.archived_at IS NULL AND b.archived_at IS NULL
 AND u.email_verified_at IS NOT NULL AND b.email_verified_at IS NOT NULL
 ORDER BY p.version DESC LIMIT 1`).bind(row.buyer_id,row.paid_at,row.paid_at).first<{inviter_user_id:string;registered_at:number;version:number;status:string;rate_bps:number;term_months:number|null;first_authorized_at:number|null}>();
 const a=attribution;
 const policyEligible=!!a&&a.status==='active'&&a.first_authorized_at!==null&&
 (a.term_months===null||row.paid_at<termEnd(Math.max(a.registered_at,a.first_authorized_at),a.term_months));
 const candidateFen=policyEligible&&a?commissionFen(evidence.principalFen!-evidence.refundedPrincipalFen!,a.rate_bps):null;
 return response({enabled:true,evidence,policyEligible,candidateFen,policyVersion:policyEligible?a?.version:null,
 basis:'unapproved_product_principal',accrual:false},200,env,request);
}
