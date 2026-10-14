import type { Env, Session } from "./types";
import { ApiFailure } from "./types";
import { clearSessionCookie, cookie, hmac, jsonBody, nowMs, randomToken, requireWebOrigin, sessionCookie, sha256, uuid } from "./security";
import { response } from "./http";

const WEB_SESSION_SECONDS = 30 * 86400;
const EXTENSION_SESSION_SECONDS = 90 * 86400;

function emailFrom(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiFailure(400, "INVALID_EMAIL", "邮箱格式无效。");
  return email;
}
export async function takeRate(env: Env, bucket: string, limit: number, periodMs: number, now: number): Promise<boolean> {
  const period = Math.floor(now / periodMs) * periodMs;
  const result = await env.DB.prepare("INSERT INTO rate_limits(bucket,period_start,used) VALUES(?,?,1) ON CONFLICT(bucket,period_start) DO UPDATE SET used=used+1 WHERE used < ? RETURNING used").bind(bucket, period, limit).all();
  return result.results.length === 1;
}
async function sendCode(env: Env, email: string, code: string): Promise<void> {
  if (env.ENVIRONMENT === "development" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.WEB_ORIGIN)) { console.log(`[LOCAL EMAIL ONLY] ${email}: ${code}`); return; }
  if (!env.MAIL_API_KEY || !env.MAIL_FROM) throw new ApiFailure(503, "MAIL_NOT_CONFIGURED", "邮件服务尚未开放。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${env.MAIL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: "Reply Copilot sign-in code", text: `Your Reply Copilot sign-in code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.` }),
    });
    if (!sent.ok) throw new Error("Mail provider rejected request");
  } catch { throw new ApiFailure(503, "MAIL_UNAVAILABLE", "邮件暂时无法发送，请稍后再试。"); }
  finally { clearTimeout(timer); }
}
export async function requestCode(request: Request, env: Env): Promise<Response> {
  requireWebOrigin(request, env);
  const body = await jsonBody(request, 1024);
  const email = emailFrom(body.email);
  const now = nowMs();
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const ipBucket = await hmac(env, `ip:${ip}`);
  const emailBucket = await hmac(env, `email:${email}`);
  if (!await takeRate(env, `code-ip:${ipBucket}`, 12, 3600_000, now) || !await takeRate(env, `code-email:${emailBucket}`, 5, 3600_000, now)) throw new ApiFailure(429, "RATE_LIMITED", "请求过于频繁，请稍后再试。", 60);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const hash = await hmac(env, `code:${email}:${code}`);
  const result = await env.DB.prepare("INSERT INTO email_verifications(email,code_hash,expires_at,sent_at,attempts,used_at,used_nonce) VALUES(?,?,?,?,0,NULL,NULL) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0,used_at=NULL,used_nonce=NULL WHERE email_verifications.sent_at <= ? RETURNING email").bind(email, hash, now + 10 * 60_000, now, now - 60_000).all();
  if (result.results.length) {
    try { await sendCode(env, email, code); }
    catch (error) {
      await env.DB.prepare("DELETE FROM email_verifications WHERE email=? AND code_hash=? AND used_at IS NULL").bind(email, hash).run().catch(() => {});
      throw error;
    }
  }
  return response({ ok: true, message: "如果邮箱可用，验证码已发送。" }, 200, env, request);
}
export async function verifyCode(request: Request, env: Env): Promise<Response> {
  requireWebOrigin(request, env);
  const body = await jsonBody(request, 1024);
  const email = emailFrom(body.email);
  const code = typeof body.code === "string" && /^\d{6}$/.test(body.code) ? body.code : "";
  if (!code) throw new ApiFailure(400, "INVALID_CODE", "验证码无效或已过期。");
  const now = nowMs();
  const codeHash = await hmac(env, `code:${email}:${code}`);
  const nonce = uuid();
  const userId = uuid();
  const sessionId = uuid();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE email_verifications SET used_at=?,used_nonce=?,attempts=attempts+1 WHERE email=? AND code_hash=? AND used_at IS NULL AND expires_at>? AND attempts<5 RETURNING email").bind(now, nonce, email, codeHash, now),
    env.DB.prepare("INSERT INTO users(id,email,email_verified_at,created_at) SELECT ?,email,?,? FROM email_verifications WHERE email=? AND used_nonce=? ON CONFLICT(email) DO NOTHING").bind(userId, now, now, email, nonce),
    env.DB.prepare("INSERT INTO trials(user_id,started_at,expires_at,status) SELECT id,?,?, 'active' FROM users WHERE email=? AND EXISTS(SELECT 1 FROM email_verifications WHERE email=? AND used_nonce=?) ON CONFLICT(user_id) DO NOTHING").bind(now, now + 7 * 86400_000, email, email, nonce),
    env.DB.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,device_id,created_at,expires_at) SELECT ?,?,id,'web',NULL,?,? FROM users WHERE email=? AND EXISTS(SELECT 1 FROM email_verifications WHERE email=? AND used_nonce=?)").bind(sessionId, tokenHash, now, now + WEB_SESSION_SECONDS * 1000, email, email, nonce),
  ]);
  if (!result[0].results.length || result[3].meta.changes !== 1) {
    await env.DB.prepare("UPDATE email_verifications SET attempts=attempts+1 WHERE email=? AND used_at IS NULL AND expires_at>? AND attempts<5").bind(email, now).run();
    throw new ApiFailure(400, "INVALID_CODE", "验证码无效或已过期。");
  }
  return response({ ok: true }, 200, env, request, { "Set-Cookie": sessionCookie(token, WEB_SESSION_SECONDS) });
}
export async function sessionFor(request: Request, env: Env): Promise<{ session: Session; token: string }> {
  const bearer = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1] || "";
  const token = bearer || cookie(request, "rc_session");
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) throw new ApiFailure(401, "AUTH_REQUIRED", "请先登录。");
  const hash = await sha256(token);
  const kind = bearer ? "extension" : "web";
  const session = await env.DB.prepare("SELECT sessions.id,sessions.user_id,users.email,sessions.kind,sessions.device_id,sessions.csrf_token_hash,sessions.expires_at FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND sessions.kind=? AND revoked_at IS NULL AND expires_at>?").bind(hash, kind, nowMs()).first<Session>();
  if (!session) throw new ApiFailure(401, "AUTH_REQUIRED", "登录已失效，请重新登录。");
  return { session, token };
}
export async function requireCsrf(request: Request, env: Env, token: string): Promise<void> {
  requireWebOrigin(request, env);
  if (!request.headers.get("X-Reply-Copilot-Action")) throw new ApiFailure(403, "CSRF_DENIED", "请求缺少安全标记。");
  const expected = await hmac(env, `csrf:${token}`);
  if (request.headers.get("X-CSRF-Token") !== expected) throw new ApiFailure(403, "CSRF_DENIED", "安全验证失败，请刷新页面。");
}
export async function csrf(request: Request, env: Env): Promise<Response> {
  const { session, token } = await sessionFor(request, env);
  if (session.kind !== "web") throw new ApiFailure(403, "FORBIDDEN", "请求来源无效。");
  return response({ csrfToken: await hmac(env, `csrf:${token}`) }, 200, env, request);
}
export async function logout(request: Request, env: Env): Promise<Response> {
  const { session, token } = await sessionFor(request, env);
  if (session.kind === "web") await requireCsrf(request, env, token);
  await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(nowMs(), session.id).run();
  return response({ ok: true }, 200, env, request, session.kind === "web" ? { "Set-Cookie": clearSessionCookie() } : {});
}
export function extensionSessionSeconds(): number { return EXTENSION_SESSION_SECONDS; }
