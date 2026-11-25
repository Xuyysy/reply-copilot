/**
 * V1-B source-only ledger primitives; no runtime route or payment hook.
 * A future trusted adapter must verify provider payment, actual successful
 * entitlement application, immutable order principal and fraud eligibility.
 * NEVER feed public request bodies into these functions.
 * Product-principal basis is a candidate only, not an approved policy.
 */
const MAX_FEN=1000000000000;
const int=(x,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const identifier=x=>typeof x==='string'&&/^[A-Za-z0-9:_-]{1,160}$/.test(x);
const domain=x=>x==='recharge'||x==='subscription';
const fail=()=>{throw new TypeError('PARTNER_LEDGER_INVALID');};
export function commissionFen(principalFen,rateBps){
  if(!int(principalFen,0,MAX_FEN)||!int(rateBps,1,10000))fail();
  return Number(BigInt(principalFen)*BigInt(rateBps)/10000n);
}
// UTC calendar month clamp. Jan 31 + one month => last day of February.
export function termEnd(start,months){
  if(!int(start,1,8640000000000000)||!int(months,1,120))fail();
  const d=new Date(start),day=d.getUTCDate();
  d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
  const last=new Date(d);last.setUTCMonth(last.getUTCMonth()+1,0);
  d.setUTCDate(Math.min(day,last.getUTCDate()));
  if(!Number.isSafeInteger(d.getTime()))fail();
  return d.getTime();
}
// Guarded insert also verifies the existing immutable attribution and exact
// historical policy at settlement time. Rate changes do not reset the
// first authorization date. No row when the referral's term has expired.
// Until the real adapter and risk checks are audited, this is fixture-only.
export function commissionInsertPlan(f){
  if(!f||!domain(f.orderDomain)||!identifier(f.orderId)||!identifier(f.partnerUserId)||
    !identifier(f.buyerUserId)||f.partnerUserId===f.buyerUserId||
    !int(f.policyVersion,1)||!int(f.paidAt,1)||!int(f.appliedAt,f.paidAt)||
    !int(f.now,f.appliedAt)||!int(f.holdUntil,f.appliedAt)||
    !int(f.registeredAt,1,f.paidAt)||!int(f.firstAuthorizedAt,1,f.paidAt)||
    !(f.termMonths===null||int(f.termMonths,1,120))||
    f.currency!=='CNY'||f.basis!=='product_principal'||!int(f.principalFen,1,MAX_FEN))fail();
  const amount=commissionFen(f.principalFen,f.rateBps);
  if(amount===0)return null;
  if(f.termMonths!==null&&f.paidAt>=termEnd(Math.max(f.registeredAt,f.firstAuthorizedAt),f.termMonths))return null;
  const sql=`INSERT INTO partner_commissions
    (order_domain,order_id,partner_user_id,buyer_user_id,policy_version,paid_at,applied_at,basis,currency,
     principal_fen,rate_bps,commission_fen,hold_until,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?
    WHERE EXISTS(SELECT 1 FROM system_settings WHERE key='partner_program_enabled' AND value='1')
      AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_cash_accrual_enabled' AND value='1')
      AND EXISTS(SELECT 1 FROM referral_invites r WHERE r.invited_user_id=? AND r.inviter_user_id=? AND r.registered_at=?)
      AND (SELECT MIN(effective_at) FROM partner_policy_versions WHERE user_id=? AND status='active')=?
      AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=? AND p.version=? AND p.status='active'
        AND p.rate_bps=? AND p.term_months IS ? AND p.effective_at<=?
        AND NOT EXISTS(SELECT 1 FROM partner_policy_versions n WHERE n.user_id=p.user_id AND n.effective_at>p.effective_at AND n.effective_at<=?))
      AND (SELECT COUNT(*) FROM users WHERE id IN (?,?) AND role='user' AND status='active'
        AND email_verified_at IS NOT NULL AND is_test_account=0 AND archived_at IS NULL)=2
    ON CONFLICT(order_domain,order_id) DO NOTHING`;
  return {sql,params:[f.orderDomain,f.orderId,f.partnerUserId,f.buyerUserId,f.policyVersion,f.paidAt,f.appliedAt,
    f.basis,f.currency,f.principalFen,f.rateBps,amount,f.holdUntil,f.now,
    f.buyerUserId,f.partnerUserId,f.registeredAt,f.partnerUserId,f.firstAuthorizedAt,f.partnerUserId,f.policyVersion,
    f.rateBps,f.termMonths,f.paidAt,f.paidAt,f.partnerUserId,f.buyerUserId]};
}
// Refund input is a trusted, verified cumulative product-principal total.
// Freeze/manual-review is NOT refund proof. Do not use estimated amounts.
// Compute remaining commission from remaining principal, preventing rounding
// drift across multiple partial refunds; final full refund reverses all.
// A single SQL statement serializes concurrent cumulative updates.
export function refundInsertPlan(f){
  if(!f||!domain(f.orderDomain)||!identifier(f.orderId)||!identifier(f.refundEventId)||
    !int(f.cumulativePrincipalFen,1,MAX_FEN)||!int(f.now,1))fail();
  const sql=`INSERT INTO partner_commission_refunds
    (order_domain,order_id,refund_event_id,cumulative_principal_fen,cumulative_reversal_fen,delta_fen,recorded_at)
    SELECT c.order_domain,c.order_id,?,?,
      c.commission_fen-((c.principal_fen-?)*c.rate_bps)/10000,
      COALESCE((SELECT MAX(r.cumulative_reversal_fen) FROM partner_commission_refunds r
        WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)
        -(c.commission_fen-((c.principal_fen-?)*c.rate_bps)/10000),?
    FROM partner_commissions c WHERE c.order_domain=? AND c.order_id=? AND ?<=c.principal_fen
      AND ?>COALESCE((SELECT MAX(r.cumulative_principal_fen) FROM partner_commission_refunds r
        WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)
      AND ?>=c.created_at
    ON CONFLICT DO NOTHING`;
  return {sql,params:[f.refundEventId,f.cumulativePrincipalFen,f.cumulativePrincipalFen,f.cumulativePrincipalFen,f.now,
    f.orderDomain,f.orderId,f.cumulativePrincipalFen,f.cumulativePrincipalFen,f.now]};
}
