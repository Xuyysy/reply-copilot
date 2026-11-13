/**
 * Single atomic grant plan for D1.batch and isolated SQLite integration tests.
 * Only a successful conditional claim makes subsequent award statements run.
 * No paid credit, subscription period, or historical allocation is updated.
 */
export const REFERRAL_BONUS=50;
export const REFERRAL_MONTHLY_LIMIT=10;
export const REFERRAL_WINDOW_MS=30*86400_000;
export function normalizeReferralCode(value) {
 return typeof value==="string" && /^[0-9a-fA-F]{16}$/.test(value) ? value.toLowerCase() : null;
}
const make=(sql,...params)=>({sql,params});
export function referralAwardPlan({inviteeId,nonce,now}) {
 if (typeof inviteeId!=="string"||!inviteeId||typeof nonce!=="string"||!nonce||!Number.isSafeInteger(now)||now<1) throw new Error("INVALID_REFERRAL_AWARD_PLAN");
 const claimSql=[
 "UPDATE referral_invites SET status='rewarded',reward_claim=?,rewarded_at=?",
 "WHERE invited_user_id=? AND status='pending'",
 "AND EXISTS(SELECT 1 FROM users inviter",
 "JOIN users invitee ON invitee.id=referral_invites.invited_user_id",
 "JOIN signup_benefit_claims sb ON sb.user_id=invitee.id AND sb.status='granted'",
 "WHERE inviter.id=referral_invites.inviter_user_id",
 "AND inviter.role IN ('user','admin') AND invitee.role='user'",
 "AND inviter.status='active' AND invitee.status='active'",
 "AND inviter.is_test_account=0 AND invitee.is_test_account=0",
 "AND inviter.email_verified_at IS NOT NULL AND invitee.email_verified_at IS NOT NULL",
 "AND NOT EXISTS(SELECT 1 FROM site_administrator a WHERE a.user_id=invitee.id)",
 "AND EXISTS(SELECT 1 FROM ai_requests r WHERE r.user_id=invitee.id",
 "AND r.status='succeeded' AND r.delivery_confirmation_id IS NOT NULL AND r.delivery_confirmed_at IS NOT NULL)",
 "AND NOT EXISTS(SELECT 1 FROM device_free_claims old",
 "WHERE old.user_id=inviter.id AND old.device_digest=sb.device_digest))",
 "AND (SELECT COUNT(*) FROM referral_invites prev",
 "WHERE prev.inviter_user_id=referral_invites.inviter_user_id",
 "AND prev.status='rewarded' AND prev.rewarded_at>=?) < ?"
 ].join(" ");
 const claim=make(claimSql,nonce,now,inviteeId,now-REFERRAL_WINDOW_MS,REFERRAL_MONTHLY_LIMIT);
 const sidePlan=side=>{
  const beneficiary=side==="inviter"?"inviter_user_id":"invited_user_id";
  const ref="referral:"+inviteeId+":"+side;
  const eligible="FROM referral_invites r WHERE r.invited_user_id=? AND r.status='rewarded' AND r.reward_claim=?";
  return [
   make("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status)"+
     " SELECT ?,r."+beneficiary+",'free','admin_adjustment',50,50,?,'tracked','active' "+eligible,ref,now,inviteeId,nonce),
   make("UPDATE credit_accounts SET free_balance=free_balance+50,version=version+1,updated_at=?"+
     " WHERE user_id=(SELECT "+beneficiary+" FROM referral_invites WHERE invited_user_id=? AND reward_claim=?)"+
     " AND EXISTS(SELECT 1 FROM credit_batches WHERE id=? AND remaining_credits=50 AND source_kind='admin_adjustment')",
     now,inviteeId,nonce,ref),
   make("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at)"+
     " SELECT ?,r."+beneficiary+",'admin_adjustment',50,0,?,'referral_reward:"+side+"',? "+eligible,
     "ledger:"+ref,ref,now,inviteeId,nonce),
   make("INSERT INTO referral_awards(invited_user_id,beneficiary_user_id,side,amount,credit_batch_id,ledger_reference_id,granted_at)"+
     " SELECT r.invited_user_id,r."+beneficiary+",?,50,?,?,? "+eligible,
     side,ref,ref,now,inviteeId,nonce)
  ];
 };
 const ra="referral:"+inviteeId+":inviter",rb="referral:"+inviteeId+":invitee";
 const assertion=[
 "INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?, CASE WHEN",
 "NOT EXISTS(SELECT 1 FROM referral_invites WHERE invited_user_id=? AND reward_claim=?) OR (",
 "(SELECT COUNT(*) FROM referral_awards WHERE invited_user_id=? AND amount=50)=2",
 "AND (SELECT COUNT(*) FROM credit_batches WHERE id IN (?,?) AND source_kind='admin_adjustment' AND bucket='free' AND grant_credits=50 AND remaining_credits=50)=2",
 "AND (SELECT COUNT(*) FROM credit_ledger WHERE kind='admin_adjustment' AND free_delta=50 AND paid_delta=0 AND reference_id IN (?,?))=2",
 "AND (SELECT COUNT(*) FROM credit_accounts WHERE user_id IN",
 "(SELECT inviter_user_id FROM referral_invites WHERE invited_user_id=? UNION SELECT invited_user_id FROM referral_invites WHERE invited_user_id=?))=2",
 "AND NOT EXISTS(SELECT 1 FROM credit_accounts c WHERE c.user_id IN",
 "(SELECT inviter_user_id FROM referral_invites WHERE invited_user_id=? UNION SELECT invited_user_id FROM referral_invites WHERE invited_user_id=?)",
 "AND c.free_balance<>(SELECT COALESCE(SUM(remaining_credits),0) FROM credit_batches WHERE user_id=c.user_id AND bucket='free'))",
 ") THEN 1 ELSE 0 END"
 ].join(" ");
 return [claim,...sidePlan("inviter"),...sidePlan("invitee"),
  make(assertion,nonce,inviteeId,nonce,inviteeId,ra,rb,ra,rb,inviteeId,inviteeId,inviteeId,inviteeId),
  make("DELETE FROM credit_operation_assertions WHERE operation_id=?",nonce)];
}
