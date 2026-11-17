import {LOGIN_USER_SQL,REGISTRATION_IDENTITY_SQL} from "./admin-read-queries.js";
import {futureCampaignStatements} from "./campaigns";
import { eligibleReferralCode, referralRegistrationStatement, referralsEnabled } from "./referrals";
import type { Env } from "./types";
import { ApiFailure, type RegistrationDiagnostics } from "./types";
import { sendCode, takeRate } from "./auth";
import { hmac, jsonBody, nowMs, randomToken, requireWebOrigin, sessionCookie, sha256, uuid } from "./security";
import { response } from "./http";

const SESSION_MS = 30 * 86400_000;
// Free-tier CPU headroom opt-in: new/reset credentials use a shorter PBKDF2
// verifier only after PASSWORD_FREE_CPU_ENABLED=1 and a rollback-compatible release.
// This deliberately trades offline brute-force resistance for lower per-request
// CPU. Retain the 12-char minimum, secret pepper and existing rate limits.
// 100k/210k historical hashes must remain verifiable: never silently rewrite
// them without the plaintext password and never skip their full verification.
// Never switch the creation cost simply by deploying this release. First ship
// the verifier compatibility, then independently enable the Free CPU mode.
const DEFAULT_ITERATIONS = 100_000;
const FREE_ITERATIONS = 60_000;
const SUPPORTED_ITERATIONS = new Set([FREE_ITERATIONS, DEFAULT_ITERATIONS, 210_000]);
function creationIterations(env: Env): number {
  return env.PASSWORD_FREE_CPU_ENABLED === "1" ? FREE_ITERATIONS : DEFAULT_ITERATIONS;
}
const encoder = new TextEncoder();
function emailFrom(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiFailure(400,"INVALID_EMAIL","邮箱格式无效。");
  return email;
}
function usernameFrom(value: unknown): string {
  const username = typeof value === "string" ? value.trim() : "";
  if (!/^[\p{L}\p{N}_]{3,24}$/u.test(username)) throw new ApiFailure(400,"INVALID_USERNAME","用户名需为 3–24 位字母、数字或下划线。");
  return username;
}
function passwordFrom(value: unknown): string {
  const password = typeof value === "string" ? value : "";
  if (password.length < 12 || encoder.encode(password).length > 256) throw new ApiFailure(400,"INVALID_PASSWORD","密码至少 12 位，且不能超过 256 字节。");
  return password;
}
function isPendingUsernameConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: pending_registrations\.username/i.test(error.message);
}
function codeFrom(value: unknown): string {
  const code = typeof value === "string" && /^\d{6}$/.test(value) ? value : "";
  if (!code) throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
  return code;
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, b => b.toString(16).padStart(2,"0")).join(""); }
function fromHex(value: string): Uint8Array { return Uint8Array.from(value.match(/../g) || [], value => parseInt(value,16)); }
async function derive(env: Env, password: string, salt: Uint8Array, iterations: number): Promise<string> {
  if (!env.PASSWORD_PEPPER || env.PASSWORD_PEPPER.length < 24) throw new ApiFailure(503,"AUTH_NOT_CONFIGURED","账户服务尚未配置。");
  const key = await crypto.subtle.importKey("raw",encoder.encode(`${password}\u0000${env.PASSWORD_PEPPER}`),"PBKDF2",false,["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:new Uint8Array(salt),iterations},key,256);
  return hex(new Uint8Array(bits));
}
export async function hashPassword(env: Env, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = creationIterations(env);
  return `pbkdf2-sha256:${iterations}:${hex(salt)}:${await derive(env,password,salt,iterations)}`;
}
export async function verifyPassword(env: Env, password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split(":") || [];
  const iterations = Number(parts[1]);
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256" || !SUPPORTED_ITERATIONS.has(iterations) || String(iterations) !== parts[1] || !/^[0-9a-f]{32}$/.test(parts[2]) || !/^[0-9a-f]{64}$/.test(parts[3])) return false;
  const actual = fromHex(await derive(env,password,fromHex(parts[2]),iterations));
  const expected = fromHex(parts[3]);
  let mismatch = 0; for (let i=0;i<32;i++) mismatch |= actual[i]^expected[i];
  return mismatch === 0;
}
async function verifyTurnstile(request: Request, env: Env, token: unknown): Promise<void> {
  if (typeof token !== "string" || token.length < 1 || token.length > 2048) throw new ApiFailure(400,"TURNSTILE_REQUIRED","请先完成人机验证。");
  if (!env.TURNSTILE_SECRET_KEY) throw new ApiFailure(503,"TURNSTILE_NOT_CONFIGURED","人机验证尚未配置。");
  if (env.ENVIRONMENT === "development" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.WEB_ORIGIN) && env.TURNSTILE_SECRET_KEY === "1x0000000000000000000000000000000AA" && token === "local-test-token") return;
  if (env.ENVIRONMENT !== "development" && /^\dx0{20,}/.test(env.TURNSTILE_SECRET_KEY)) throw new ApiFailure(503,"TURNSTILE_NOT_CONFIGURED","预发布和生产环境不能使用测试密钥。");
  const form = new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token,idempotency_key:uuid()});
  const ip = request.headers.get("CF-Connecting-IP"); if (ip) form.set("remoteip",ip);
  let result: {success?:boolean;hostname?:string;action?:string};
  try {
    const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:form,signal:AbortSignal.timeout(10_000)});
    result = await verify.json();
  } catch { throw new ApiFailure(503,"TURNSTILE_UNAVAILABLE","人机验证暂时不可用，请稍后重试。"); }
  if (!result.success || (env.ENVIRONMENT !== "development" && (result.hostname !== new URL(env.WEB_ORIGIN).hostname || result.action !== "register"))) throw new ApiFailure(400,"TURNSTILE_INVALID","人机验证失败，请重新尝试。");
}
async function newSession(env: Env, userId: string): Promise<{token:string; statement:D1PreparedStatement}> {
  const token = randomToken(); const now = nowMs();
  return {token,statement:env.DB.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,device_id,created_at,expires_at) VALUES(?,? ,?,'web',NULL,?,?)").bind(uuid(),await sha256(token),userId,now,now+SESSION_MS)};
}
const freshCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6,"0");
async function rate(request: Request,env: Env,purpose:string,email:string,now:number) {
  const ip = await hmac(env,`ip:${request.headers.get("CF-Connecting-IP") || "local"}`);
  const address = await hmac(env,`email:${email}`);
  const localLogin = purpose === "login" && env.ENVIRONMENT === "development" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.WEB_ORIGIN);
  const ipLimit = localLogin ? 60 : 12;
  const emailLimit = localLogin ? 30 : 5;
  if (!await takeRate(env,`${purpose}-ip:${ip}`,ipLimit,3600_000,now) || !await takeRate(env,`${purpose}-email:${address}`,emailLimit,3600_000,now)) throw new ApiFailure(429,"RATE_LIMITED","请求过于频繁，请稍后再试。",60);
}
export async function register(request: Request,env: Env,diagnostics?: RegistrationDiagnostics): Promise<Response> {
  if (diagnostics) diagnostics.stage = "origin_validation";
  requireWebOrigin(request,env);
  if (diagnostics) diagnostics.stage = "request_validation";
  const localFeedback = env.ENVIRONMENT === "development" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.WEB_ORIGIN);
  const body = await jsonBody(request,4096);
  const username = usernameFrom(body.username); const email = emailFrom(body.email); const password = passwordFrom(body.password);
  const blocked = (env.DISPOSABLE_EMAIL_DOMAINS || "").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
  if (blocked.includes(email.split("@")[1])) throw new ApiFailure(400,"EMAIL_NOT_ALLOWED","该邮箱暂不支持注册，请使用常用邮箱。");
  const now = nowMs();
  if (diagnostics) diagnostics.stage = "rate_limit";
  await rate(request,env,"register",email,now);
  if (diagnostics) diagnostics.stage = "registration_settings";
  const enabled = await env.DB.prepare("SELECT value FROM system_settings WHERE key='registration_enabled'").first<{value:string}>();
  if (enabled?.value !== "1") throw new ApiFailure(503,"REGISTRATION_CLOSED","注册暂未开放。");
  if (diagnostics) diagnostics.stage = "turnstile";
  await verifyTurnstile(request,env,body.turnstileToken);
  if (diagnostics) diagnostics.stage = "account_lookup";
  const taken = await env.DB.prepare(REGISTRATION_IDENTITY_SQL).bind(email,username).first();
  if (taken) return response({ok:true,message:"如果信息可用于注册，验证码已发送。",...(localFeedback?{codeLogged:false}:{})},200,env,request);
  const referralEnabled=await referralsEnabled(env);
  const referralCode=referralEnabled?await eligibleReferralCode(env,body.referralCode):null;
  if (diagnostics) diagnostics.stage = "registration_code_hash";
  const code = freshCode(); const codeHash = await hmac(env,`register:${email}:${code}`);
  if (diagnostics) diagnostics.stage = "password_hash";
  const passwordHash = await hashPassword(env,password);
  if (diagnostics) diagnostics.stage = "pending_registration_write";
  let inserted;
  const referralColumn=referralEnabled?",referral_code":"";
  const referralValue=referralEnabled?",?":"";
  const immutableReferral=referralEnabled?",referral_code=COALESCE(pending_registrations.referral_code,excluded.referral_code)":"";
  const registerSql="INSERT INTO pending_registrations(email,username,password_hash,code_hash,created_at,expires_at,sent_at,attempts"+referralColumn+") VALUES(?,?,?,?,?,?,?,0"+referralValue+") "+
    "ON CONFLICT(email) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,code_hash=excluded.code_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0"+
    immutableReferral+" WHERE pending_registrations.sent_at<=?";
  const registerValues=[email,username,passwordHash,codeHash,now,now+600_000,now,...(referralEnabled?[referralCode]:[]),now-60_000];
  try { inserted=await env.DB.prepare(registerSql).bind(...registerValues).run(); }
  catch (error) {
    if (isPendingUsernameConflict(error)) throw new ApiFailure(409,"USERNAME_UNAVAILABLE","用户名暂不可用，请换一个。");
    throw error;
  }
  if (inserted.meta.changes) {
    if (diagnostics) diagnostics.stage = "mail_send";
    try { await sendCode(env,email,code,"register"); }
    catch (error) { await env.DB.prepare("DELETE FROM pending_registrations WHERE email=? AND code_hash=?").bind(email,codeHash).run().catch(()=>{}); throw error; }
  }
  return response({ok:true,message:"如果信息可用于注册，验证码已发送。",...(localFeedback?{codeLogged:Boolean(inserted.meta.changes)}:{})},200,env,request);
}
export async function verifyRegistration(request: Request,env: Env): Promise<Response> {
  requireWebOrigin(request,env); const body = await jsonBody(request,1024);
  const email = emailFrom(body.email); const code = codeFrom(body.code); const now = nowMs();
  await rate(request,env,"verify-register",email,now);
  const referralEnabled=await referralsEnabled(env);
  const row = await env.DB.prepare("SELECT username,password_hash,code_hash,expires_at,attempts"+(referralEnabled?",referral_code":"")+" FROM pending_registrations WHERE email=?").bind(email).first<{username:string;password_hash:string;code_hash:string;expires_at:number;attempts:number;referral_code?:string|null}>();
  if (!row || row.expires_at<=now || row.attempts>=5 || row.code_hash!==await hmac(env,`register:${email}:${code}`)) {
    await env.DB.prepare("UPDATE pending_registrations SET attempts=attempts+1 WHERE email=? AND attempts<5").bind(email).run();
    throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
  }
  const userId = uuid(); const session = await newSession(env,userId);
  const setting = await env.DB.prepare("SELECT value FROM system_settings WHERE key='signup_grant'").first<{value:string}>();
  const grant = Number(setting?.value || 200);
  if (!Number.isInteger(grant) || grant<1 || grant>1000) throw new ApiFailure(503,"GRANT_NOT_CONFIGURED","免费额度设置无效。");
  const futureGrants=await futureCampaignStatements(env,userId,now);
  try { await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,status,role) VALUES(?,?,?,?,?,?,'active','user')").bind(userId,email,now,now,row.username,row.password_hash),
    // Register the account without spendable signup credits. The first
    // eligible extension exchange grants these atomically against a device
    // claim; email verification alone must not issue reusable welcome credit.
    env.DB.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,0,0,?,?)").bind(userId,now,now),
    env.DB.prepare("INSERT INTO signup_benefit_claims(user_id,grant_amount,status,created_at) VALUES(?,?,'pending',?)").bind(userId,grant,now),
    session.statement,
    ...futureGrants,
    ...(referralEnabled&&row.referral_code?[referralRegistrationStatement(env,userId,row.referral_code,now)]:[]),
    env.DB.prepare("DELETE FROM pending_registrations WHERE email=? AND code_hash=?").bind(email,row.code_hash),
  ]); } catch { throw new ApiFailure(409,"REGISTRATION_CONFLICT","注册信息已被使用，请重新注册或登录。"); }
  return response({ok:true},200,env,request,{"Set-Cookie":sessionCookie(session.token,SESSION_MS/1000)});
}
export async function passwordLogin(request: Request,env: Env): Promise<Response> {
  requireWebOrigin(request,env); const body=await jsonBody(request,2048);
  const identity=typeof body.identity==="string"?body.identity.trim().toLowerCase():"";
  const password=typeof body.password==="string"?body.password:"";
  if (!identity || password.length>256) throw new ApiFailure(400,"INVALID_CREDENTIALS","账号或密码错误。");
  const now=nowMs(); await rate(request,env,"login",identity,now);
  const user=await env.DB.prepare(LOGIN_USER_SQL).bind(identity,identity).first<{id:string;password_hash:string|null;status:string}>();
  if (!user?.password_hash || !await verifyPassword(env,password,user.password_hash)) throw new ApiFailure(401,"INVALID_CREDENTIALS","账号或密码错误。");
  if (user.status==="frozen") throw new ApiFailure(403,"ACCOUNT_FROZEN","账户已暂停，请联系支持。");
  const session=await newSession(env,user.id); await session.statement.run();
  // Paid-only migration stage: re-derive 60k only *after* a correct password
  // and a successful session write. Both switches must be explicitly enabled.
  // The first old-hash verification still consumes its original CPU and MUST
  // happen on Paid. An optimistic update never overwrites a concurrent reset,
  // unfreeze/lock, or administrator credential change.
  //
  // This is best-effort housekeeping, not a reason to deny a valid login:
  // do not disclose the stored work factor, password, hash or failure reason.
  if (env.PASSWORD_FREE_CPU_ENABLED==="1" &&
      env.PASSWORD_LEGACY_MIGRATION_ENABLED==="1" &&
      user.status==="active" && !user.password_hash.startsWith("pbkdf2-sha256:60000:")) {
    try {
      const optimizedHash=await hashPassword(env,password);
      await env.DB.prepare("UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND status='active'")
        .bind(optimizedHash,user.id,user.password_hash).run();
    } catch {
      // Successful authentication is independent of an optional rehash write.
    }
  }
  return response({ok:true},200,env,request,{"Set-Cookie":sessionCookie(session.token,SESSION_MS/1000)});
}
export async function requestPasswordReset(request: Request,env: Env): Promise<Response> {
  requireWebOrigin(request,env); const body=await jsonBody(request,1024); const email=emailFrom(body.email); const now=nowMs();
  await rate(request,env,"reset",email,now);
  const user=await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first<{id:string}>();
  if (user) {
    const code=freshCode(); const hash=await hmac(env,`reset:${user.id}:${code}`);
    const saved=await env.DB.prepare(`INSERT INTO password_resets(user_id,code_hash,expires_at,sent_at,attempts) VALUES(?,?,?,?,0)
      ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0 WHERE password_resets.sent_at<=?`).bind(user.id,hash,now+600_000,now,now-60_000).run();
    if (saved.meta.changes) { try { await sendCode(env,email,code,"reset"); } catch(error) { await env.DB.prepare("DELETE FROM password_resets WHERE user_id=? AND code_hash=?").bind(user.id,hash).run().catch(()=>{}); throw error; } }
  }
  return response({ok:true,message:"如果该邮箱已有账户，验证码已发送。"},200,env,request);
}
export async function resetPassword(request: Request,env: Env): Promise<Response> {
  requireWebOrigin(request,env); const body=await jsonBody(request,2048); const email=emailFrom(body.email); const code=codeFrom(body.code); const password=passwordFrom(body.password); const now=nowMs();
  await rate(request,env,"verify-reset",email,now);
  const row=await env.DB.prepare("SELECT users.id,password_resets.code_hash,password_resets.expires_at,password_resets.attempts FROM users JOIN password_resets ON users.id=password_resets.user_id WHERE users.email=?").bind(email).first<{id:string;code_hash:string;expires_at:number;attempts:number}>();
  if (!row || row.expires_at<=now || row.attempts>=5 || row.code_hash!==await hmac(env,`reset:${row.id}:${code}`)) {
    if(row) await env.DB.prepare("UPDATE password_resets SET attempts=attempts+1 WHERE user_id=? AND attempts<5").bind(row.id).run();
    throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
  }
  const hash=await hashPassword(env,password);
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash=? WHERE id=? AND EXISTS(SELECT 1 FROM password_resets WHERE user_id=? AND code_hash=? AND expires_at>? AND attempts<5)").bind(hash,row.id,row.id,row.code_hash,now),
    env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)").bind(now,row.id,row.id,hash),
    env.DB.prepare("DELETE FROM password_resets WHERE user_id=? AND code_hash=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)").bind(row.id,row.code_hash,row.id,hash),
  ]);
  if(result[0].meta.changes!==1)throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
  return response({ok:true},200,env,request);
}
