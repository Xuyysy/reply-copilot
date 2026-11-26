import type { Env } from "./types";
import { ApiFailure } from "./types";
import { requireAdminSession } from "./admin-auth";
import { sessionFor } from "./auth";
import { response } from "./http";
import { jsonBody, nowMs } from "./security";
import { partnerSummaryPlan } from "./partner-payout.mjs";
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
  const summary=partnerSummaryPlan(session.user_id,nowMs());
  const totals=await env.DB.prepare(summary.sql).bind(...summary.params).first();
  const orders=await env.DB.prepare(`SELECT c.order_domain,c.paid_at,c.principal_fen,c.commission_fen,c.hold_until,
    c.commission_fen+COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r
    WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0) net_fen
    FROM partner_commissions c WHERE c.partner_user_id=? ORDER BY c.paid_at DESC,c.order_domain,c.order_id LIMIT 30`).bind(session.user_id).all();
  return response({enabled:true,policy,totals,orders:orders.results,payoutAvailable:false},200,env,request);
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
  if(policy.reason.length<8||target===actor.user_id)throw new ApiFailure(400,"PARTNER_POLICY_INVALID","操作原因至少 8 字且不能授权自己。");
  const plan=partnerPolicyAppendPlan({userId:target,actorId:actor.user_id,now:nowMs(),policy});
  const result=await env.DB.prepare(plan.sql).bind(...plan.params).run();
  // Version guard makes replay harmless. On ambiguous network result the UI
  // must reload history, never retry with a fresh version automatically.
  if(result.meta.changes!==1)throw new ApiFailure(409,"PARTNER_POLICY_CONFLICT","资格不符合或版本已变化，请重新查询。");
  return response({ok:true,version:policy.expectedVersion+1},200,env,request);
}
