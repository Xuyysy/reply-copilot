// Conservative, bounded non-production payout review. Every commission of
// this partner is checked (including previously paid ones) so stale refund
// debt cannot be hidden by choosing other orders. No transfer integration.
import {paymentEvidencePlan,classifyPaymentEvidence} from './partner-payment-proof.mjs';
import {explicitFullRefundDigest,subscriptionRefundProofPlan} from './partner-subscription-refund.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const pos=x=>Number.isSafeInteger(x)&&x>0;
const gate="EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_review_enabled' AND value='1')";
export function payoutReviewRowsPlan(partnerId){
 if(!id(partnerId))throw new TypeError('PARTNER_REVIEW_INVALID');
 return {sql:`SELECT c.order_domain,c.order_id,c.buyer_user_id,c.paid_at,c.applied_at,c.principal_fen,c.hold_until,
 COALESCE((SELECT MAX(r.cumulative_principal_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0) reversed_principal,
 c.commission_fen+COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)
 -COALESCE((SELECT SUM(i.amount_fen) FROM partner_payout_items i JOIN partner_payouts p ON p.id=i.payout_id WHERE i.order_domain=c.order_domain AND i.order_id=c.order_id AND p.status IN ('reserved','paid')),0) remaining_fen
 FROM partner_commissions c WHERE c.partner_user_id=? ORDER BY c.paid_at,c.order_domain,c.order_id LIMIT 31`,params:[partnerId]};
}
export function allocateReviewedItems(rows,amountFen,now){
 if(!Array.isArray(rows)||rows.length>30||!pos(amountFen)||!pos(now))return null;
 let left=amountFen;const items=[];
 for(const r of rows){if(!Number.isSafeInteger(r.remaining_fen)||!pos(r.hold_until))return null;
 if(r.hold_until>now||r.remaining_fen<=0)continue;
 const amount=Math.min(left,r.remaining_fen);
 if(amount>0)items.push({orderDomain:r.order_domain,orderId:r.order_id,amountFen:amount});
 left-=amount;if(left===0)break;}
 return left===0?items:null;
}
export function payoutEvidenceMatches(c,rows){
 const e=classifyPaymentEvidence(c.order_domain,rows,{allowFullyReversed:true});
 return e.eligible&&'principalFen' in e&&rows[0].buyer_id===c.buyer_user_id&&e.principalFen===c.principal_fen&&
 e.paidAt===c.paid_at&&e.appliedAt===c.applied_at&&e.refundedPrincipalFen===c.reversed_principal;
}
// A fully refunded MK99 subscription remains frozen by design. Admit it
// only as already reversed historical debt evidence, not available funds.
// Construct the digest from stored transaction identity, not client input.
export async function reversedSubscriptionReviewPlan(c,rows){
 if(c.order_domain!=='subscription'||c.reversed_principal!==c.principal_fen||c.remaining_fen>0)return null;
 const digest=await explicitFullRefundDigest(rows);
 if(!digest)return null;
 const r=rows[0];
 if(r.order_id!==c.order_id||r.buyer_user_id!==c.buyer_user_id||r.principal_fen!==c.principal_fen||
 r.paid_at!==c.paid_at||r.applied_at!==c.applied_at||r.recorded_fen!==c.principal_fen)return null;
 return subscriptionRefundProofPlan(c.order_id,r,digest);
}
// Assertions run INSIDE the same D1.batch as approval or transfer start.
// A stale risk flag or refund, extra commission, or missing ledger fails closed.
export function payoutReviewAssertions({partnerId,rows,operationId}){
 if(!id(partnerId)||!id(operationId)||!Array.isArray(rows)||rows.length<1||rows.length>30)throw new TypeError('PARTNER_REVIEW_INVALID');
 const prefix='payout-review:'+operationId;
 const checks=[{sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN ${gate}
 AND (SELECT COUNT(*) FROM partner_commissions WHERE partner_user_id=?)=? THEN 1 ELSE 0 END`,params:[prefix+':count',partnerId,rows.length]}];
 for(let i=0;i<rows.length;i++){
 const {commission:c,evidence:e}=rows[i];
 // Only the internal adapter supplies a proof plan generated from a digest
 // it computed itself. Never accept a public SQL plan or user-supplied digest.
 if(rows[i].reversedSubscriptionProof){
  const proof=rows[i].reversedSubscriptionProof;
  if(c.order_domain!=='subscription'||c.reversed_principal!==c.principal_fen||c.remaining_fen>0)throw new TypeError('PARTNER_REVIEW_INVALID');
  checks.push({sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN EXISTS(
   SELECT 1 FROM (${proof.sql}) e JOIN partner_commissions c ON c.order_domain='subscription' AND c.order_id=e.order_id
   WHERE c.partner_user_id=? AND c.order_id=? AND e.buyer_user_id=? AND e.principal_fen=? AND e.paid_at=? AND e.applied_at=?
   AND e.recorded_fen=e.principal_fen AND c.commission_fen+COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r
    WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)=0
  ) THEN 1 ELSE 0 END`,params:[prefix+':'+i,...proof.params,partnerId,c.order_id,c.buyer_user_id,c.principal_fen,c.paid_at,c.applied_at]});
  continue;
 }
 if(!payoutEvidenceMatches(c,[e]))throw new TypeError('PARTNER_REVIEW_INVALID');
 const proof=paymentEvidencePlan(c.order_domain,c.order_id);
 checks.push({sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN
 EXISTS(SELECT 1 FROM partner_commissions c WHERE c.partner_user_id=? AND c.order_domain=? AND c.order_id=?
 AND c.buyer_user_id=? AND c.principal_fen=? AND c.paid_at=? AND c.applied_at=?
 AND COALESCE((SELECT MAX(r.cumulative_principal_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)=?)
 AND EXISTS(SELECT 1 FROM (${proof.sql}) e WHERE e.transaction_count=1 AND e.transaction_id=? AND e.merchant_provider=?
 AND e.order_status=? AND e.payment_status=? AND e.risk_state='clear' AND e.currency='CNY' AND e.refund_pending=0
 AND e.payment_proof=1 AND e.applied_proof=1 AND e.buyer_id=? AND e.principal_fen=? AND e.buyer_fen=?
 AND e.paid_at=? AND e.applied_at=? AND e.principal_refunded_fen=? AND e.refund_proof_fen=?)
 THEN 1 ELSE 0 END`,params:[prefix+':'+i,partnerId,c.order_domain,c.order_id,c.buyer_user_id,c.principal_fen,c.paid_at,c.applied_at,c.reversed_principal,
 ...proof.params,e.transaction_id,e.merchant_provider,e.order_status,e.payment_status,c.buyer_user_id,c.principal_fen,e.buyer_fen,c.paid_at,c.applied_at,c.reversed_principal,c.reversed_principal]});
 }
 const keys=[prefix+':count',...rows.map((_,i)=>prefix+':'+i)];
 return {checks,cleanup:{sql:'DELETE FROM partner_recovery_assertions WHERE id IN ('+keys.map(()=>'?').join(',')+')',params:keys}};
}
