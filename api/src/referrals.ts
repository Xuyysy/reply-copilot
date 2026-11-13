import type { Env } from "./types";
import { ApiFailure } from "./types";
import { sessionFor, requireCsrf } from "./auth";
import { requireAdminSession } from "./admin-auth";
import { response } from "./http";
import { nowMs, uuid } from "./security";
import { REFERRAL_BONUS, normalizeReferralCode, referralAwardPlan } from "./referral-award-plan.mjs";

/** Defaults OFF until an independently approved D1 migration and rollout. */
export async function referralsEnabled(env: Env): Promise<boolean> {
  const setting=await env.DB.prepare("SELECT value FROM system_settings WHERE key='referrals_enabled'")
    .first<{value:string}>();
  return setting?.value==="1";
}

/** Validates referral attribution before registration. Ignore missing/expired codes: signup is never blocked. */
export async function eligibleReferralCode(env: Env, value: unknown): Promise<string|null> {
  const code=normalizeReferralCode(value);
  if(!code || !await referralsEnabled(env))return null;
  const eligible=await env.DB.prepare(
    "SELECT 1 FROM referral_codes c JOIN users u ON u.id=c.user_id "+
    "WHERE c.code=? AND u.role IN ('user','admin') AND u.status='active' AND u.is_test_account=0 "+
    "AND u.email_verified_at IS NOT NULL "+
    "AND u.archived_at IS NULL"
  ).bind(code).first();
  return eligible?code:null;
}

/** Immutable registration attribution, only while verifying a genuinely new email. */
export function referralRegistrationStatement(env:Env, invitedId:string, code:string, now:number):D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,status,registered_at) "+
    "SELECT ?,c.user_id,c.code,'pending',? FROM referral_codes c "+
    "JOIN users u ON u.id=c.user_id "+
    "WHERE c.code=? AND c.user_id<>? AND u.role IN ('user','admin') AND u.status='active' "+
    "AND u.email_verified_at IS NOT NULL AND u.is_test_account=0 "+
    "AND u.archived_at IS NULL "+
    "ON CONFLICT(invited_user_id) DO NOTHING"
  ).bind(invitedId,now,code,invitedId);
}

/**
 * Eligible only after a delivery ACK, not just signup, model generation or
 * an extension token. The entire two-party 50+50 grant is one D1.batch.
 * A retry after duplicate ACK or viewing the invitee account is safe.
 */
export async function awardReferralIfEligible(env:Env, invitedId:string):Promise<boolean> {
  if(!await referralsEnabled(env))return false;
  const pending=await env.DB.prepare("SELECT 1 FROM referral_invites WHERE invited_user_id=? AND status='pending'")
    .bind(invitedId).first();
  if(!pending)return false;
  const ops=referralAwardPlan({inviteeId:invitedId,nonce:uuid(),now:nowMs()});
  const result=await env.DB.batch(ops.map(op=>env.DB.prepare(op.sql).bind(...op.params)));
  return result[0].meta.changes===1;
}

/** Reward glitches must NEVER turn an already-confirmed reply into a failure. */
export async function bestEffortReferralAward(env:Env,userId:string):Promise<void> {
  try { await awardReferralIfEligible(env,userId); }
  catch { console.warn("REFERRAL_REWARD_PENDING_RETRY"); }
}

function requireWebSessionKind(kind:string):void {
  if(kind!=="web")throw new ApiFailure(403,"FORBIDDEN","请使用网页登录账户。");
}
function linkFor(env:Env, code:string|null):string|null {
  if(!code)return null;
  const uri=new URL("/login/",env.WEB_ORIGIN);
  uri.searchParams.set("mode","register");
  uri.searchParams.set("ref",code);
  return uri.href;
}
async function eligibleOwner(env:Env,userId:string):Promise<boolean> {
  return Boolean(await env.DB.prepare(
    "SELECT 1 FROM users u WHERE u.id=? AND u.role IN ('user','admin') AND u.status='active' "+
    "AND u.email_verified_at IS NOT NULL AND u.is_test_account=0 "+
    "AND u.archived_at IS NULL"
  ).bind(userId).first());
}

export async function myReferrals(request:Request,env:Env):Promise<Response> {
  const {session}=await sessionFor(request,env);
  requireWebSessionKind(session.kind);
  if(!await referralsEnabled(env))return response({enabled:false},200,env,request);
  // Account view can safely retry a previous ACK whose grant failed due to a transient error.
  await bestEffortReferralAward(env,session.user_id);
  const canInvite=await eligibleOwner(env,session.user_id);
  const [code,stats,invitedBy]=await Promise.all([
    canInvite?env.DB.prepare("SELECT code FROM referral_codes WHERE user_id=?").bind(session.user_id).first<{code:string}>():Promise.resolve(null),
    env.DB.prepare("SELECT COUNT(*) registered,COALESCE(SUM(CASE WHEN status='rewarded' THEN 1 ELSE 0 END),0) rewarded FROM referral_invites WHERE inviter_user_id=?").bind(session.user_id).first<{registered:number;rewarded:number}>(),
    env.DB.prepare("SELECT status,registered_at,rewarded_at FROM referral_invites WHERE invited_user_id=?").bind(session.user_id).first<{status:string;registered_at:number;rewarded_at:number|null}>()
  ]);
  const rewarded=Number(stats?.rewarded||0),registered=Number(stats?.registered||0);
  return response({enabled:true,canInvite,link:linkFor(env,code?.code||null),bonus:REFERRAL_BONUS,
    registered,rewarded,pending:registered-rewarded,earnedCredits:rewarded*REFERRAL_BONUS,
    invitedBy:invitedBy?{status:invitedBy.status,registeredAt:invitedBy.registered_at,rewardedAt:invitedBy.rewarded_at}:null,
    eligibility:"verified_email_extension_first_delivered_reply"
  },200,env,request);
}

