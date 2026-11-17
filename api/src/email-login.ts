// Cost-first alternative login: avoids PBKDF2 per ordinary user login.
// Safe-off: Worker EMAIL_LOGIN_ENABLED must be exactly 1. No migration, no
// credit grant, no password rewrite, no changes to existing login endpoints.
import type {Env} from "./types";
import {ApiFailure} from "./types";
import {sendCode,takeRate} from "./auth";
// Keep rollback compatibility: the legacy signup recovery bundle can swap the
// password-auth module, so these helpers must not import new symbols from it.
async function limitOtpRequest(request:Request,env:Env,purpose:string,email:string,now:number):Promise<void>{
  const ip=await hmac(env,"ip:"+(request.headers.get("CF-Connecting-IP")||"local"));
  const address=await hmac(env,"email:"+email);
  if(!await takeRate(env,purpose+"-ip:"+ip,12,3600_000,now)||
     !await takeRate(env,purpose+"-email:"+address,5,3600_000,now))
    throw new ApiFailure(429,"RATE_LIMITED","请求过于频繁，请稍后再试。",60);
}
async function verifyLoginTurnstile(request:Request,env:Env,token:unknown):Promise<void>{
  if(typeof token!=="string"||token.length<1||token.length>2048)
    throw new ApiFailure(400,"TURNSTILE_REQUIRED","请先完成人机验证。");
  const secret=env.TURNSTILE_SECRET_KEY;
  if(!secret)throw new ApiFailure(503,"TURNSTILE_NOT_CONFIGURED","人机验证尚未配置。");
  if(env.ENVIRONMENT==="development"&&/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.WEB_ORIGIN)
      &&secret==="1x0000000000000000000000000000000AA"&&token==="local-test-token")return;
  if(env.ENVIRONMENT!=="development"&&/^\dx0{20,}/.test(secret))
    throw new ApiFailure(503,"TURNSTILE_NOT_CONFIGURED","预发布和生产环境不能使用测试密钥。");
  const form=new URLSearchParams({secret,response:token,idempotency_key:uuid()});
  const ip=request.headers.get("CF-Connecting-IP");if(ip)form.set("remoteip",ip);
  let result:{success?:boolean;hostname?:string;action?:string};
  try{
    const verified=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
      method:"POST",body:form,signal:AbortSignal.timeout(10000)
    });
    result=await verified.json();
  }catch{throw new ApiFailure(503,"TURNSTILE_UNAVAILABLE","人机验证暂时不可用，请稍后重试。");}
  if(!result.success||(env.ENVIRONMENT!=="development"&&
     (result.hostname!==new URL(env.WEB_ORIGIN).hostname||result.action!=="login")))
    throw new ApiFailure(400,"TURNSTILE_INVALID","人机验证失败，请重新尝试。");
}

import {hmac,jsonBody,nowMs,randomToken,requireWebOrigin,sessionCookie,sha256,uuid} from "./security";
import {response} from "./http";
import {ELIGIBLE,REQUEST,CONSUME,CREATE_SESSION,BAD_ATTEMPT} from "./email-login-sql.mjs";
const EXPIRES_MS=600_000,SESSION_MS=30*86400_000;
const generic={ok:true,message:"如果邮箱对应已验证的正常账户，登录验证码已发送。"};
const emailFrom=(value:unknown):string=>{
 const s=typeof value==="string"?value.trim().toLowerCase():"";
 if(s.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw new ApiFailure(400,"INVALID_EMAIL","邮箱格式无效。");
 return s;
};
const codeFrom=(value:unknown):string=>{
 if(typeof value!=="string"||!/^\d{6}$/.test(value))throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
 return value;
};
function gate(env:Env){if(env.EMAIL_LOGIN_ENABLED!=="1")throw new ApiFailure(404,"NOT_FOUND","此登录方式暂不可用。");}
async function failSilently(env:Env,email:string,hash:string){
 await env.DB.prepare("DELETE FROM email_verifications WHERE email=? AND code_hash=? AND used_at IS NULL").bind(email,hash).run().catch(()=>{});
}
export async function requestEmailLoginCode(request:Request,env:Env):Promise<Response>{
 gate(env);requireWebOrigin(request,env);
 const body=await jsonBody(request,4096),email=emailFrom(body.email),now=nowMs();
 // Must validate Turnstile for every request, including unknown emails, before
 // using the limited free email provider. Challenge action is NOT 'register'.
 await verifyLoginTurnstile(request,env,body.turnstileToken);
 await limitOtpRequest(request,env,"email-login-send",email,now);
 const eligible=await env.DB.prepare(ELIGIBLE).bind(email).first();
 if(!eligible)return response(generic,200,env,request);
 const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1_000_000).padStart(6,"0");
 const codeHash=await hmac(env,"email-login:"+email+":"+code);
 const row=await env.DB.prepare(REQUEST).bind(email,codeHash,now+EXPIRES_MS,now,now-60_000).run();
 if(!row.meta.changes)return response(generic,200,env,request);
 // 40 OTP emails/day leaves buffer within Resend's 100/day Free limit for
 // registration and password reset. This does not guarantee total mail <100.
 if(!await takeRate(env,"email-login:global-send",40,86400_000,now)){
   await failSilently(env,email,codeHash);return response(generic,200,env,request);
 }
 try{await sendCode(env,email,code,"login");}catch{await failSilently(env,email,codeHash);}
 // Unknown accounts and mail provider outages return the same public answer.
 return response(generic,200,env,request);
}
export async function verifyEmailLoginCode(request:Request,env:Env):Promise<Response>{
 gate(env);requireWebOrigin(request,env);
 const body=await jsonBody(request,1024),email=emailFrom(body.email),code=codeFrom(body.code),now=nowMs();
 await limitOtpRequest(request,env,"email-login-verify",email,now);
 const codeHash=await hmac(env,"email-login:"+email+":"+code),nonce=uuid();
 const token=randomToken(),tokenHash=await sha256(token);
 // Transactionally bind the successful single-use consume to the new session.
 // No user/credit/trial insertion is possible in this path.
 const steps=await env.DB.batch([
   env.DB.prepare(CONSUME).bind(now,nonce,email,codeHash,now),
   env.DB.prepare(CREATE_SESSION).bind(uuid(),tokenHash,now,now+SESSION_MS,email,nonce,codeHash)
 ]);
 if(!steps[0]?.results?.length||steps[1]?.meta?.changes!==1){
   await env.DB.prepare(BAD_ATTEMPT).bind(email,now).run().catch(()=>{});
   throw new ApiFailure(400,"INVALID_CODE","验证码无效或已过期。");
 }
 return response({ok:true},200,env,request,{"Set-Cookie":sessionCookie(token,SESSION_MS/1000)});
}
