import type { Env } from "./types";
import { ApiFailure } from "./types";
import { sessionFor, requireCsrf } from "./auth";
import { requireAdminSession } from "./admin-auth";
import { response } from "./http";
import { jsonBody, nowMs, uuid } from "./security";
import { alipayRequestPlan, alipayRejectPlan } from "./partner-transfer.mjs";

// Separate request-acceptance gate. No default commercial minimum.
// All money movement and approval remain unwired until provider risk evidence
// is verified. An application is intent only, not a withdrawable balance.
async function config(env:Env){
 const rows=await env.DB.prepare("SELECT key,value FROM system_settings WHERE key IN ('partner_program_enabled','partner_alipay_recipient_enabled','partner_payout_enabled','partner_payout_requests_enabled','partner_payout_min_fen')").all<{key:string;value:string}>();
 const v=new Map(rows.results.map(x=>[x.key,x.value]));
 const ready=['partner_program_enabled','partner_alipay_recipient_enabled','partner_payout_enabled','partner_payout_requests_enabled'].every(k=>v.get(k)==='1');
 const raw=v.get('partner_payout_min_fen')||'';
 const min=/^[1-9][0-9]{0,11}$/.test(raw)?Number(raw):null;
 return {visible:v.get('partner_program_enabled')==='1'&&v.get('partner_alipay_recipient_enabled')==='1',ready:ready&&min!==null,min};
}
const stateSql=`SELECT q.id,q.amount_fen,q.recipient_version,q.created_at,q.status,q.reviewed_at,
 r.account_mask,r.name_mask,
 CASE WHEN p.status='paid' THEN 'paid' WHEN p.status='cancelled' THEN 'cancelled'
 WHEN s.payout_id IS NOT NULL THEN 'reconciling' WHEN p.status='reserved' THEN 'reserved'
 ELSE q.status END AS settlement_status
 FROM partner_alipay_requests q
 JOIN partner_alipay_recipients r ON r.user_id=q.partner_user_id AND r.version=q.recipient_version
 LEFT JOIN partner_payouts p ON p.id=q.payout_id LEFT JOIN partner_alipay_transfer_starts s ON s.payout_id=p.id`;
export async function myAlipayRequests(request:Request,env:Env):Promise<Response>{
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=="web")throw new ApiFailure(403,"FORBIDDEN","请使用网页登录账户。");
 const write=request.method==="POST";
 if(write)await requireCsrf(request,env,token);
 const c=await config(env);
 if(!c.visible){if(write)throw new ApiFailure(409,"PARTNER_REQUESTS_DISABLED","结算申请尚未开放。");return response({enabled:false},200,env,request);}
 const user=await env.DB.prepare(`SELECT 1 FROM users u WHERE u.id=? AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0
 AND EXISTS(SELECT 1 FROM partner_policy_versions v WHERE v.user_id=u.id AND v.effective_at<=?)`).bind(session.user_id,nowMs()).first();
 if(!user)throw new ApiFailure(403,"FORBIDDEN","当前账户不具备结算资格。");
 if(!write){
  const [recipient,requests]=await Promise.all([
   env.DB.prepare("SELECT version,account_mask,name_mask FROM partner_alipay_recipients WHERE user_id=? ORDER BY version DESC LIMIT 1").bind(session.user_id).first(),
   env.DB.prepare(stateSql+" WHERE q.partner_user_id=? ORDER BY q.created_at DESC,q.id DESC LIMIT 30").bind(session.user_id).all()
  ]);
  return response({enabled:true,accepting:c.ready,minFen:c.min,recipient,requests:requests.results},200,env,request);
 }
 if(!c.ready||c.min===null)throw new ApiFailure(409,"PARTNER_REQUESTS_DISABLED","结算申请尚未开放。");
 const b=await jsonBody(request,1024);
 if(Object.keys(b).length!==2||typeof b.amountFen!=="number"||!Number.isSafeInteger(b.amountFen)||b.amountFen<c.min||b.amountFen>1000000000000||
 typeof b.recipientVersion!=="number"||!Number.isSafeInteger(b.recipientVersion)||b.recipientVersion<=0)
 throw new ApiFailure(400,"PARTNER_REQUEST_INVALID","结算金额或收款版本无效。");
 const now=nowMs(),requestId=uuid();
 const plan=alipayRequestPlan({requestId,partnerId:session.user_id,recipientVersion:b.recipientVersion,amountFen:b.amountFen,now});
 // Check commercial gate/minimum and indicative matured net in the same
 // statement. This is NOT a provider risk check or an authorization to pay.
 const sql=plan.sql.replace(" ON CONFLICT DO NOTHING",`
 AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_requests_enabled' AND value='1')
 AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_min_fen' AND value=?)
 AND ? <= COALESCE((SELECT SUM(c.commission_fen+COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0))
 FROM partner_commissions c WHERE c.partner_user_id=u.id AND c.hold_until<=?),0)
 -COALESCE((SELECT SUM(p.amount_fen) FROM partner_payouts p WHERE p.partner_user_id=u.id AND p.status IN ('reserved','paid')),0)
 ON CONFLICT DO NOTHING`);
 const result=await env.DB.prepare(sql).bind(...plan.params,String(c.min),b.amountFen,now).run();
 if(result.meta.changes!==1)throw new ApiFailure(409,"PARTNER_REQUEST_CONFLICT","余额、资格、收款版本或申请状态已变化，请重新查询。");
 return response({ok:true,requestId},200,env,request);
}
export async function adminAlipayRequests(request:Request,env:Env):Promise<Response>{
 const write=request.method==="POST";
 const actor=await requireAdminSession(request,env,write);
 const c=await config(env);
 if(!c.visible){if(write)throw new ApiFailure(409,"PARTNER_REQUESTS_DISABLED","推广计划暂未开放。");return response({enabled:false},200,env,request);}
 if(!write){
  const q=new URL(request.url).searchParams.get('q')?.trim()||'';
  if(q.length>80)throw new ApiFailure(400,"INVALID_REQUEST","查询参数无效。");
  // Bounded exact partner ID lookup, no plaintext or payout destination reveal.
  const rows=await env.DB.prepare(stateSql+" WHERE q.partner_user_id=? ORDER BY q.created_at DESC,q.id DESC LIMIT 30").bind(q).all();
  return response({enabled:true,requests:rows.results},200,env,request);
 }
 const b=await jsonBody(request,2048);
 if(Object.keys(b).some(k=>!['requestId','action','reason','operationId'].includes(k))||b.action!=='reject'||typeof b.requestId!=='string'||! /^[A-Za-z0-9_-]{1,80}$/.test(b.requestId)||
 typeof b.reason!=='string'||b.reason.trim().length<8||b.reason.trim().length>500)throw new ApiFailure(400,"PARTNER_REQUEST_INVALID","审核参数无效。");
 const p=alipayRejectPlan({requestId:b.requestId,actorId:actor.user_id,now:nowMs(),reason:b.reason});
 const r=await env.DB.prepare(p.sql).bind(...p.params).run();
 if(r.meta.changes!==1)throw new ApiFailure(409,"PARTNER_REQUEST_CONFLICT","申请状态已变化，请重新查询。");
 return response({ok:true},200,env,request);
}
