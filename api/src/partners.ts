import type { Env } from "./types";
import { ApiFailure } from "./types";
import { requireAdminSession } from "./admin-auth";
import { sessionFor } from "./auth";
import { response } from "./http";
import { jsonBody, nowMs } from "./security";
import { parsePartnerPolicy, partnerPolicyAppendPlan, partnerPolicyAtPlan } from "./partner-policy.mjs";

async function enabled(env: Env): Promise<boolean> {
  const row=await env.DB.prepare("SELECT value FROM system_settings WHERE key='partner_program_enabled'").first<{value:string}>();
  return row?.value==="1";
}
const columns="user_id,version,status,level,rate_bps,term_months,effective_at";
function id(value:unknown):string {
  if(typeof value!=="string"||! /^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw new ApiFailure(400,"INVALID_REQUEST","用户标识无效。");
  return value;
}
async function current(env:Env,userId:string) {
  const p=partnerPolicyAtPlan(userId,nowMs());
  return env.DB.prepare(p.sql).bind(...p.params).first();
}
export async function myPartnerPolicy(request:Request,env:Env):Promise<Response>{
  const {session}=await sessionFor(request,env);
  if(session.kind!=="web")throw new ApiFailure(403,"FORBIDDEN","请使用网页登录账户。");
  if(!await enabled(env))return response({enabled:false},200,env,request);
  const user=await env.DB.prepare("SELECT 1 FROM users WHERE id=? AND role='user' AND status='active' AND email_verified_at IS NOT NULL AND archived_at IS NULL AND is_test_account=0").bind(session.user_id).first();
  const policy=user?await current(env,session.user_id):null;
  if(!policy)return response({enabled:true,policy:null},200,env,request);
  // Eligibility-only milestone. Never touch cash ledgers or infer financial balances.
  // The invitation card continues to display the existing referral statistics.
  return response({enabled:true,policy},200,env,request);
}
export async function adminPartnerPolicy(request:Request,env:Env):Promise<Response>{
  const write=request.method==="POST";
  const actor=await requireAdminSession(request,env,write);
  if(!await enabled(env)){
    if(write)throw new ApiFailure(409,"PARTNER_PROGRAM_DISABLED","推广伙伴计划尚未启用。");
    return response({enabled:false},200,env,request);
  }
  if(!write){
    const q=(new URL(request.url).searchParams.get("q")||"").trim();
    if(!q||q.length>254)throw new ApiFailure(400,"INVALID_REQUEST","请输入准确用户 ID 或邮箱。");
    const user=await env.DB.prepare("SELECT id,email,role,status,email_verified_at,is_test_account,archived_at FROM users WHERE id=? OR email=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1").bind(q,q.toLowerCase(),q).first<{id:string;email:string;role:string;status:string;email_verified_at:number|null;is_test_account:number;archived_at:number|null}>();
    if(!user)throw new ApiFailure(404,"USER_NOT_FOUND","账户不存在。");
    const history=await env.DB.prepare("SELECT "+columns+",authorized_by,reason FROM partner_policy_versions WHERE user_id=? ORDER BY version DESC LIMIT 20").bind(user.id).all();
    return response({enabled:true,user:{id:user.id,email:user.email,eligible:user.role==="user"&&user.status==="active"&&user.email_verified_at!==null&&user.is_test_account===0&&user.archived_at===null},history:history.results},200,env,request);
  }
  const body=await jsonBody(request,4096);
  const {userId,operationId,...raw}=body;
  const target=id(userId);
  if(typeof operationId!=="string"||!/^[a-f0-9-]{36}$/i.test(operationId))
    throw new ApiFailure(400,"INVALID_REQUEST","操作标识无效。");
  let policy;
  try { policy=parsePartnerPolicy(raw); }
  catch { throw new ApiFailure(400,"PARTNER_POLICY_INVALID","推广规则无效。"); }
  if(policy.status==="active"&&policy.rateBps<1500)throw new ApiFailure(400,"PARTNER_POLICY_INVALID","新启用的合作佣金比例不得低于15%。");
  if(policy.reason.length<8||target===actor.user_id)throw new ApiFailure(400,"PARTNER_POLICY_INVALID","操作原因至少 8 字且不能授权自己。");
  const plan=partnerPolicyAppendPlan({userId:target,actorId:actor.user_id,now:nowMs(),policy});
  const result=await env.DB.prepare(plan.sql).bind(...plan.params).run();
  // Version guard makes replay harmless. On ambiguous network result the UI
  // must reload history, never retry with a fresh version automatically.
  if(result.meta.changes!==1)throw new ApiFailure(409,"PARTNER_POLICY_CONFLICT","资格不符合或版本已变化，请重新查询。");
  return response({ok:true,version:policy.expectedVersion+1},200,env,request);
}

export async function adminPartnerDirectory(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 if(!await enabled(env))return response({enabled:false},200,env,request);
 const raw=new URL(request.url).searchParams.get("offset")||"0";
 if(!/^(0|[1-9][0-9]{0,3})$/.test(raw))throw new ApiFailure(400,"INVALID_OFFSET","分页参数无效。");
 const offset=Number(raw);
 const rows=await env.DB.prepare(`SELECT u.id,u.email,u.status account_status,p.version,p.status,p.level,p.rate_bps,p.term_months,p.effective_at,
 (SELECT COUNT(*) FROM referral_invites i WHERE i.inviter_user_id=u.id) registered,
 (SELECT COUNT(*) FROM referral_invites i WHERE i.inviter_user_id=u.id AND i.status='rewarded') activated
 FROM partner_policy_versions p JOIN users u ON u.id=p.user_id
 WHERE p.version=(SELECT MAX(v.version) FROM partner_policy_versions v WHERE v.user_id=p.user_id)
 ORDER BY p.effective_at DESC,u.id LIMIT 31 OFFSET ?`).bind(offset).all();
 return response({enabled:true,items:rows.results.slice(0,30),hasMore:rows.results.length>30,offset},200,env,request);
}
export async function adminPartnerInvites(request:Request,env:Env):Promise<Response>{
 await requireAdminSession(request,env);
 if(!await enabled(env))return response({enabled:false},200,env,request);
 const url=new URL(request.url),target=id(url.searchParams.get("userId")),raw=url.searchParams.get("offset")||"0";
 if(!/^(0|[1-9][0-9]{0,3})$/.test(raw))throw new ApiFailure(400,"INVALID_OFFSET","分页参数无效。");
 if(!await current(env,target))throw new ApiFailure(404,"USER_NOT_FOUND","尚未指定该推广伙伴。");
 const offset=Number(raw);
 const rows=await env.DB.prepare("SELECT i.invited_user_id,u.email,i.status,i.registered_at,i.rewarded_at FROM referral_invites i JOIN users u ON u.id=i.invited_user_id WHERE i.inviter_user_id=? ORDER BY i.registered_at DESC,i.invited_user_id DESC LIMIT 31 OFFSET ?").bind(target,offset).all();
 return response({enabled:true,items:rows.results.slice(0,30),hasMore:rows.results.length>30,offset},200,env,request);
}
