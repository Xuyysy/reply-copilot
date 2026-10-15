import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const wrangler=path.join(root,"node_modules",".bin","wrangler");
const persist=mkdtempSync(path.join(os.tmpdir(),"reply-copilot-credit-e2e-"));
const base="http://127.0.0.1:8792",origin="http://127.0.0.1:4321";
const env={...process.env,WRANGLER_SEND_METRICS:"false",WRANGLER_LOG_PATH:path.join(persist,"wrangler.log")};
const sql=(statement)=>execFileSync(wrangler,["d1","execute","DB","--local","--persist-to",persist,"--command",statement],{cwd:root,env,stdio:"pipe"});
let server,logs="";
async function call(url,{method="GET",body,cookie,bearer,csrf,extension=false,admin}={}){
  const result=await fetch(`${base}${url}`,{method,headers:{...(body?{"Content-Type":"application/json"}:{}),...(method==="POST"&&!extension?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:`Bearer ${bearer}`}:{ }),...(csrf?{"X-CSRF-Token":csrf,"X-Reply-Copilot-Action":"1"}:{}),...(admin?{"X-Admin-Access":admin}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:result.status,headers:result.headers,data:await result.json()};
}
async function waitFor(predicate,maxMs=20000){const until=Date.now()+maxMs;while(Date.now()<until){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Timed out. ${logs.slice(-1000)}`);}
async function register(email,username){
  const body={email,username,password:"strong-test-password-123",turnstileToken:"local-test-token"};
  assert.equal((await call("/v1/auth/register",{method:"POST",body})).status,200);
  const code=await waitFor(()=>logs.match(new RegExp(`\\[LOCAL EMAIL ONLY\\] ${email}: (\\d{6})`))?.[1]);
  assert.equal((await call("/v1/auth/verify-registration",{method:"POST",body:{email,code:"000000"}})).status,400);
  const verified=await call("/v1/auth/verify-registration",{method:"POST",body:{email,code}});
  assert.equal(verified.status,200,JSON.stringify(verified.data));
  assert.equal((await call("/v1/auth/verify-registration",{method:"POST",body:{email,code}})).status,400);
  return verified.headers.get("set-cookie")?.split(";")[0];
}
try{
  execFileSync(wrangler,["d1","migrations","apply","DB","--local","--persist-to",persist],{cwd:root,env,stdio:"pipe"});
  server=spawn(wrangler,["dev","--local","--ip","127.0.0.1","--port","8792","--persist-to",persist,
    "--var","ENVIRONMENT:development","--var","AI_MOCK:1","--var","PASSWORD_PEPPER:local-test-pepper-that-is-long-enough-123","--var","AUTH_HASH_SECRET:local-test-hash-secret-that-is-long-enough-123","--var","TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA","--var","ADMIN_ACCESS_SECRET:local-test-admin-secret-that-is-long-enough-123"],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
  server.stdout.on("data",data=>{logs+=data.toString();});server.stderr.on("data",data=>{logs+=data.toString();});
  await waitFor(async()=>{try{return (await call("/health")).status===200;}catch{return false;}});
  const email=`credits-${crypto.randomUUID()}@example.test`,username=`tester_${crypto.randomUUID().slice(0,8)}`;
  assert.equal((await call("/v1/auth/register",{method:"POST",body:{email,username,password:"strong-test-password-123",turnstileToken:""}})).status,400);
  const cookie=await register(email,username);
  const duplicate=await call("/v1/auth/register",{method:"POST",body:{email,username,password:"strong-test-password-123",turnstileToken:"local-test-token"}});
  assert.equal(duplicate.status,200);
  const user=(await call("/v1/me",{cookie})).data.user;assert.equal(user.username,username);assert.equal(user.emailVerified,true);
  const quota=()=>call("/v1/usage",{cookie});assert.deepEqual((await quota()).data.quota,{freeRemaining:200,paidRemaining:0,totalRemaining:200});
  assert.equal((await call("/v1/auth/login",{method:"POST",body:{identity:username,password:"wrong"}})).status,401);
  const login=await call("/v1/auth/login",{method:"POST",body:{identity:username,password:"strong-test-password-123"}});assert.equal(login.status,200);
  const csrf=(await call("/v1/auth/csrf",{cookie})).data.csrfToken;
  const device=await call("/v1/extension/device-code",{method:"POST",extension:true,body:{deviceId:crypto.randomUUID()}});assert.equal(device.status,200);
  assert.equal((await call("/v1/extension/approve",{method:"POST",cookie,csrf,body:{deviceCode:device.data.deviceCode}})).status,200);
  const bearer=(await call("/v1/extension/exchange",{method:"POST",extension:true,body:{deviceToken:device.data.deviceToken}})).data.accessToken;
  const generate=(requestId,text="Small steps add up.")=>call("/v1/ai/generate",{method:"POST",extension:true,bearer,body:{requestId,post:{text,url:"https://x.com/example/status/123"},replyStyle:"natural-friendly"}});
  const id=crypto.randomUUID();assert.equal((await generate(id)).status,200);assert.equal((await generate(id)).status,200);assert.equal((await quota()).data.quota.totalRemaining,199);
  assert.equal((await generate(id,"Different text")).status,409);
  const failure=await generate(crypto.randomUUID(),"REPLY_COPILOT_FORCE_FAIL");assert.equal(failure.status,503);assert.equal((await quota()).data.quota.totalRemaining,199);
  const order=await call("/v1/orders",{method:"POST",cookie,csrf,body:{packageId:"starter"}});assert.equal(order.status,201);assert.equal(order.data.paymentAvailable,false);assert.equal((await quota()).data.quota.paidRemaining,0);
  assert.equal((await call("/v1/admin/dashboard",{cookie,admin:"local-test-admin-secret-that-is-long-enough-123"})).status,403);
  sql(`UPDATE users SET role='admin' WHERE id='${user.userId}'`);
  const admin="local-test-admin-secret-that-is-long-enough-123";
  const dashboard=await call("/v1/admin/dashboard",{cookie,admin});assert.equal(dashboard.status,200);assert.ok(dashboard.data.users>=1);
  const frozenEmail=`frozen-${crypto.randomUUID()}@example.test`,frozenCookie=await register(frozenEmail,`frozen_${crypto.randomUUID().slice(0,8)}`);
  const frozenUser=(await call("/v1/me",{cookie:frozenCookie})).data.user;
  const frozenSet=await call(`/v1/admin/users/${frozenUser.userId}/status`,{method:"POST",cookie,csrf,admin,body:{status:"frozen"}});assert.equal(frozenSet.status,200);
  const frozenDevice=await call("/v1/extension/device-code",{method:"POST",extension:true,body:{deviceId:crypto.randomUUID()}});
  const frozenCsrf=(await call("/v1/auth/csrf",{cookie:frozenCookie})).data.csrfToken;
  assert.equal((await call("/v1/extension/approve",{method:"POST",cookie:frozenCookie,csrf:frozenCsrf,body:{deviceCode:frozenDevice.data.deviceCode}})).status,200);
  const frozenBearer=(await call("/v1/extension/exchange",{method:"POST",extension:true,body:{deviceToken:frozenDevice.data.deviceToken}})).data.accessToken;
  const frozenGeneration=await call("/v1/ai/generate",{method:"POST",extension:true,bearer:frozenBearer,body:{requestId:crypto.randomUUID(),post:{text:"hello",url:"https://x.com/example/status/123"}}});assert.equal(frozenGeneration.status,403);
  const adjustment=await call(`/v1/admin/users/${user.userId}/credits`,{method:"POST",cookie,csrf,admin,body:{kind:"free",delta:5,reason:"本地测试人工补发",confirm:true}});assert.equal(adjustment.status,200,JSON.stringify(adjustment.data));assert.equal((await quota()).data.quota.freeRemaining,204);
  const mismatch=await call(`/v1/dev/orders/${order.data.order.id}/settle`,{method:"POST",cookie,csrf,admin,body:{eventId:"event-local-123456",amountCents:200,currency:"USD"}});assert.equal(mismatch.status,409);assert.equal((await quota()).data.quota.paidRemaining,0);
  const paid=await call(`/v1/dev/orders/${order.data.order.id}/settle`,{method:"POST",cookie,csrf,admin,body:{eventId:"event-local-123456",amountCents:199,currency:"USD"}});assert.equal(paid.status,200,JSON.stringify(paid.data));assert.equal((await quota()).data.quota.paidRemaining,400);
  const replayPaid=await call(`/v1/dev/orders/${order.data.order.id}/settle`,{method:"POST",cookie,csrf,admin,body:{eventId:"event-local-123456",amountCents:199,currency:"USD"}});assert.equal(replayPaid.status,200);assert.equal((await quota()).data.quota.paidRemaining,400);
  const beforeConcurrent=(await quota()).data.quota.totalRemaining;
  const concurrent=await Promise.all(Array.from({length:8},()=>generate(crypto.randomUUID())));
  const successful=concurrent.filter(item=>item.status===200).length;
  assert.equal((await quota()).data.quota.totalRemaining,beforeConcurrent-successful);
  assert.equal((await quota()).data.quota.paidRemaining,400);
  assert.ok(concurrent.every(item=>[200,429].includes(item.status)),JSON.stringify(concurrent.map(item=>item.data)));
  sql(`UPDATE credit_accounts SET free_balance=0,paid_balance=0 WHERE user_id='${user.userId}'`);
  const empty=await generate(crypto.randomUUID());assert.equal(empty.status,402);assert.equal(empty.data.code,"INSUFFICIENT_CREDITS");
  const secondEmail=`reset-${crypto.randomUUID()}@example.test`;
  const reset=await call("/v1/auth/request-password-reset",{method:"POST",body:{email:secondEmail}});assert.equal(reset.status,200);
  const firstReset=await call("/v1/auth/request-password-reset",{method:"POST",body:{email}});assert.equal(firstReset.status,200);
  const resetCode=await waitFor(()=>[...logs.matchAll(new RegExp(`\\[LOCAL EMAIL ONLY\\] ${email}: (\\d{6})`,"g"))].at(-1)?.[1]);
  const changed=await call("/v1/auth/reset-password",{method:"POST",body:{email,code:resetCode,password:"another-test-password-456"}});
  assert.equal(changed.status,200,JSON.stringify(changed.data));
  assert.equal((await call("/v1/auth/login",{method:"POST",body:{identity:email,password:"another-test-password-456"}})).status,200);
  console.log(JSON.stringify({ok:true,freeGrant:200,creditAfterFirst:199,refundConfirmed:true,idempotent:true,parallelSuccessful:successful,unpaidOrderNoCredit:true,mockPaymentCredits:400,duplicatePaymentNoDoubleGrant:true,adminAdjustmentAudited:true,adminDenied:true,frozenBlocked:true,resetWorks:true}));
}finally{server?.kill("SIGTERM");rmSync(persist,{recursive:true,force:true});}
