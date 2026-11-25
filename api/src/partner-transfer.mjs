// Source-only manual Alipay workflow. No external transfer calls.
// Trusted caller authenticates session, CSRF, admin reauth, risk and evidence.
// Pending applications are intent only; approval reserves money in one batch.
import {payoutReservePlan} from './partner-payout.mjs';
import {alipayDestinationPlan} from './partner-alipay.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const pos=x=>Number.isSafeInteger(x)&&x>0;
const reason=x=>typeof x==='string'&&x.trim().length>=8&&x.trim().length<=500;
const fail=()=>{throw new TypeError('PARTNER_TRANSFER_INVALID');};
const admin="EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id WHERE a.id=1 AND u.id=? AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)";
const gate="(SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_alipay_recipient_enabled','partner_payout_enabled') AND value='1')=3";
export function alipayRequestPlan({requestId,partnerId,recipientVersion,amountFen,now}){
 if(!id(requestId)||!id(partnerId)||!pos(recipientVersion)||!pos(amountFen)||amountFen>1000000000000||!pos(now))fail();
 return {sql:`INSERT INTO partner_alipay_requests(id,partner_user_id,recipient_version,amount_fen,created_at,status)
 SELECT ?,u.id,?,?,?,'pending' FROM users u WHERE u.id=? AND ${gate}
 AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0
 AND EXISTS(SELECT 1 FROM partner_policy_versions v WHERE v.user_id=u.id AND v.effective_at<=?)
 AND (SELECT MAX(version) FROM partner_alipay_recipients WHERE user_id=u.id)=?
 AND NOT EXISTS(SELECT 1 FROM partner_payouts p WHERE p.partner_user_id=u.id AND p.status='reserved')
 ON CONFLICT DO NOTHING`,params:[requestId,recipientVersion,amountFen,now,partnerId,now,recipientVersion]};
}
// Must be run in a single atomic transaction, with every affected row checked.
// The final statement aborts the whole batch if the pending request changed.
export function alipayApprovePlan({requestId,recipientVersion,payoutId,partnerId,actorId,now,reason:why,items}){
 if(!id(requestId)||!id(payoutId)||!id(partnerId)||!id(actorId)||!pos(recipientVersion)||!pos(now)||!reason(why))fail();
 const reserve=payoutReservePlan({payoutId,partnerId,actorId,now,reason:why,items});
 return [...reserve,alipayDestinationPlan({payoutId,userId:partnerId,version:recipientVersion}),
 {sql:`UPDATE partner_alipay_requests SET status='approved',payout_id=?,reviewed_by=?,reviewed_at=?,reason=?
 WHERE id=? AND partner_user_id=? AND recipient_version=? AND status='pending' AND ${gate} AND ${admin}`,
 params:[payoutId,actorId,now,why.trim(),requestId,partnerId,recipientVersion,actorId]}];
}
export function alipayStartPlan({payoutId,actorId,now,reason:why}){
 if(!id(payoutId)||!id(actorId)||!pos(now)||!reason(why))fail();
 return {sql:`INSERT INTO partner_alipay_transfer_starts(payout_id,started_by,started_at,reason)
 SELECT ?,?,?,? WHERE ${gate} AND ${admin} ON CONFLICT(payout_id) DO NOTHING`,
 params:[payoutId,actorId,now,why.trim(),actorId]};
}
// An unknown result is represented by a start without a final outcome.
// Never retry or release while unknown. Caller must verify bank/Alipay
// evidence independently before choosing paid or no_transfer.
export function alipayOutcomePlan({payoutId,actorId,now,outcome,amountFen,reference=null,reason:why}){
 if(!id(payoutId)||!id(actorId)||!pos(now)||!reason(why)||!['paid','no_transfer'].includes(outcome)||
 (outcome==='paid'?(!pos(amountFen)||typeof reference!=='string'||!reference.trim()||reference.trim().length>160):(amountFen!==0||reference!==null)))fail();
 return {sql:`INSERT INTO partner_alipay_transfer_outcomes(payout_id,outcome,amount_fen,reference,recorded_by,recorded_at,reason)
 SELECT ?,?,?,?,?,?,? WHERE ${admin} ON CONFLICT(payout_id) DO NOTHING`,
 params:[payoutId,outcome,amountFen,reference?.trim()??null,actorId,now,why.trim(),actorId]};
}
