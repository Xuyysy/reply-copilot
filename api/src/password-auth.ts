import type { Env } from "./types";
import { ApiFailure, type RegistrationDiagnostics } from "./types";
import { sendCode, takeRate } from "./auth";
import { hmac, jsonBody, nowMs, randomToken, requireWebOrigin, sessionCookie, sha256, uuid } from "./security";
import { response } from "./http";

const SESSION_MS = 30 * 86400_000;
const ITERATIONS = 100_000;
const SUPPORTED_ITERATIONS = new Set([ITERATIONS, 210_000]);
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
async function hashPassword(env: Env, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256:${ITERATIONS}:${hex(salt)}:${await derive(env,password,salt,ITERATIONS)}`;
}
async function verifyPassword(env: Env, password: string, stored: string | null): Promise<boolean> {
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
  const taken = await env.DB.prepare("SELECT id FROM users WHERE email=? OR username=? LIMIT 1").bind(email,username).first();
  if (taken) return response({ok:true,message:"如果信息可用于注册，验证码已发送。",...(localFeedback?{codeLogged:false}:{})},200,env,request);
  if (diagnostics) diagnostics.stage = "registration_code_hash";
  const code = freshCode(); const codeHash = await hmac(env,`register:${email}:${code}`);
  if (diagnostics) diagnostics.stage = "password_hash";
  const passwordHash = await hashPassword(env,password);
  if (diagnostics) diagnostics.stage = "pending_registration_write";
  let inserted;
  try { inserted = await env.DB.prepare(`INSERT INTO pending_registrations(email,username,password_hash,code_hash,created_at,expires_at,sent_at,attempts) VALUES(?,?,?,?,?,?,?,0)
    ON CONFLICT(email) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,code_hash=excluded.code_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0
    WHERE pending_registrations.sent_at<=?`).bind(email,username,passwordHash,codeHash,now,now+600_000,now,now-60_000).run(); }
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
  const row = await env.DB.prepare("SELECT username,password_hash,code_hash,expires_at,attempts FROM pending_registrations WHERE email=?").bind(email).first<{username:string;password_hash:string;code_hash:string;expires_at:number;attempts:number}>();
  if (!row || row.expires_at<=now || row.attempts>=5 || row.code_hash!==await hmac(env,`register:${email}:${code}`)) {
    await env.DB.prepare("UPDATE pending_registrations SET attempts=attempts+1 WHERE email=? AND attempts<5").bind(email).run();
    throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
  }
  const userId = uuid(); const session = await newSession(env,userId);
  const setting = await env.DB.prepare("SELECT value FROM system_settings WHERE key='signup_grant'").first<{value:string}>();
  const grant = Number(setting?.value || 200);
  if (!Number.isInteger(grant) || grant<1 || grant>1000) throw new ApiFailure(503,"GRANT_NOT_CONFIGURED","免费额度设置无效。");
  try { await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,status,role) VALUES(?,?,?,?,?,?,'active','user')").bind(userId,email,now,now,row.username,row.password_hash),
    env.DB.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,?,0,?,?)").bind(userId,grant,now,now),
    env.DB.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,consumed_credits,permanently_revoked_credits,granted_at,history_confidence,status) VALUES(?,?,'free','signup',?,?,0,0,?,'tracked','active')").bind(`signup:${userId}`,userId,grant,grant,now),
    env.DB.prepare("INSERT INTO credit_grants(user_id,grant_type,amount,created_at) VALUES(?,'signup',?,?)").bind(userId,grant,now),
    env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) VALUES(?,?,'signup_grant',?,0,?,?)").bind(uuid(),userId,grant,userId,now),
    session.statement,
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
  const user=await env.DB.prepare("SELECT id,password_hash,status FROM users WHERE email=? OR username=? LIMIT 1").bind(identity,identity).first<{id:string;password_hash:string|null;status:string}>();
  if (!user?.password_hash || !await verifyPassword(env,password,user.password_hash)) throw new ApiFailure(401,"INVALID_CREDENTIALS","账号或密码错误。");
  if (user.status==="frozen") throw new ApiFailure(403,"ACCOUNT_FROZEN","账户已暂停，请联系支持。");
  const session=await newSession(env,user.id); await session.statement.run();
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
