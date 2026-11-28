import type {Env} from "./types";
import {ApiFailure} from "./types";
import {sessionFor,requireCsrf} from "./auth";
import {requireAdminSession} from "./admin-auth";
import {commissionLedgerEnabled,checkLedgerSettlement} from "./partner-commission-ledger";
import {response} from "./http";
import {jsonBody,nowMs} from "./security";
import {payoutKeyValid,normalizeRecipient,encryptRecipient,decryptRecipient,maskRecipient} from "./partner-payout-crypto.mjs";
type Profile={version:number;ciphertext:string;created_at:number};
const flag="partner_payout_profile_enabled";
export async function payoutEnabled(env:Env){return (await env.DB.prepare("SELECT COUNT(*) n FROM system_settings WHERE key IN ('partner_program_enabled',?) AND value='1'").bind(flag).first<{n:number}>())?.n===2;}
function secret(env:Env){const s=env.PARTNER_PAYOUT_ENCRYPTION_KEY;if(!s||!payoutKeyValid(s))throw new ApiFailure(503,"PAYOUT_UNAVAILABLE","收款资料服务暂不可用。");return s;}
async function latest(env:Env,id:string){return env.DB.prepare("SELECT version,ciphertext,created_at FROM partner_payout_profiles WHERE user_id=? ORDER BY version DESC LIMIT 1").bind(id).first<Profile>();}
async function open(env:Env,id:string,p:Profile){try{return await decryptRecipient(secret(env),id,p.version,p.ciphertext,env);}catch{throw new ApiFailure(503,"PAYOUT_UNAVAILABLE","收款资料服务暂不可用。");}}
async function pending(env:Env,id:string){return !!await env.DB.prepare("SELECT 1 FROM partner_manual_requests WHERE partner_user_id=? AND status='pending' LIMIT 1").bind(id).first();}
// Cheap UI eligibility hint only: never select ciphertext or decrypt on report GET.
// A well-formed but wrong key cannot be detected until actual authentication of ciphertext.
export async function recipientReady(env:Env,id:string){
 if(!payoutKeyValid(env.PARTNER_PAYOUT_ENCRYPTION_KEY))return false;
 return !!await env.DB.prepare("SELECT 1 FROM partner_payout_profiles WHERE user_id=? LIMIT 1").bind(id).first();
}
export async function verifiedRecipientVersion(env:Env,id:string){
 const p=await latest(env,id);
 if(!p)return null;
 try{await open(env,id,p);return p.version;}catch{return null;}
}
export async function myPartnerPayout(request:Request,env:Env){
 const {session,token}=await sessionFor(request,env);const id=session.user_id,write=request.method==="POST";
 if(session.kind!=="web")throw new ApiFailure(403,"FORBIDDEN","请使用网页登录账户。");
 if(write)await requireCsrf(request,env,token);
 if(!await payoutEnabled(env)){if(write)throw new ApiFailure(409,"PAYOUT_DISABLED","收款资料尚未开放。");return response({enabled:false},200,env,request);}
 const eligible=await env.DB.prepare("SELECT 1 FROM users u WHERE u.id=? AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0 AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=u.id AND p.effective_at<=?)").bind(id,nowMs()).first();
 if(!eligible)throw new ApiFailure(403,"FORBIDDEN","当前账户未获得推广资格。");
 const key=secret(env),p=await latest(env,id),locked=await pending(env,id);
 if(!write)return response({enabled:true,version:p?.version??0,locked,profile:p?maskRecipient(await open(env,id,p)):null},200,env,request);
 if(locked)throw new ApiFailure(409,"PAYOUT_LOCKED","结算申请处理中，暂不可修改收款资料。");
 const body=await jsonBody(request,4096);
 if(Object.keys(body).sort().join(",")!=="account,expectedVersion,name"||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion!==(p?.version??0))throw new ApiFailure(409,"PAYOUT_CONFLICT","请刷新后重新填写收款资料。");
 let value;try{value=normalizeRecipient(body);}catch{throw new ApiFailure(400,"PAYOUT_INVALID","请填写有效的支付宝账号和收款人姓名。");}
 const version=(p?.version??0)+1,ciphertext=await encryptRecipient(key,id,version,value,env);
 const r=await env.DB.prepare(`INSERT INTO partner_payout_profiles(user_id,version,ciphertext,created_at)
 SELECT u.id,?,?,? FROM users u WHERE u.id=? AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0
 AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=u.id AND p.effective_at<=?)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_payout_profile_enabled') AND value='1')=2
 AND NOT EXISTS(SELECT 1 FROM partner_manual_requests WHERE partner_user_id=u.id AND status='pending')
 AND COALESCE((SELECT MAX(version) FROM partner_payout_profiles WHERE user_id=u.id),0)=?
 ON CONFLICT DO NOTHING`).bind(version,ciphertext,nowMs(),id,nowMs(),version-1).run();
 if(r.meta.changes!==1)throw new ApiFailure(409,"PAYOUT_CONFLICT","收款资料状态变化，请刷新后重试。");
 return response({enabled:true,version,locked:false,profile:maskRecipient(value)},200,env,request);
}
export async function adminPartnerPayout(request:Request,env:Env){
 const write=request.method==="POST",actor=await requireAdminSession(request,env,write);
 if(!await payoutEnabled(env)){if(write)throw new ApiFailure(409,"PAYOUT_DISABLED","收款资料尚未开放。");return response({enabled:false},200,env,request);}
 const body=write?await jsonBody(request,4096):null;
 const id=body?.userId??new URL(request.url).searchParams.get("userId");
 if(typeof id!=="string"||!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw new ApiFailure(400,"INVALID_REQUEST","用户标识无效。");
 if(!await env.DB.prepare("SELECT 1 FROM partner_policy_versions WHERE user_id=? LIMIT 1").bind(id).first())throw new ApiFailure(404,"USER_NOT_FOUND","尚未指定该推广伙伴。");
 if(!write){const configured=!!await env.DB.prepare("SELECT 1 FROM partner_payout_profiles WHERE user_id=? LIMIT 1").bind(id).first();return response({enabled:true,configured,locked:await pending(env,id)},200,env,request);}
 const requestId=body?.requestId??null;
 if(!body||Object.keys(body).some(k=>!["userId","requestId","reason","operationId","forSettlement"].includes(k))||typeof body.reason!=="string"||body.reason.trim().length<8||body.reason.length>500||typeof body.operationId!=="string"||!/^[a-f0-9-]{36}$/i.test(body.operationId)||(requestId!==null&&(typeof requestId!=="string"||!/^[a-f0-9-]{36}$/i.test(requestId))))throw new ApiFailure(400,"INVALID_REQUEST","收款资料查看参数无效。");
 if(body.forSettlement!==undefined&&body.forSettlement!==true)throw new ApiFailure(400,"INVALID_REQUEST","结算核对参数无效。");
 if(body.forSettlement===true&&await commissionLedgerEnabled(env)&&(!requestId||!await checkLedgerSettlement(env,id,requestId)))throw new ApiFailure(409,"PARTNER_SETTLEMENT_CHANGED","申请已处理或佣金尚未同步，请刷新核对，不要转账。");
 const p=requestId?await env.DB.prepare("SELECT p.version,p.ciphertext,p.created_at FROM partner_request_recipients r JOIN partner_payout_profiles p ON p.user_id=r.user_id AND p.version=r.profile_version WHERE r.request_id=? AND r.user_id=?").bind(requestId,id).first<Profile>():await latest(env,id);
 if(!p)throw new ApiFailure(404,"PAYOUT_NOT_CONFIGURED","未提交收款资料或该申请没有收款快照。");
 const value=await open(env,id,p);
 const audit=await env.DB.prepare("INSERT INTO partner_payout_reveal_audit(id,actor_id,user_id,profile_version,request_id,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),actor.user_id,id,p.version,requestId,nowMs()).run();
 if(audit.meta.changes!==1)throw new ApiFailure(503,"PAYOUT_UNAVAILABLE","收款资料查看失败。");
 return response({enabled:true,version:p.version,profile:value},200,env,request);
}
