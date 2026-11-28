import type {Env} from "./types";
import {ApiFailure} from "./types";
import {sessionFor,requireCsrf} from "./auth";
import {requireAdminSession} from "./admin-auth";
import {response} from "./http";
import {jsonBody,nowMs} from "./security";
import {parsePartnerPolicy,partnerPolicyAppendPlan} from "./partner-policy.mjs";

const flags="(SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_applications_enabled') AND value='1')=2";
const eligible="u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0";
const noPolicy="NOT EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=u.id)";
export async function partnerApplicationsEnabled(env:Env){
 return (await env.DB.prepare("SELECT "+flags+" enabled").first<{enabled:number}>())?.enabled===1;
}
function handle(value:unknown){
 const invalid=()=>new ApiFailure(400,"PARTNER_X_HANDLE_INVALID","请输入有效的 X 用户名（@后1–15个字母、数字或下划线）。");
 if(typeof value!=='string'||value.length>32)throw invalid();
 const result=value.trim().replace(/^@/,'').toLowerCase();
 if(!/^[a-z0-9_]{1,15}$/.test(result))throw invalid();
 return result;
}
const conflict=()=>new ApiFailure(409,"PARTNER_APPLICATION_CONFLICT","申请状态已变化或账号不符合资格，请刷新。");
async function mine(env:Env,id:string){
 return env.DB.prepare("SELECT id,x_handle,status,created_at,reviewed_at FROM partner_applications WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(id).first();
}
export async function myPartnerApplication(request:Request,env:Env){
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=="web")throw new ApiFailure(403,"FORBIDDEN","请使用网页登录账户。");
 const write=request.method==="POST";
 if(write)await requireCsrf(request,env,token);
 if(!await partnerApplicationsEnabled(env)){if(write)throw conflict();return response({enabled:false},200,env,request);}
 const uid=session.user_id;
 if(!write){
  const user=await env.DB.prepare("SELECT 1 FROM users u WHERE u.id=? AND "+eligible+" AND "+noPolicy).bind(uid).first();
  return response({enabled:true,canApply:!!user,application:await mine(env,uid)},200,env,request);
 }
 const body=await jsonBody(request,1024);
 if(!body||Object.keys(body).join(",")!=="xHandle")throw new ApiFailure(400,"INVALID_REQUEST","申请参数无效。");
 const x=handle(body.xHandle),now=nowMs();
 const result=await env.DB.prepare(`INSERT INTO partner_applications(id,user_id,x_handle,created_at)
 SELECT ?,u.id,?,? FROM users u WHERE u.id=? AND ${eligible} AND ${noPolicy} AND ${flags}
 AND NOT EXISTS(SELECT 1 FROM partner_applications a WHERE a.user_id=u.id AND a.status='pending')
 ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),x,now,uid).run();
 if(result.meta.changes!==1)throw conflict();
 return response({enabled:true,canApply:true,application:await mine(env,uid)},200,env,request);
}
export async function adminPartnerApplications(request:Request,env:Env){
 const write=request.method==="POST",actor=await requireAdminSession(request,env,write);
 if(!await partnerApplicationsEnabled(env)){if(write)throw conflict();return response({enabled:false},200,env,request);}
 if(!write){
  const params=new URL(request.url).searchParams,raw=params.get("offset")||"0",status=params.get("status")||"pending";
  if(!/^(0|[1-9][0-9]{0,4})$/.test(raw)||!["pending","approved","rejected"].includes(status))throw new ApiFailure(400,"INVALID_REQUEST","分页或状态无效。");
  const offset=Number(raw);
  const rows=await env.DB.prepare("SELECT a.id,a.user_id,a.x_handle,a.status,a.created_at,a.reviewed_at,u.email FROM partner_applications a JOIN users u ON u.id=a.user_id WHERE a.status=? ORDER BY a.created_at DESC,a.id DESC LIMIT 31 OFFSET ?").bind(status,offset).all();
  return response({enabled:true,items:rows.results.slice(0,30),hasMore:rows.results.length>30,offset},200,env,request);
 }
 const body=await jsonBody(request,4096);
 const {applicationId,operationId,action,...raw}=body??{};
 if(typeof applicationId!=="string"||!/^[a-f0-9-]{36}$/i.test(applicationId)||typeof operationId!=="string"||!/^[a-f0-9-]{36}$/i.test(operationId)||(action!=="approved"&&action!=="rejected"))throw new ApiFailure(400,"INVALID_REQUEST","审核参数无效。");
 if(action==="rejected"){
  if(Object.keys(raw).join(",")!=="reason"||typeof raw.reason!=="string"||raw.reason.trim().length<8||raw.reason.trim().length>500)throw new ApiFailure(400,"INVALID_REQUEST","操作原因至少 8 字。");
  const r=await env.DB.prepare(`UPDATE partner_applications SET status='rejected',reviewed_at=?,reviewed_by=?,review_reason=? WHERE id=? AND status='pending' AND ${flags}
  AND EXISTS(SELECT 1 FROM site_administrator s JOIN users u ON u.id=s.user_id WHERE s.id=1 AND u.id=? AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)`).bind(nowMs(),actor.user_id,raw.reason.trim(),applicationId,actor.user_id).run();
  if(r.meta.changes!==1)throw conflict();
 }else{
  const {userId,...rule}=raw;
  if(typeof userId!=="string"||! /^[a-zA-Z0-9_-]{1,80}$/.test(userId)||userId===actor.user_id)throw conflict();
  let policy;try{policy=parsePartnerPolicy(rule);}catch{throw new ApiFailure(400,"PARTNER_POLICY_INVALID","推广规则无效。");}
  if(policy.expectedVersion!==0||policy.status!=="active"||policy.rateBps<1500||policy.reason.length<8)throw new ApiFailure(400,"PARTNER_POLICY_INVALID","申请批准必须是首次授权，佣金至少15%，原因至少8字。");
  const plan=partnerPolicyAppendPlan({userId,actorId:actor.user_id,now:nowMs(),policy});
  const tail="ON CONFLICT(user_id,version) DO NOTHING";
  if(!plan.sql.endsWith(tail))throw Error("PARTNER_POLICY_CONTRACT_CHANGED");
  const statement=plan.sql.slice(0,-tail.length)+`AND ${flags} AND EXISTS(SELECT 1 FROM partner_applications a WHERE a.id=? AND a.user_id=u.id AND a.status='pending') `+tail;
  const r=await env.DB.prepare(statement).bind(...plan.params,applicationId).run();
  if(r.meta.changes!==1)throw conflict();
 }
 return response({ok:true},200,env,request);
}