export async function createReferralLink(request:Request,env:Env):Promise<Response> {
  const {session,token}=await sessionFor(request,env);
  requireWebSessionKind(session.kind);
  await requireCsrf(request,env,token);
  if(!await referralsEnabled(env))throw new ApiFailure(503,"REFERRALS_NOT_ENABLED","邀请奖励暂未开放。");
  if(!await eligibleOwner(env,session.user_id))throw new ApiFailure(403,"REFERRAL_NOT_ELIGIBLE","当前账户不可创建邀请链接。");
  const random=crypto.getRandomValues(new Uint8Array(8));
  const code=Array.from(random,n=>n.toString(16).padStart(2,"0")).join("");
  await env.DB.prepare("INSERT INTO referral_codes(user_id,code,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING")
    .bind(session.user_id,code,nowMs()).run();
  const assigned=await env.DB.prepare("SELECT code FROM referral_codes WHERE user_id=?")
    .bind(session.user_id).first<{code:string}>();
  if(!assigned)throw new ApiFailure(503,"REFERRAL_LINK_UNAVAILABLE","暂时无法创建邀请链接。");
  return response({enabled:true,link:linkFor(env,assigned.code),bonus:REFERRAL_BONUS},200,env,request);
}

/** Admin V2: read-only, bounded; permits verified admins as inviters, but never test/admin invitees. */
export async function adminReferralOverview(request:Request,env:Env):Promise<Response> {
  await requireAdminSession(request,env);
  if(!await referralsEnabled(env))return response({enabled:false},200,env,request);
  const url=new URL(request.url),rawOffset=url.searchParams.get("offset")||"0";
  if(!/^(0|[1-9][0-9]{0,3})$/.test(rawOffset))throw new ApiFailure(400,"INVALID_OFFSET","分页参数无效。");
  const offset=Number(rawOffset),query=(url.searchParams.get("q")||"").trim();
  if(query.length>120)throw new ApiFailure(400,"INVALID_QUERY","搜索内容过长。");
  const base="FROM referral_invites i JOIN users inviter ON inviter.id=i.inviter_user_id "+
    "JOIN users invited ON invited.id=i.invited_user_id "+
    "WHERE inviter.role IN ('user','admin') AND invited.role='user' AND inviter.is_test_account=0 AND invited.is_test_account=0 "+
    "AND NOT EXISTS(SELECT 1 FROM site_administrator x WHERE x.user_id=invited.id)";
  const [stats,awards,rows]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) registrations,COUNT(DISTINCT i.inviter_user_id) inviters,"+
      "COALESCE(SUM(CASE WHEN i.status='rewarded' THEN 1 ELSE 0 END),0) activated "+base).first<{registrations:number;inviters:number;activated:number}>(),
    env.DB.prepare("SELECT COALESCE(SUM(a.amount),0) issued "+
      "FROM referral_awards a JOIN referral_invites i ON i.invited_user_id=a.invited_user_id "+
      "JOIN users inviter ON inviter.id=i.inviter_user_id JOIN users invited ON invited.id=i.invited_user_id "+
      "WHERE inviter.role IN ('user','admin') AND invited.role='user' AND inviter.is_test_account=0 AND invited.is_test_account=0 "+
      "AND NOT EXISTS(SELECT 1 FROM site_administrator x WHERE x.user_id=invited.id)").first<{issued:number}>(),
    env.DB.prepare("SELECT i.invited_user_id,i.inviter_user_id,inviter.email inviter_email,invited.email invited_email,"+
      "i.status,i.registered_at,i.rewarded_at "+base+
      " AND (?='' OR inviter.id=? OR invited.id=? OR inviter.email=? OR invited.email=?) "+
      "ORDER BY i.registered_at DESC,i.invited_user_id DESC LIMIT 50 OFFSET ?")
      .bind(query,query,query,query.toLowerCase(),query.toLowerCase(),offset).all()
  ]);
  return response({enabled:true,bonus:REFERRAL_BONUS,
    totals:{registered:Number(stats?.registrations||0),activated:Number(stats?.activated||0),
      pending:Number(stats?.registrations||0)-Number(stats?.activated||0),
      inviters:Number(stats?.inviters||0),issuedCredits:Number(awards?.issued||0)},
    items:rows.results,offset,pageSize:50
  },200,env,request);
}
