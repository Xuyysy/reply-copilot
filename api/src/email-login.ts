import type {Env} from "./types";
import {ApiFailure} from "./types";
import {sendCode,takeRate} from "./auth";
import {hmac,jsonBody,nowMs,randomToken,requireWebOrigin,sessionCookie,sha256,uuid} from "./security";
import {response} from "./http";

// Paid-stage opt-in; code is inert until the separately approved D1 schema
// has been applied and EMAIL_OTP_LOGIN_ENABLED=1 is explicitly configured.
// Restrict to verified, active ordinary users; admin auth must retain its
// independent security and reauthentication flow.
const SESSION_SECONDS=30*86400;
const GENERIC_MESSAGE="如果此邮箱已注册且可用于登录，验证码已发送。";
function ensureEnabled(env:Env):void {
  if(env.EMAIL_OTP_LOGIN_ENABLED!=="1")throw new ApiFailure(404,"NOT_FOUND","此功能尚未开放。");
}
function normalizeEmail(body:Record<string,unknown>):string {
  const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
  if(email.length>254||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))
    throw new ApiFailure(400,"INVALID_EMAIL","邮箱格式无效。");
  return email;
}
async function checkRate(request:Request,env:Env,purpose:string,email:string,now:number):Promise<void>{
  const ip=request.headers.get("CF-Connecting-IP")||"local";
  const [ipHash,emailHash]=await Promise.all([hmac(env,`otp-ip:${ip}`),hmac(env,`otp-email:${email}`)]);
  if(!await takeRate(env,`${purpose}-ip:${ipHash}`,12,3600_000,now)||
     !await takeRate(env,`${purpose}-email:${emailHash}`,5,3600_000,now))
    throw new ApiFailure(429,"RATE_LIMITED","请求过于频繁，请稍后重试。",60);
}
export async function requestEmailLogin(request:Request,env:Env):Promise<Response>{
  ensureEnabled(env);requireWebOrigin(request,env);
  const email=normalizeEmail(await jsonBody(request,1024)),now=nowMs();
  await checkRate(request,env,"otp-send",email,now);
  // Do not return whether the email belongs to a known account.
  const user=await env.DB.prepare("SELECT id FROM users WHERE email=? AND email_verified_at IS NOT NULL AND status='active' AND role='user'")
    .bind(email).first<{id:string}>();
  if(!user)return response({ok:true,message:GENERIC_MESSAGE},200,env,request);
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%100_000_000).padStart(8,"0");
  const hash=await hmac(env,`email-login:${user.id}:${code}`);
  const inserted=await env.DB.prepare(`INSERT INTO email_login_challenges(user_id,code_hash,expires_at,sent_at,attempts,consumed_at,consumed_nonce)
    VALUES(?,?,?,?,0,NULL,NULL)
    ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,
      sent_at=excluded.sent_at,attempts=0,consumed_at=NULL,consumed_nonce=NULL
      WHERE email_login_challenges.sent_at<=?`)
    .bind(user.id,hash,now+600_000,now,now-60_000).run();
  if(inserted.meta.changes){
    try {await sendCode(env,email,code,"login");}
    catch {
      await env.DB.prepare("DELETE FROM email_login_challenges WHERE user_id=? AND code_hash=? AND consumed_at IS NULL")
        .bind(user.id,hash).run().catch(()=>{});
      // Preserve indistinguishability between unregistered and known emails.
    }
  }
  return response({ok:true,message:GENERIC_MESSAGE},200,env,request);
}
export async function verifyEmailLogin(request:Request,env:Env):Promise<Response>{
  ensureEnabled(env);requireWebOrigin(request,env);
  const body=await jsonBody(request,1024),email=normalizeEmail(body);
  const code=typeof body.code==="string"&&/^\\d{8}$/.test(body.code)?body.code:"";
  if(!code)throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
  const now=nowMs();
  await checkRate(request,env,"otp-verify",email,now);
  const row=await env.DB.prepare(`SELECT u.id,c.code_hash,c.expires_at,c.attempts
    FROM users u JOIN email_login_challenges c ON c.user_id=u.id
    WHERE u.email=? AND u.status='active' AND u.role='user' AND u.email_verified_at IS NOT NULL`)
    .bind(email).first<{id:string;code_hash:string;expires_at:number;attempts:number}>();
  if(!row)throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
  const hash=await hmac(env,`email-login:${row.id}:${code}`);
  if(row.expires_at<=now||row.attempts>=5||row.code_hash!==hash){
    await env.DB.prepare("UPDATE email_login_challenges SET attempts=attempts+1 WHERE user_id=? AND consumed_at IS NULL AND attempts<5")
      .bind(row.id).run();
    throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
  }
  const token=randomToken(),nonce=uuid(),tokenHash=await sha256(token);
  // Challenge claim + session creation + challenge deletion stay atomic.
  // A replay or concurrent request has zero matching consumed_nonce and
  // cannot create a second session.
  const result=await env.DB.batch([
    env.DB.prepare(`UPDATE email_login_challenges SET consumed_at=?,consumed_nonce=?
      WHERE user_id=? AND code_hash=? AND consumed_at IS NULL AND expires_at>? AND attempts<5`)
      .bind(now,nonce,row.id,hash,now),
    env.DB.prepare(`INSERT INTO sessions(id,token_hash,user_id,kind,device_id,created_at,expires_at)
      SELECT ?,?,u.id,'web',NULL,?,? FROM users u
      JOIN email_login_challenges c ON c.user_id=u.id
      WHERE u.id=? AND u.status='active' AND u.role='user' AND c.consumed_at=? AND c.consumed_nonce=?`)
      .bind(uuid(),tokenHash,now,now+SESSION_SECONDS*1000,row.id,now,nonce),
    env.DB.prepare("DELETE FROM email_login_challenges WHERE user_id=? AND consumed_nonce=?")
      .bind(row.id,nonce)
  ]);
  if(result[0].meta.changes!==1||result[1].meta.changes!==1)
    throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
  return response({ok:true},200,env,request,{"Set-Cookie":sessionCookie(token,SESSION_SECONDS)});
}
