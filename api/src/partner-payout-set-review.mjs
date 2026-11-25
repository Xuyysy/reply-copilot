// Set-based all-history review. The final evidence assertion and all money
// reservations execute in ONE transaction. No remote transfer API.
// Source-only pilot; D1 query cost and actual schemas still need validation.
import {paymentEvidencePlan} from './partner-payment-proof.mjs';
import {subscriptionRefundCandidatePlan} from './partner-subscription-refund.mjs';
import {alipayDestinationPlan} from './partner-alipay.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const pos=x=>Number.isSafeInteger(x)&&x>0;
const fail=()=>{throw new TypeError('PARTNER_SET_REVIEW_INVALID');};
const gate="EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_review_enabled' AND value='1')";
const admin="EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id WHERE a.id=1 AND a.user_id=? AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)";
const enabled="(SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_payout_enabled','partner_alipay_recipient_enabled') AND value='1')=3";
const reversal="COALESCE((SELECT MAX(r.cumulative_principal_fen) FROM partner_commission_refunds r WHERE r.order_domain=ledger.order_domain AND r.order_id=ledger.order_id),0)";
function evidence(domain){
 const source=paymentEvidencePlan(domain,'placeholder').sql;
 const sql=source.replace('WHERE o.id=? LIMIT 2','WHERE o.id=ledger.order_id LIMIT 2');
 if(sql===source)fail();
 return `EXISTS(SELECT 1 FROM (${sql}) e JOIN partner_payment_identity_claims k ON k.order_domain=ledger.order_domain AND k.order_id=ledger.order_id
 WHERE e.transaction_count=1 AND e.identity_count=1 AND e.transaction_paid_at=e.paid_at
 AND e.merchant_provider=k.merchant_provider AND e.provider_trade_id=k.provider_trade_id AND e.provider_payment_id=k.provider_payment_id
 AND e.currency='CNY' AND e.risk_state='clear' AND e.refund_pending=0 AND e.payment_proof=1 AND e.applied_proof=1
 AND e.buyer_id=ledger.buyer_user_id AND e.paid_at=ledger.paid_at AND e.applied_at=ledger.applied_at AND e.principal_fen=ledger.principal_fen
 AND typeof(e.buyer_fen)='integer' AND e.buyer_fen>=ledger.principal_fen AND e.buyer_fen<=1000000000000
 AND typeof(e.principal_refunded_fen)='integer' AND e.principal_refunded_fen BETWEEN 0 AND ledger.principal_fen
 AND e.principal_refunded_fen=${reversal} AND e.refund_proof_fen=e.principal_refunded_fen
 AND (e.order_status='paid' AND e.payment_status='paid' ${domain==='recharge'?"OR (e.order_status='refunded' AND e.payment_status='refunded' AND e.principal_refunded_fen=ledger.principal_fen)":""})
 ${domain==='subscription'?"AND e.order_kind IN ('purchase','renewal','upgrade') AND e.buyer_fen=ledger.principal_fen":""})`;
}
function reversedSubscription(){
 // The immutable ledger event ID is generated ONLY by the verified refund
 // sync adapter from the explicit full-amount digest; require exact event
 // and original immutable payment claim. Never trust order status alone.
 const source=subscriptionRefundCandidatePlan('placeholder').sql;
 const sql=source.replace("c.order_id=?","c.order_id=ledger.order_id");
 if(sql===source)fail();
 return `EXISTS(SELECT 1 FROM (${sql}) e
 JOIN partner_payment_identity_claims k ON k.order_domain='subscription' AND k.order_id=e.order_id
 JOIN partner_commission_refunds r ON r.order_domain='subscription' AND r.order_id=e.order_id AND r.cumulative_principal_fen=e.principal_fen
 JOIN subscription_payment_events ev ON ev.transaction_id=e.transaction_id AND ev.merchant_provider='mk99'
 AND ev.event_type='TRADE_REFUND' AND ev.amount_fen=e.principal_fen AND ev.provider_event_id=r.refund_event_id
 AND ev.provider_event_id='sub-risk:'||ev.body_sha256
 WHERE e.transaction_count=1 AND e.recorded_fen=e.principal_fen AND k.merchant_provider='mk99'
 AND k.provider_trade_id=e.provider_trade_id AND k.provider_payment_id=e.provider_payment_id
 AND length(ev.body_sha256)=64 AND ev.body_sha256 NOT GLOB '*[^0-9a-f]*'
 AND ledger.commission_fen+COALESCE((SELECT SUM(r2.delta_fen) FROM partner_commission_refunds r2 WHERE r2.order_domain=ledger.order_domain AND r2.order_id=ledger.order_id),0)=0
 AND NOT EXISTS(SELECT 1 FROM payment_transactions t WHERE t.merchant_provider='mk99' AND (t.provider_trade_id=k.provider_trade_id OR t.provider_payment_id=k.provider_payment_id))
 AND (SELECT COUNT(*) FROM subscription_payment_transactions t WHERE t.merchant_provider='mk99' AND (t.provider_trade_id=k.provider_trade_id OR t.provider_payment_id=k.provider_payment_id))=1
 AND EXISTS(SELECT 1 FROM subscription_payment_transactions t WHERE t.id=e.transaction_id AND t.paid_at=ledger.paid_at))`;
}
export function allHistoryPayoutGuard({partnerId,operationId}){
 if(!id(partnerId)||!id(operationId))fail();
 const claim='set-payout:'+operationId;
 return {check:{sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN ${gate}
 AND EXISTS(SELECT 1 FROM partner_commissions WHERE partner_user_id=?)
 AND NOT EXISTS(SELECT 1 FROM partner_commissions ledger WHERE ledger.partner_user_id=? AND NOT (
 (ledger.order_domain='recharge' AND ${evidence('recharge')}) OR
 (ledger.order_domain='subscription' AND (${evidence('subscription')} OR ${reversedSubscription()}))
 )) THEN 1 ELSE 0 END`,params:[claim,partnerId,partnerId]},
 cleanup:{sql:'DELETE FROM partner_recovery_assertions WHERE id=?',params:[claim]}};
}
// Allocate all required mature positive balances using an integer window sum.
// Existing per-item and global balance triggers are still active.
export function setPayoutApprovePlan({requestId,recipientVersion,payoutId,partnerId,actorId,amountFen,now,reason}){
 if(![requestId,payoutId,partnerId,actorId].every(id)||partnerId===actorId||!pos(recipientVersion)||!pos(amountFen)||amountFen<1000||amountFen>1000000000000||!pos(now)||typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500)fail();
 const header={sql:`INSERT INTO partner_payouts(id,partner_user_id,amount_fen,status,created_at,created_by,reason)
 SELECT ?,?,?,'reserved',?,?,? WHERE ${gate} AND ${enabled} AND ${admin}
 AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 AND EXISTS(SELECT 1 FROM partner_alipay_requests q WHERE q.id=? AND q.partner_user_id=? AND q.recipient_version=? AND q.status='pending' AND q.amount_fen=?)`,
 params:[payoutId,partnerId,amountFen,now,actorId,reason.trim(),actorId,partnerId,requestId,partnerId,recipientVersion,amountFen]};
 const items={sql:`WITH available AS (
 SELECT c.order_domain,c.order_id,c.paid_at,c.commission_fen+
 COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)-
 COALESCE((SELECT SUM(i.amount_fen) FROM partner_payout_items i JOIN partner_payouts p ON p.id=i.payout_id WHERE i.order_domain=c.order_domain AND i.order_id=c.order_id AND p.status IN ('reserved','paid')),0) remaining
 FROM partner_commissions c WHERE c.partner_user_id=? AND c.hold_until<=?
 ), ranked AS (
 SELECT *,COALESCE(SUM(remaining) OVER (ORDER BY paid_at,order_domain,order_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) prior
 FROM available WHERE remaining>0)
 INSERT INTO partner_payout_items(payout_id,order_domain,order_id,amount_fen)
 SELECT ?,order_domain,order_id,MIN(remaining,CAST(? AS INTEGER)-prior) FROM ranked WHERE prior<?
 ORDER BY paid_at,order_domain,order_id`,params:[partnerId,now,payoutId,amountFen,amountFen]};
 const destination=alipayDestinationPlan({payoutId,userId:partnerId,version:recipientVersion});
 const update={sql:`UPDATE partner_alipay_requests SET status='approved',payout_id=?,reviewed_by=?,reviewed_at=?,reason=?
 WHERE id=? AND partner_user_id=? AND recipient_version=? AND status='pending' AND ${gate} AND ${enabled} AND ${admin}`,
 params:[payoutId,actorId,now,reason.trim(),requestId,partnerId,recipientVersion,actorId]};
 const claim='set-approval:'+payoutId;
 return [header,items,destination,update,
 {sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN EXISTS(
 SELECT 1 FROM partner_alipay_requests q JOIN partner_payouts p ON p.id=q.payout_id
 WHERE q.id=? AND q.status='approved' AND p.id=? AND p.status='reserved' AND p.amount_fen=?
 AND (SELECT COALESCE(SUM(i.amount_fen),0) FROM partner_payout_items i WHERE i.payout_id=p.id)=p.amount_fen)
 THEN 1 ELSE 0 END`,params:[claim,requestId,payoutId,amountFen]},
 {sql:'DELETE FROM partner_recovery_assertions WHERE id=?',params:[claim]}];
}
