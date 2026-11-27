/**
 * Source-only V1-A policy primitives. Not connected to public routes or payment.
 * Caller must authenticate with requireAdminSession(..., true) and supply the
 * actor from that session and server time, never from request JSON.
 * No commercial defaults. Null term is explicit unlimited, not an omission.
 * The program switch and singleton admin binding are checked again at write.
 */
const fields = new Set(['status','level','rateBps','termMonths','reason','expectedVersion']);
const levels = new Set(['standard','advanced','strategic']);
const statuses = new Set(['active','paused']);
const safeInt=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;

export function parsePartnerPolicy(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) ||
     Object.keys(value).length!==fields.size ||
     Object.keys(value).some(k=>!fields.has(k)) ||
     ![...fields].every(k=>Object.hasOwn(value,k))) throw new TypeError('PARTNER_POLICY_INVALID');
  const {status,level,rateBps,termMonths,reason,expectedVersion}=value;
  if(!statuses.has(status)||!levels.has(level)||!safeInt(rateBps,1,10000)||
    !(termMonths===null||safeInt(termMonths,1,120))||
    typeof reason!=='string'||reason.trim().length<1||reason.trim().length>500||
    !safeInt(expectedVersion,0,Number.MAX_SAFE_INTEGER-1)||
    (expectedVersion===0&&status!=='active')) throw new TypeError('PARTNER_POLICY_INVALID');
  return {status,level,rateBps,termMonths,reason:reason.trim(),expectedVersion};
}

// Single append guarded by optimistic version, server time, eligibility and
// the existing singleton administrator. No in-place history mutation.
export function partnerPolicyAppendPlan({userId,actorId,now,policy}) {
  const p=parsePartnerPolicy(policy);
  if(typeof userId!=='string'||!userId.trim()||typeof actorId!=='string'||!actorId.trim()||
    userId===actorId||!safeInt(now,1,Number.MAX_SAFE_INTEGER)) throw new TypeError('PARTNER_POLICY_INVALID');
  const sql=`INSERT INTO partner_policy_versions
    (user_id,version,status,level,rate_bps,term_months,effective_at,authorized_by,reason)
    SELECT u.id,?,?,?,?,?,?,?,? FROM users u
    WHERE u.id=?
      AND EXISTS(SELECT 1 FROM system_settings s WHERE s.key='partner_program_enabled' AND s.value='1')
      AND EXISTS(SELECT 1 FROM site_administrator a JOIN users actor ON actor.id=a.user_id
        WHERE a.id=1 AND a.user_id=? AND actor.role='admin' AND actor.status='active'
          AND actor.email_verified_at IS NOT NULL AND actor.archived_at IS NULL AND actor.is_test_account=0)
      AND u.role='user' AND u.id<>?
      AND (?='paused' OR (u.status='active' AND u.email_verified_at IS NOT NULL
        AND u.is_test_account=0 AND u.archived_at IS NULL))
      AND COALESCE((SELECT MAX(v.version) FROM partner_policy_versions v WHERE v.user_id=u.id),0)=?
      AND NOT EXISTS(SELECT 1 FROM partner_policy_versions v WHERE v.user_id=u.id AND v.effective_at>=?)
      AND (?<>'paused' OR EXISTS(SELECT 1 FROM partner_policy_versions v WHERE v.user_id=u.id AND v.version=? AND v.status='active'))
    ON CONFLICT(user_id,version) DO NOTHING`;
  return {sql,params:[p.expectedVersion+1,p.status,p.level,p.rateBps,p.termMonths,now,actorId,p.reason,userId,
    actorId,actorId,p.status,p.expectedVersion,now,p.status,p.expectedVersion]};
}

// Historical snapshot lookup is by trusted order time, not processing time.
// A paused row must never be treated as an active policy. Cash accrual will
// additionally enforce account/referral eligibility, risk and approved terms.
export function partnerPolicyAtPlan(userId,at) {
  if(typeof userId!=='string'||!userId.trim()||!safeInt(at,1,Number.MAX_SAFE_INTEGER)) throw new TypeError('PARTNER_POLICY_INVALID');
  return {sql:`SELECT user_id,version,status,level,rate_bps,term_months,effective_at
    FROM partner_policy_versions WHERE user_id=? AND effective_at<=?
    ORDER BY effective_at DESC LIMIT 1`,params:[userId,at]};
}
