import type {Env} from "./types";
import {ApiFailure} from "./types";
import {sessionFor,requireCsrf} from "./auth";
import {requireAdminSession} from "./admin-auth";
import {response} from "./http";
import {jsonBody,nowMs} from "./security";
import {payoutEnabled,recipientReady,verifiedRecipientVersion} from "./partner-payout";
import {partnerCommissionReport,checkPendingSettlement} from "./partner-commission-report";

async function enabled(env:Env){
 const row=await env.DB.prepare("SELECT COUNT(*) n FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1'").first<{n:number}>();
 return row?.n===2;
}
async function assigned(env:Env,userId:string){
 return !!await env.DB.prepare("SELECT 1 FROM partner_policy_versions WHERE user_id=? AND effective_at<=? LIMIT 1").bind(userId,nowMs()).first();
}
async function report(env:Env,userId:string,admin:boolean){
 const r=await partnerCommissionReport(env,userId,admin);
 const payout=await payoutEnabled(env),ready=!payout||await recipientReady(env,userId);
 return {...r,requestableFen:ready?r.requestableFen:null,...(payout?{payoutProfileRequired:true,recipientReady:ready}:{})};
}
export async function myManualPartnerReport(request:Request,env:Env){
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=="web")throw new ApiFailure(403,"FORBIDDEN","请使用网页登录账户。");
 const write=request.method==="POST";
 if(write)await requireCsrf(request,env,token);
 if(!await enabled(env)){
  if(write)throw new ApiFailure(409,"PARTNER_PROGRAM_DISABLED","人工结算暂未开放。");
  return response({enabled:false},200,env,request);
 }
 const user=await env.DB.prepare("SELECT 1 FROM users WHERE id=? AND role='user' AND status='active' AND email_verified_at IS NOT NULL AND archived_at IS NULL AND is_test_account=0").bind(session.user_id).first();
 if(!user||!await assigned(env,session.user_id)){
  if(write)throw new ApiFailure(403,"FORBIDDEN","当前账户未获得推广资格。");
  return response({enabled:false},200,env,request);
 }
 const current=await report(env,session.user_id,false);
 if(!write)return response(current,200,env,request);
 const body=await jsonBody(request,4096);
 const amount=current.requestableFen;
 if(Object.keys(body).length!==1||!Number.isSafeInteger(body.expectedAmountFen)||amount===null||body.expectedAmountFen!==amount||amount>1000000000000)
  throw new ApiFailure(409,"PARTNER_REQUEST_UNAVAILABLE","未达到10元、已有申请或金额已变化，请刷新后重试。");
 // Only a valid submission authenticates the encrypted recipient. Bind its
 // verified version in the same guarded INSERT so a concurrent edit cannot
 // switch the account between validation and the trigger's snapshot.
 const recipientVersion=current.payoutProfileRequired?await verifiedRecipientVersion(env,session.user_id):null;
 if(current.payoutProfileRequired&&recipientVersion===null)throw new ApiFailure(409,"PAYOUT_NOT_CONFIGURED","收款资料无法核实，请重新填写后再申请。");
 const recipientGuard=current.payoutProfileRequired?" AND (SELECT MAX(version) FROM partner_payout_profiles WHERE user_id=?)=?":"";
 const recipientParams=current.payoutProfileRequired?[session.user_id,recipientVersion]:[];
 const now=nowMs();
 // This is an application for HUMAN reconciliation only, not a payment
 // instruction. Recheck completed sum, current membership and gates at insert.
 const result=await env.DB.prepare(`INSERT INTO partner_manual_requests(id,partner_user_id,amount_fen,created_at)
 SELECT ?,?,?,? WHERE
 EXISTS(SELECT 1 FROM users WHERE id=? AND role='user' AND status='active' AND email_verified_at IS NOT NULL AND archived_at IS NULL AND is_test_account=0)
 AND EXISTS(SELECT 1 FROM partner_policy_versions WHERE user_id=? AND effective_at<=?)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1')=2
 AND (SELECT COALESCE(SUM(amount_fen),0) FROM partner_manual_requests WHERE partner_user_id=? AND status='completed')=?
 AND COALESCE((SELECT value FROM system_settings WHERE key='partner_payout_profile_enabled'),'0')=?${recipientGuard}
 ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),session.user_id,amount,now,session.user_id,session.user_id,now,session.user_id,current.summary.recordedFen,current.payoutProfileRequired?'1':'0',...recipientParams).run();
 if(result.meta.changes!==1)throw new ApiFailure(409,"PARTNER_REQUEST_CONFLICT","申请状态已变化，请刷新。");
 return response({ok:true},200,env,request);
}
export async function adminManualPartnerReport(request:Request,env:Env){
 const write=request.method==="POST";
 const actor=await requireAdminSession(request,env,write);
 if(!await enabled(env)){
  if(write)throw new ApiFailure(409,"PARTNER_PROGRAM_DISABLED","人工结算记录尚未开放。");
  return response({enabled:false},200,env,request);
 }
 if(!write){
  const params=new URL(request.url).searchParams;
  const requestId=params.get("requestId");
  if(requestId!==null){
   if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new ApiFailure(400,"INVALID_REQUEST","申请标识无效。");
   const pending=await env.DB.prepare("SELECT partner_user_id FROM partner_manual_requests WHERE id=? AND status='pending'").bind(requestId).first<{partner_user_id:string}>();
   return response({enabled:true,settlementReady:!!pending&&await checkPendingSettlement(env,pending.partner_user_id,requestId)},200,env,request);
  }
  const userId=params.get("userId")||"";
  if(!userId){
   const payout=await payoutEnabled(env);
   const queue=await env.DB.prepare("SELECT r.id,r.partner_user_id,r.amount_fen,r.created_at,u.email"+(payout?",EXISTS(SELECT 1 FROM partner_request_recipients s WHERE s.request_id=r.id) recipient_available":"")+" FROM partner_manual_requests r JOIN users u ON u.id=r.partner_user_id WHERE r.status='pending' ORDER BY r.created_at,r.id LIMIT 50").all();
   return response({enabled:true,queue:queue.results,...(payout?{payoutProfileEnabled:true}:{})},200,env,request);
  }
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(userId))throw new ApiFailure(400,"INVALID_REQUEST","用户标识无效。");
  if(!await assigned(env,userId))throw new ApiFailure(404,"USER_NOT_FOUND","尚未指定该推广伙伴。");
  return response(await report(env,userId,true),200,env,request);
 }
 const body=await jsonBody(request,4096);
 const {requestId,action,operationId,reason}=body;
 if(Object.keys(body).sort().join(",")!=="action,operationId,reason,requestId"||
 typeof requestId!=="string"||! /^[a-f0-9-]{36}$/i.test(requestId)||
 typeof operationId!=="string"||! /^[a-f0-9-]{36}$/i.test(operationId)||
 (action!=="completed"&&action!=="rejected")||typeof reason!=="string"||reason.trim().length<8||reason.trim().length>500)
 throw new ApiFailure(400,"INVALID_REQUEST","申请处理参数无效。");
 if(action==="completed"&&await payoutEnabled(env)&&!await env.DB.prepare("SELECT 1 FROM partner_request_recipients WHERE request_id=?").bind(requestId).first())throw new ApiFailure(409,"PAYOUT_NOT_CONFIGURED","该申请没有收款资料快照，请核对后驳回并重新申请。");
 // Completion is solely the administrator's declaration that the external
 // transfer was already made. No provider calls, bank details or transfer.
 const result=await env.DB.prepare(`UPDATE partner_manual_requests SET status=?,resolved_at=?,resolved_by=?,reason=?
 WHERE id=? AND status='pending' AND partner_user_id<>?
 AND EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id WHERE a.id=1 AND a.user_id=? AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled') AND value='1')=2`).bind(action,nowMs(),actor.user_id,reason.trim(),requestId,actor.user_id,actor.user_id).run();
 if(result.meta.changes!==1)throw new ApiFailure(409,"PARTNER_REQUEST_CONFLICT","该申请已处理或状态变化，请刷新。");
 return response({ok:true},200,env,request);
}
