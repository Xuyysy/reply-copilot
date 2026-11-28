import {paymentEvidencePlan,classifyPaymentEvidence} from './partner-payment-proof.mjs';
import {boltCommissionEvidencePlan,classifyBoltCommissionEvidence} from './partner-boltutil-proof.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const int=(x,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
export const REPORT_LIMIT=100;
export function manualCandidatePlan(domain,userId,boltReady=false,orderIds=null){
 if(!id(userId)||!['recharge','subscription'].includes(domain))throw new TypeError('PARTNER_REPORT_INVALID');
 if(orderIds!==null&&(!Array.isArray(orderIds)||!orderIds.length||orderIds.length>40||orderIds.some(x=>!id(x))||new Set(orderIds).size!==orderIds.length))throw new TypeError('PARTNER_REPORT_INVALID');
 const filter=orderIds?' AND o.id IN ('+orderIds.map(()=>'?').join(',')+')':'';
 const orders=domain==='recharge'?'recharge_orders':'subscription_orders';
 const boltJoin=boltReady?` LEFT JOIN boltutil_orders bo ON bo.${domain==='recharge'?'credit_order_id':'subscription_order_id'}=o.id`:'';
 const boltCondition=[...(domain==='recharge'?["o.payment_method='boltutil'"]:[]),...(boltReady?["bo.id IS NOT NULL"]:[])].join(' OR ')||'0';
 return {sql:`SELECT o.id order_id,o.user_id buyer_id,o.paid_at,r.registered_at,
  CASE WHEN ${boltCondition} THEN 'boltutil' ELSE 'fiat' END payment_source,
  p.version,p.status,p.rate_bps,p.term_months,
  (SELECT MIN(v.effective_at) FROM partner_policy_versions v WHERE v.user_id=p.user_id AND v.status='active') first_authorized_at,
  CASE WHEN b.role='user' AND b.status='active' AND b.is_test_account=0 AND b.archived_at IS NULL AND b.email_verified_at IS NOT NULL THEN 1 ELSE 0 END buyer_eligible
  FROM referral_invites r JOIN ${orders} o ON o.user_id=r.invited_user_id${boltJoin}
  JOIN users b ON b.id=r.invited_user_id
  JOIN partner_policy_versions p ON p.user_id=r.inviter_user_id AND p.version=(SELECT v.version FROM partner_policy_versions v WHERE v.user_id=r.inviter_user_id AND v.effective_at<=o.paid_at ORDER BY v.effective_at DESC LIMIT 1)
  WHERE r.inviter_user_id=? AND r.invited_user_id<>r.inviter_user_id AND o.paid_at>0 AND r.registered_at<=o.paid_at AND p.status='active'${filter}
  ORDER BY o.paid_at DESC,o.id DESC LIMIT ?`,params:[userId,...(orderIds??[]),REPORT_LIMIT+1]};
}
export function manualEvidenceBatchPlan(domain,ids,bolt=false){
 if(!Array.isArray(ids)||!ids.length||ids.length>40||ids.some(x=>!id(x))||new Set(ids).size!==ids.length)throw new TypeError('PARTNER_REPORT_INVALID');
 const base=bolt?boltCommissionEvidencePlan(domain,ids[0]):paymentEvidencePlan(domain,ids[0]);
 const tail='WHERE o.id=? LIMIT 2';
 if(!base.sql.endsWith(tail))throw new TypeError('PARTNER_REPORT_SCHEMA_CHANGED');
 // Bound result size. A row-limit hit invalidates totals rather than omitting duplicates.
 return {sql:base.sql.slice(0,-tail.length)+'WHERE o.id IN ('+ids.map(()=>'?').join(',')+') LIMIT 121',params:ids};
}
export function termEnd(start,months){
 if(!int(start,1,8640000000000000)||!int(months,1,120))throw new TypeError('PARTNER_REPORT_INVALID');
 const d=new Date(start),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
 const last=new Date(d);last.setUTCMonth(last.getUTCMonth()+1,0);d.setUTCDate(Math.min(day,last.getUTCDate()));
 return d.getTime();
}
export function commissionFen(principalFen,rateBps){
 if(!int(principalFen,0,1000000000000)||!int(rateBps,1,10000))throw new TypeError('PARTNER_REPORT_INVALID');
 return Number(BigInt(principalFen)*BigInt(rateBps)/10000n);
}
export function candidateInTerm(c){
 if(!int(c.paid_at,1)||!int(c.registered_at,1,c.paid_at)||!int(c.first_authorized_at,1,c.paid_at)||!int(c.rate_bps,1,10000))throw new TypeError('PARTNER_REPORT_INVALID');
 return c.term_months===null||c.paid_at<termEnd(Math.max(c.registered_at,c.first_authorized_at),c.term_months);
}
export function manualOrderEstimate(domain,c,rows){
 if(!candidateInTerm(c))return null;
 const review={domain,orderId:c.order_id,paidAt:c.paid_at,buyerId:c.buyer_id,rateBps:c.rate_bps,state:'review',reason:'evidence_requires_review',principalFen:null,commissionFen:null};
 if(c.buyer_eligible!==1||!Array.isArray(rows)||rows.some(r=>r.buyer_id!==c.buyer_id||r.order_id!==c.order_id||r.paid_at!==c.paid_at))return review;
 const e=c.payment_source==='boltutil'?classifyBoltCommissionEvidence(domain,rows):classifyPaymentEvidence(domain,rows);
 if(!e.eligible||!('principalFen' in e)||!('refundedPrincipalFen' in e))return {...review,reason:e.reason};
 // No automatic refund adjustments in this release. Flag affected orders for manual review.
 if(e.refundedPrincipalFen!==0)return {...review,reason:'refund_requires_manual_review'};
 const principal=e.principalFen;
 return {...review,state:'verified',reason:null,principalFen:principal,commissionFen:commissionFen(principal,c.rate_bps)};
}
export function summarizeManualOrders(orders,recordedFen,complete){
 if(!int(recordedFen,0))throw new TypeError('PARTNER_REPORT_INVALID');
 const reviewed=orders.filter(o=>o.state==='verified');
 const total=reviewed.reduce((s,o)=>s+o.commissionFen,0);
 if(!int(total,0))throw new TypeError('PARTNER_REPORT_INVALID');
 // Only verified orders contribute to the balance. Deduct ALL completed
 // settlements even when a previously counted order now requires review;
 // this conservatively absorbs possible debt. Incomplete reports still block.
 const reviewCount=orders.length-reviewed.length;
 return {verifiedOrders:reviewed.length,reviewCount,estimatedFen:complete?total:null,recordedFen,differenceFen:complete?total-recordedFen:null,complete};
}
export const MIN_REQUEST_FEN=1000;
export function requestableFen(summary,pending){
 if(pending||!summary?.complete||!int(summary.differenceFen,MIN_REQUEST_FEN,1000000000000))return null;
 return summary.differenceFen;
}
