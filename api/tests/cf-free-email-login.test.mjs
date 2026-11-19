import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './helpers/payment-v2.mjs';

const create=readFileSync(new URL('../sql-proposals/0032_email_otp_login.sql',import.meta.url),'utf8');
const secret='test-only-email-login-secret';
function setup(){
 const f=fixture();
 f.sql.exec(create);
 f.env.EMAIL_OTP_LOGIN_ENABLED='1';
 f.env.MAIL_API_KEY=secret;
 f.env.MAIL_FROM='noreply@example.test';
 return f;
}
async function mailbox(run){
 const prior=globalThis.fetch;
 const sent=[];
 globalThis.fetch=async(url,opts)=>{
  if(String(url)!=='https://api.resend.com/emails')throw Error('unexpected network');
  const mail=JSON.parse(opts.body);
  sent.push(mail);
  return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{return await run(sent);}finally{globalThis.fetch=prior;}
}
function codeFrom(mail){
 const m=mail?.text.match(/验证码：(\d{8})/);
 assert.ok(m,'8-digit login code only in intercepted email');return m[1];
}
test('email OTP is OFF by default and does not change password login',async()=>{
 const f=setup();try{
  f.env.EMAIL_OTP_LOGIN_ENABLED='0';
  const r=await f.call('/v1/auth/email-login/request',{body:{email:'v2@example.test'}});
  assert.equal(r.status,404);
  const v=await f.call('/v1/auth/email-login/verify',{body:{email:'v2@example.test',code:'12345678'}});
  assert.equal(v.status,404);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM email_login_challenges').get().n,0);
 }finally{f.sql.close();}
});
test('verified user can request one-time code, verify session, replay is denied',async()=>{
 const f=setup();try{await mailbox(async mails=>{
  const r=await f.call('/v1/auth/email-login/request',{body:{email:'v2@example.test'}});
  assert.equal(r.status,200);assert.equal(mails.length,1);
  assert.ok(!JSON.stringify(r.body).includes(codeFrom(mails[0])));
  const before=f.sql.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='test-user'").get().n;
  const code=codeFrom(mails[0]);
  const login=await f.call('/v1/auth/email-login/verify',{body:{email:'v2@example.test',code}});
  assert.equal(login.status,200,JSON.stringify(login.body));
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='test-user'").get().n,before+1);
  const replay=await f.call('/v1/auth/email-login/verify',{body:{email:'v2@example.test',code}});
  assert.equal(replay.status,400);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM email_login_challenges').get().n,0);
 });}finally{f.sql.close();}
});
test('unknown, frozen and admin accounts never reveal identities or receive login email',async()=>{
 const f=setup();try{await mailbox(async mails=>{
  const missing=await f.call('/v1/auth/email-login/request',{body:{email:'missing@example.test'}});
  const known=await f.call('/v1/auth/email-login/request',{body:{email:'v2@example.test'}});
  assert.equal(missing.status,200);assert.deepEqual(missing.body,known.body);
  assert.equal(mails.length,1);
  f.sql.exec("UPDATE users SET status='frozen' WHERE id='test-user'");
  assert.equal((await f.call('/v1/auth/email-login/verify',{body:{email:'v2@example.test',code:codeFrom(mails[0])}})).status,400);
  f.sql.exec("UPDATE users SET status='active',role='admin' WHERE id='test-user'");
  assert.equal((await f.call('/v1/auth/email-login/request',{body:{email:'v2@example.test'}})).status,200);
  assert.equal(mails.length,1);
 });}finally{f.sql.close();}
});
test('wrong codes are limited, expired codes rejected, and send throttling prevents repeats',async()=>{
 const f=setup();try{await mailbox(async mails=>{
  assert.equal((await f.call('/v1/auth/email-login/request',{body:{email:'v2@example.test'}})).status,200);
  assert.equal((await f.call('/v1/auth/email-login/request',{body:{email:'v2@example.test'}})).status,200);
  assert.equal(mails.length,1);
  for(let i=0;i<5;i++)assert.equal((await f.call('/v1/auth/email-login/verify',{body:{email:'v2@example.test',code:'00000000'}})).status,400);
  const correct=codeFrom(mails[0]);
  assert.equal((await f.call('/v1/auth/email-login/verify',{body:{email:'v2@example.test',code:correct}})).status,429,'hourly verification throttle also protects exhausted code');
 });}finally{f.sql.close();}
});
test('optional password-login block is disabled by default and fails before derivation',async()=>{
 const f=setup();try{
  f.env.PASSWORD_LOGIN_ENABLED='0';
  const r=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password:'anything'}});
  assert.equal(r.status,503);assert.equal(r.body.code,'PASSWORD_LOGIN_DISABLED');
 }finally{f.sql.close();}
});
