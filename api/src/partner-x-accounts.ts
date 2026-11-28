import type {Env} from "./types";
import {ApiFailure} from "./types";
import {requireAdminSession} from "./admin-auth";
import {response} from "./http";
import {jsonBody,nowMs} from "./security";

const flags="(SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_x_accounts_enabled') AND value='1')=2";
export async function partnerXAccountsEnabled(env:Env){
 return (await env.DB.prepare("SELECT "+flags+" enabled").first<{enabled:number}>())?.enabled===1;
}
// The approved application is the automatic initial binding. A manual override
// has precedence but never mutates the original application or policy.
export const partnerXDirectoryColumns=`,COALESCE(
 (SELECT x.x_handle FROM partner_x_account_versions x WHERE x.user_id=u.id ORDER BY x.version DESC LIMIT 1),
 (SELECT a.x_handle FROM partner_applications a WHERE a.user_id=u.id AND a.status='approved' ORDER BY a.created_at DESC,a.id DESC LIMIT 1)
 ) x_handle,COALESCE((SELECT MAX(x.version) FROM partner_x_account_versions x WHERE x.user_id=u.id),0) x_handle_version`;
export async function adminPartnerXAccount(request:Request,env:Env){
 const actor=await requireAdminSession(request,env,true);
 const conflict=()=>new ApiFailure(409,"PARTNER_X_ACCOUNT_CONFLICT","合伙人身份或绑定版本已变化，请刷新列表。");
 if(!await partnerXAccountsEnabled(env))throw conflict();
 const b=await jsonBody(request,2048);
 if(!b||Object.keys(b).sort().join(",")!=="expectedVersion,operationId,reason,userId,xHandle"||
 typeof b.userId!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(b.userId)||b.userId===actor.user_id||
 typeof b.operationId!=="string"||!/^[a-f0-9-]{36}$/i.test(b.operationId)||
 typeof b.expectedVersion!=="number"||!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||b.expectedVersion>=Number.MAX_SAFE_INTEGER||
 typeof b.xHandle!=="string"||b.xHandle.length>32||typeof b.reason!=="string"||b.reason.trim().length<8||b.reason.trim().length>500)
 throw new ApiFailure(400,"INVALID_REQUEST","绑定参数无效，操作原因至少 8 字。");
 const handle=b.xHandle.trim().replace(/^@/,"").toLowerCase();
 if(!/^[a-z0-9_]{1,15}$/.test(handle))throw new ApiFailure(400,"PARTNER_X_HANDLE_INVALID","请输入有效的 X 用户名。");
 const result=await env.DB.prepare(`INSERT INTO partner_x_account_versions(user_id,version,x_handle,updated_at,updated_by,reason,operation_id)
 SELECT u.id,?,?,?,?,?,? FROM users u WHERE u.id=? AND u.role='user' AND u.archived_at IS NULL
 AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=u.id)
 AND COALESCE((SELECT MAX(x.version) FROM partner_x_account_versions x WHERE x.user_id=u.id),0)=?
 AND ${flags}
 AND EXISTS(SELECT 1 FROM site_administrator s JOIN users a ON a.id=s.user_id WHERE s.id=1 AND a.id=? AND a.role='admin' AND a.status='active' AND a.email_verified_at IS NOT NULL AND a.archived_at IS NULL AND a.is_test_account=0)
 ON CONFLICT DO NOTHING`).bind(b.expectedVersion+1,handle,nowMs(),actor.user_id,b.reason.trim(),b.operationId,b.userId,b.expectedVersion,actor.user_id).run();
 if(result.meta.changes!==1)throw conflict();
 return response({ok:true,xHandle:handle,version:b.expectedVersion+1},200,env,request);
}
