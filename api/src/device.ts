import type { Env, Session } from "./types";
import { ApiFailure } from "./types";
import { extensionSessionSeconds, requireCsrf, sessionFor, takeRate } from "./auth";
import { extensionOriginAllowed, hmac, jsonBody, nowMs, randomToken, sha256, uuid } from "./security";
import { response } from "./http";

const CODE_EXPIRY_MS = 10 * 60_000;
export async function requestDeviceCode(request: Request, env: Env): Promise<Response> {
  if (!extensionOriginAllowed(request, env)) throw new ApiFailure(403, "ORIGIN_DENIED", "请求来源无效。");
  const body = await jsonBody(request, 1024);
  const deviceId = typeof body.deviceId === "string" && /^[0-9a-f-]{36}$/i.test(body.deviceId) ? body.deviceId : "";
  if (!deviceId) throw new ApiFailure(400, "INVALID_DEVICE", "设备标识无效。");
  const now = nowMs();
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const bucket = await hmac(env, `device-ip:${ip}`);
  if (!await takeRate(env, `device:${bucket}`, 10, 3600_000, now)) throw new ApiFailure(429, "RATE_LIMITED", "请求过于频繁，请稍后再试。", 60);
  const deviceCode = randomToken(4).toUpperCase();
  const deviceToken = randomToken();
  await env.DB.prepare("INSERT INTO extension_authorizations(id,device_id,code_hash,token_hash,user_id,status,created_at,expires_at) VALUES(?,?,?,?,NULL,'pending',?,?)").bind(uuid(), deviceId, await hmac(env, `device-code:${deviceCode}`), await sha256(deviceToken), now, now + CODE_EXPIRY_MS).run();
  const verificationUrl = `${env.WEB_ORIGIN}/account?device_code=${deviceCode}`;
  return response({ deviceCode, deviceToken, verificationUrl, expiresAt: new Date(now + CODE_EXPIRY_MS).toISOString(), intervalSeconds: 3 }, 200, env, request);
}
export async function approveDevice(request: Request, env: Env): Promise<Response> {
  const { session, token } = await sessionFor(request, env);
  if (session.kind !== "web") throw new ApiFailure(403, "FORBIDDEN", "请在官网登录后确认。");
  await requireCsrf(request, env, token);
  const body = await jsonBody(request, 1024);
  const code = typeof body.deviceCode === "string" && /^[A-F0-9]{8}$/.test(body.deviceCode) ? body.deviceCode : "";
  if (!code) throw new ApiFailure(400, "INVALID_CODE", "绑定码无效。");
  const codeHash = await hmac(env, `device-code:${code}`);
  const result = await env.DB.prepare("UPDATE extension_authorizations SET status='approved',user_id=? WHERE code_hash=? AND status='pending' AND expires_at>? RETURNING id").bind(session.user_id, codeHash, nowMs()).all();
  if (!result.results.length) {
    const existing = await env.DB.prepare("SELECT status,expires_at FROM extension_authorizations WHERE code_hash=?").bind(codeHash).first<{status:string;expires_at:number}>();
    if (existing && existing.expires_at <= nowMs()) throw new ApiFailure(400, "DEVICE_CODE_EXPIRED", "绑定码已过期，请返回插件重新发起绑定。");
    if (existing) throw new ApiFailure(400, "DEVICE_CODE_USED", "绑定码已使用，请返回插件检查连接状态或重新发起绑定。");
    throw new ApiFailure(400, "INVALID_CODE", "绑定码无效，请返回插件重新发起绑定。");
  }
  return response({ ok: true }, 200, env, request);
}
export async function deviceCodeStatus(request: Request, env: Env): Promise<Response> {
  const { session } = await sessionFor(request, env);
  if (session.kind !== "web") throw new ApiFailure(403, "FORBIDDEN", "请在官网登录后查看绑定状态。");
  const code = new URL(request.url).searchParams.get("device_code") || "";
  if (!/^[A-F0-9]{8}$/.test(code)) throw new ApiFailure(400, "INVALID_CODE", "绑定码无效。");
  const authorization = await env.DB.prepare("SELECT status,user_id,expires_at FROM extension_authorizations WHERE code_hash=?").bind(await hmac(env, `device-code:${code}`)).first<{status:string;user_id:string|null;expires_at:number}>();
  let status = "invalid";
  if (authorization) {
    if (authorization.expires_at <= nowMs()) status = "expired";
    else if (authorization.status === "pending") status = "pending";
    else if (authorization.status === "approved" && authorization.user_id === session.user_id) status = "approved";
    else status = "used";
  }
  return response({ status }, 200, env, request);
}
async function ensureLicenseDevice(env: Env, session: Pick<Session,"user_id"|"device_id">): Promise<void> {
  if (!session.device_id) return;
  const license = await env.DB.prepare("SELECT id,max_devices FROM licenses WHERE user_id=? AND status='active'").bind(session.user_id).first<{id:string;max_devices:number}>();
  if (!license) return;
  const now = nowMs();
  const result = await env.DB.prepare("INSERT INTO license_devices(license_id,device_id,activated_at,last_verified_at) SELECT ?,?,?,? WHERE (SELECT count(*) FROM license_devices WHERE license_id=?) < ? OR EXISTS(SELECT 1 FROM license_devices WHERE license_id=? AND device_id=?) ON CONFLICT(license_id,device_id) DO UPDATE SET last_verified_at=excluded.last_verified_at RETURNING device_id").bind(license.id, session.device_id, now, now, license.id, license.max_devices, license.id, session.device_id).all();
  if (!result.results.length) throw new ApiFailure(403, "LICENSE_DEVICE_LIMIT", "已达到设备数量上限。");
}
export { ensureLicenseDevice };
export async function exchangeDevice(request: Request, env: Env): Promise<Response> {
  if (!extensionOriginAllowed(request, env)) throw new ApiFailure(403, "ORIGIN_DENIED", "请求来源无效。");
  const body = await jsonBody(request, 1024);
  const deviceToken = typeof body.deviceToken === "string" && /^[a-f0-9]{64}$/i.test(body.deviceToken) ? body.deviceToken : "";
  if (!deviceToken) throw new ApiFailure(400, "INVALID_DEVICE_TOKEN", "绑定请求无效。");
  const tokenHash = await sha256(deviceToken);
  const authorization = await env.DB.prepare("SELECT id,user_id,device_id,status,expires_at FROM extension_authorizations WHERE token_hash=?").bind(tokenHash).first<{id:string;user_id:string|null;device_id:string;status:string;expires_at:number}>();
  if (!authorization || authorization.expires_at <= nowMs()) throw new ApiFailure(400, "DEVICE_CODE_EXPIRED", "绑定码已过期。");
  if (authorization.status === "pending") return response({ status: "pending" }, 200, env, request);
  if (authorization.status !== "approved" || !authorization.user_id) throw new ApiFailure(400, "DEVICE_CODE_USED", "绑定码已使用。");
  const now = nowMs();
  const nonce = uuid();
  const token = randomToken();
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE extension_authorizations SET status='redeemed',redeem_nonce=? WHERE id=? AND status='approved' AND expires_at>? RETURNING user_id").bind(nonce, authorization.id, now),
    env.DB.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,device_id,created_at,expires_at) SELECT ?,?,user_id,'extension',device_id,?,? FROM extension_authorizations WHERE id=? AND redeem_nonce=?").bind(uuid(), await sha256(token), now, now + extensionSessionSeconds() * 1000, authorization.id, nonce),
  ]);
  if (!result[0].results.length || result[1].meta.changes !== 1) throw new ApiFailure(400, "DEVICE_CODE_USED", "绑定码已使用。");
  return response({ status: "approved", accessToken: token, expiresAt: new Date(now + extensionSessionSeconds() * 1000).toISOString() }, 200, env, request);
}
