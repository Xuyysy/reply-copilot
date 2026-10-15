import type { Env, Session } from "./types";
import { ApiFailure } from "./types";
import { sessionFor } from "./auth";
import { ensureLicenseDevice } from "./device";
import { nextShanghaiReset, nowMs, shanghaiDay, utcIso } from "./security";
import { response } from "./http";

export async function accountState(env: Env, session: Session) {
  const now = nowMs();
  const license = await env.DB.prepare("SELECT id,license_type,status,max_devices FROM licenses WHERE user_id=?").bind(session.user_id).first<{id:string;license_type:string;status:string;max_devices:number}>();
  const trial = await env.DB.prepare("SELECT started_at,expires_at,status FROM trials WHERE user_id=?").bind(session.user_id).first<{started_at:number;expires_at:number;status:string}>();
  const date = shanghaiDay(now);
  const row = await env.DB.prepare("SELECT used,daily_limit FROM daily_usage WHERE user_id=? AND quota_date=?").bind(session.user_id, date).first<{used:number;daily_limit:number}>();
  const quota = { dailyLimit: row?.daily_limit ?? 30, dailyUsed: row?.used ?? 0, dailyRemaining: Math.max(0, (row?.daily_limit ?? 30) - (row?.used ?? 0)), resetAt: nextShanghaiReset(now) };
  let status = trial && trial.status === "active" && now < trial.expires_at ? (quota.dailyRemaining > 0 ? "trial_active" : "trial_exhausted") : "trial_expired";
  if (license?.status === "active") {
    if (session.kind === "extension") await ensureLicenseDevice(env, session);
    status = "lifetime_active";
  }
  const count = license ? await env.DB.prepare("SELECT count(*) AS count FROM license_devices WHERE license_id=?").bind(license.id).first<{count:number}>() : null;
  return { status, trial: trial ? { startedAt: utcIso(trial.started_at), expiresAt: utcIso(trial.expires_at) } : null, license: license ? { licenseType: license.license_type, licenseStatus: license.status, maxDevices: license.max_devices, activatedDevices: count?.count || 0 } : null, quota: license?.status === "active" ? null : quota };
}
export async function me(request: Request, env: Env): Promise<Response> { const { session } = await sessionFor(request, env); return response({ user: { userId: session.user_id, email: session.email } }, 200, env, request); }
export async function entitlements(request: Request, env: Env): Promise<Response> { const { session } = await sessionFor(request, env); const state = await accountState(env, session); return response({ status: state.status, entitlement: { entitlementStatus: state.status === "lifetime_active" || state.status === "trial_active" ? "active" : "inactive" }, trial: state.trial, license: state.license }, 200, env, request); }
export async function usage(request: Request, env: Env): Promise<Response> { const { session } = await sessionFor(request, env); const state = await accountState(env, session); return response({ quota: state.quota }, 200, env, request); }
export async function licenseDevices(request: Request, env: Env): Promise<Response> {
  const { session } = await sessionFor(request, env);
  const state = await accountState(env, session);
  const license = await env.DB.prepare("SELECT id FROM licenses WHERE user_id=?").bind(session.user_id).first<{id:string}>();
  const devices = license ? (await env.DB.prepare("SELECT device_id,activated_at FROM license_devices WHERE license_id=? ORDER BY activated_at").bind(license.id).all<{device_id:string;activated_at:number}>()).results.map((item) => ({ deviceId: item.device_id, activatedAt: utcIso(item.activated_at) })) : [];
  return response({ licenseStatus: state.license?.licenseStatus || "none", maxDevices: state.license?.maxDevices || 2, devices }, 200, env, request);
}
