import type { Env } from "./types";
import { ApiFailure } from "./types";
import { sessionFor, requireCsrf } from "./auth";
import { response } from "./http";
import { jsonBody, nowMs } from "./security";
import { parseAlipayRecipient, sealAlipayRecipient, recipientAppendPlan } from "./partner-alipay.mjs";

export async function myAlipayRecipient(request:Request,env:Env):Promise<Response>{
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=="web")throw new ApiFailure(403,"FORBIDDEN","请使用网页登录账户。");
 const write=request.method==="POST";
 if(write)await requireCsrf(request,env,token);
 const gate=await env.DB.prepare("SELECT COUNT(*) n FROM system_settings WHERE key IN ('partner_program_enabled','partner_alipay_recipient_enabled') AND value='1'").first<{n:number}>();
 if(gate?.n!==2){
  if(write)throw new ApiFailure(409,"PARTNER_RECIPIENT_DISABLED","收款信息功能暂未启用。");
  return response({enabled:false},200,env,request);
 }
 const user=await env.DB.prepare(`SELECT (SELECT status FROM partner_policy_versions WHERE user_id=u.id AND effective_at<=? ORDER BY version DESC LIMIT 1) partner_status
 FROM users u WHERE u.id=? AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0`).bind(nowMs(),session.user_id).first<{partner_status:string|null}>();
 if(!user?.partner_status||write&&user.partner_status!=="active")throw new ApiFailure(403,"FORBIDDEN","当前账户不具备收款信息操作资格。");
 if(!write){
  const recipient=await env.DB.prepare("SELECT version,account_mask,name_mask,created_at FROM partner_alipay_recipients WHERE user_id=? ORDER BY version DESC LIMIT 1").bind(session.user_id).first();
  return response({enabled:true,recipient,editable:user.partner_status==="active"},200,env,request);
 }
 const body=await jsonBody(request,2048);
 const {expectedVersion,...raw}=body;
 if(typeof expectedVersion!=="number"||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||expectedVersion>=Number.MAX_SAFE_INTEGER)
  throw new ApiFailure(400,"INVALID_REQUEST","收款信息版本无效。");
 let parsed;
 try{parsed=parseAlipayRecipient(raw);}catch{throw new ApiFailure(400,"PARTNER_ALIPAY_INVALID","支付宝账号或收款人姓名格式无效。");}
 const key=env.PARTNER_ALIPAY_ENCRYPTION_KEY,keyId=env.PARTNER_ALIPAY_KEY_ID;
 if(!key||!keyId)throw new ApiFailure(503,"PARTNER_RECIPIENT_NOT_CONFIGURED","收款信息服务尚未配置。");
 const now=nowMs();
 const sealed=await sealAlipayRecipient(parsed,{environment:env.ENVIRONMENT,userId:session.user_id,version:expectedVersion+1,keyId},key);
 const plan=recipientAppendPlan({userId:session.user_id,expectedVersion,now,sealed});
 const result=await env.DB.prepare(plan.sql).bind(...plan.params).run();
 if(result.meta.changes!==1)throw new ApiFailure(409,"PARTNER_RECIPIENT_CONFLICT","收款信息或资格已变化，请重新查询。");
 return response({enabled:true,editable:true,recipient:{version:expectedVersion+1,account_mask:sealed.accountMask,name_mask:sealed.nameMask,created_at:now}},200,env,request);
}
