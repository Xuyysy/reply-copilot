import type { Env, Session } from "./types";
import { ApiFailure } from "./types";
import { requireCsrf, sessionFor } from "./auth";

export async function requireAdminSession(request: Request, env: Env, write = false): Promise<Session> {
  if (env.ENVIRONMENT !== "development" && env.ADMIN_PORTAL_ENABLED !== "1") {
    throw new ApiFailure(404, "NOT_FOUND", "接口不存在。");
  }
  const { session, token } = await sessionFor(request, env);
  if (session.kind !== "web") throw new ApiFailure(403, "FORBIDDEN", "管理员需要网页登录。");
  const user = await env.DB.prepare("SELECT u.role,u.status,u.email_verified_at,s.user_id AS bound_user_id FROM users u LEFT JOIN site_administrator s ON s.id=1 WHERE u.id=?")
    .bind(session.user_id).first<{ role: string; status: string; email_verified_at: number | null; bound_user_id:string|null }>();
  if (user?.role !== "admin" || user.status !== "active" || !user.email_verified_at) {
    throw new ApiFailure(403, "FORBIDDEN", "没有管理员权限。");
  }
  if (user.bound_user_id !== session.user_id) throw new ApiFailure(403,"FORBIDDEN","没有管理员权限。");
  if (write) {
    await requireCsrf(request, env, token);
    const proof = await env.DB.prepare("SELECT expires_at FROM admin_reauth_sessions WHERE session_id=?").bind(session.id).first<{expires_at:number}>();
    if (!proof || proof.expires_at <= Date.now()) throw new ApiFailure(403,"ADMIN_REAUTH_REQUIRED","敏感操作需要重新验证登录密码。");
  }
  return session;
}

/** A single, separately gated Staging diagnostic capability; this does not enable admin APIs. */
export async function requireStagingDiagnosticSession(request: Request, env: Env): Promise<Session> {
  if (env.ENVIRONMENT !== "staging" || env.XIAODOU_NETWORK_DIAGNOSTIC_ENABLED !== "1") {
    throw new ApiFailure(404, "NOT_FOUND", "接口不存在。");
  }
  const { session, token } = await sessionFor(request, env);
  if (session.kind !== "web") throw new ApiFailure(403, "FORBIDDEN", "请使用官网登录会话。");
  const user = await env.DB.prepare("SELECT status,email_verified_at FROM users WHERE id=?")
    .bind(session.user_id).first<{ status: string; email_verified_at: number | null }>();
  if (user?.status !== "active" || !user.email_verified_at) {
    throw new ApiFailure(403, "FORBIDDEN", "当前账户不可用。");
  }
  await requireCsrf(request, env, token);
  return session;
}
