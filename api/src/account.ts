import type { Env, Session } from "./types";
import { sessionFor } from "./auth";
import { balance } from "./quota";
import { response } from "./http";

export async function accountState(env: Env, session: Session) {
  const quota = await balance(env,session.user_id);
  const user = await env.DB.prepare("SELECT status FROM users WHERE id=?").bind(session.user_id).first<{status:string}>();
  const status = user?.status === "frozen" ? "frozen" : quota.totalRemaining>0 ? "credits_available" : "credits_exhausted";
  return {status,quota};
}
export async function me(request: Request, env: Env): Promise<Response> {
  const {session}=await sessionFor(request,env);
  const user=await env.DB.prepare("SELECT username,email,role,status,email_verified_at FROM users WHERE id=?").bind(session.user_id).first<{username:string|null;email:string;role:string;status:string;email_verified_at:number}>();
  return response({user:{userId:session.user_id,username:user?.username,email:user?.email,role:user?.role,status:user?.status,emailVerified:Boolean(user?.email_verified_at)}},200,env,request);
}
export async function entitlements(request: Request, env: Env): Promise<Response> {
  const {session}=await sessionFor(request,env); const state=await accountState(env,session);
  return response({status:state.status,entitlement:{entitlementStatus:state.status==="credits_available"?"active":"inactive"},quota:state.quota},200,env,request);
}
export async function usage(request: Request, env: Env): Promise<Response> {
  const {session}=await sessionFor(request,env); const quota=await balance(env,session.user_id);
  return response({quota},200,env,request);
}
export async function licenseDevices(request: Request, env: Env): Promise<Response> {
  const {session}=await sessionFor(request,env);
  const license=await env.DB.prepare("SELECT id,max_devices,status FROM licenses WHERE user_id=?").bind(session.user_id).first<{id:string;max_devices:number;status:string}>();
  const devices=license?(await env.DB.prepare("SELECT device_id,activated_at FROM license_devices WHERE license_id=? ORDER BY activated_at").bind(license.id).all<{device_id:string;activated_at:number}>()).results.map(row=>({deviceId:row.device_id,activatedAt:new Date(row.activated_at).toISOString()})):[];
  return response({licenseStatus:license?.status || "none",maxDevices:license?.max_devices || 0,devices},200,env,request);
}
export async function activity(request: Request,env: Env): Promise<Response> {
  const {session}=await sessionFor(request,env);
  const [ledger,orders]=await Promise.all([
    env.DB.prepare("SELECT kind,free_delta,paid_delta,reason,created_at FROM credit_ledger WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 20").bind(session.user_id).all(),
    env.DB.prepare("SELECT id,package_name,credits,amount_cents,currency,status,created_at FROM recharge_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(session.user_id).all(),
  ]);
  return response({ledger:ledger.results,orders:orders.results},200,env,request);
}
