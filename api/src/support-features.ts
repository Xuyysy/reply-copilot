import type {Env} from "./types";
import {ApiFailure} from "./types";
import {sessionFor} from "./auth";
import {requireAdminSession} from "./admin-auth";
import {operation,commitOperation} from "./admin-operations";
import {jsonBody,nowMs} from "./security";
import {response} from "./http";

const FLAG="local_diagnostics";
const MAX_HOURS=168;
type Grant={expires_at:number};
async function readGrant(env:Env,userId:string){
  const row=await env.DB.prepare("SELECT expires_at FROM user_support_features WHERE user_id=? AND feature=?").bind(userId,FLAG).first<Grant>();
  const expiresAt=row?.expires_at??0;
  const enabled=Number.isSafeInteger(expiresAt)&&expiresAt>nowMs();
  return {enabled,expiresAt:enabled?expiresAt:null};
}
export async function extensionSupportFeatures(request:Request,env:Env){
  const {session}=await sessionFor(request,env);
  if(session.kind!=="extension")throw new ApiFailure(403,"FORBIDDEN","仅限插件账户使用。");
  const flag=await readGrant(env,session.user_id).catch(()=>({enabled:false,expiresAt:null}));
  return response({schema:1,features:{localDiagnostics:flag}},200,env,request);
}
export async function adminSupportFeatures(request:Request,env:Env,userId:string){
  const write=request.method==="POST";
  const actor=await requireAdminSession(request,env,write);
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(userId))throw new ApiFailure(400,"INVALID_REQUEST","用户 ID 无效。");
  const user=await env.DB.prepare("SELECT id,status FROM users WHERE id=?").bind(userId).first<{id:string;status:string}>();
  if(!user)throw new ApiFailure(404,"NOT_FOUND","用户不存在。");
  const before=await readGrant(env,userId);
  if(!write)return response({localDiagnostics:before},200,env,request);
  const body=await jsonBody(request,2048);
  if(typeof body.enabled!=="boolean"||Object.keys(body).some(k=>!["enabled","hours","operationId","reason"].includes(k))||
    (body.enabled&&(user.status!=="active"||typeof body.hours!=="number"||!Number.isInteger(body.hours)||body.hours<1||body.hours>MAX_HOURS))||
    (!body.enabled&&body.hours!==undefined))throw new ApiFailure(400,"INVALID_REQUEST","请选择有效授权时长（1–168 小时）。");
  const op=await operation(env,actor,body,"support_local_diagnostics",userId);
  if(!op.replayed){
    const now=nowMs(),expiresAt=body.enabled?now+Number(body.hours)*3600000:null;
    const statements=body.enabled?
      [env.DB.prepare("INSERT INTO user_support_features(user_id,feature,expires_at,updated_at,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(user_id,feature) DO UPDATE SET expires_at=excluded.expires_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by").bind(userId,FLAG,expiresAt,now,actor.user_id)]:
      [env.DB.prepare("DELETE FROM user_support_features WHERE user_id=? AND feature=?").bind(userId,FLAG)];
    await commitOperation(env,op,statements,before,{enabled:body.enabled,expiresAt});
  }
  return response({localDiagnostics:await readGrant(env,userId)},200,env,request);
}
