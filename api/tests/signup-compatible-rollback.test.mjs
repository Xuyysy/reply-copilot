import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {worker as releaseWorker, fixture as originalFixture} from './helpers/payment-v2.mjs';
import {buildSignupRollback} from '../scripts/build-signup-compatible-rollback.mjs';
const rollback=createRequire(import.meta.url)(await buildSignupRollback(mkdtempSync(path.join(tmpdir(),'signup-rollback-')),{format:'cjs',platform:'node'})).default;
function fixture(){
 const f=originalFixture();
 f.call=async(route,options={})=>{
   // Capture exactly the normal authenticated fixture request without sharing
   // its bundled Worker: the recovery Worker handles the identical Request.
   const token='b'.repeat(64);
   const {createHmac}=await import('node:crypto');
   const headers={Origin:f.env.WEB_ORIGIN,Cookie:`rc_session=${token}`,'Content-Type':'application/json','CF-Connecting-IP':'8.8.8.8','X-Reply-Copilot-Action':'1','X-CSRF-Token':createHmac('sha256',f.env.AUTH_HASH_SECRET).update(`csrf:${token}`).digest('hex'),...options.headers};
   const method=options.method||'POST';
   const response=await (f.worker||rollback).fetch(new Request(f.env.API_ORIGIN+route,{method,headers,...(method==='GET'?{}:{body:JSON.stringify(options.body||{})})}),f.env);
   return {status:response.status,body:await response.json()};
 };
 return f;
}
// The shared payment fixture's generic D1 emulator does not support RETURNING
// rows in batch(); the real device exchange already relies on that API.
function withD1Returning(f) {
  f.DB.batch = async statements => {
    f.sql.exec("BEGIN");
    try {
      const results = statements.map(s => {
        if (/\bRETURNING\b/i.test(s.query)) {
          const rows = f.sql.prepare(s.query).all(...s.args);
          return { results: rows, meta: { changes: rows.length } };
        }
        const info = f.sql.prepare(s.query).run(...s.args);
        return { results: [], meta: { changes: Number(info.changes) } };
      });
      f.sql.exec("COMMIT");
      return results;
    } catch (error) {
      f.sql.exec("ROLLBACK");
      throw error;
    }
  };
  return f;
}
function newAccount(f, id, grant=200) {
  f.sql.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES(?,?,?,?,?,?)")
    .run(id, id+"@example.test",Date.now(),Date.now(),id,"test-hash");
  f.sql.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,0,0,?,?)")
    .run(id,Date.now(),Date.now());
  f.sql.prepare("INSERT INTO signup_benefit_claims(user_id,grant_amount,status,created_at) VALUES(?,?,'pending',?)")
    .run(id,grant,Date.now());
}
function asWebUser(f, id) {
  f.sql.prepare("UPDATE sessions SET user_id=? WHERE id='test-session'").run(id);
}
async function link(f, userId, deviceId) {
  asWebUser(f, userId);
  const begin = await f.call("/v1/extension/device-code", {
    body: { deviceId }, headers: {Origin:f.env.EXTENSION_ORIGIN}
  });
  assert.equal(begin.status,200,JSON.stringify(begin.body));
  const approved = await f.call("/v1/extension/approve",{body:{deviceCode:begin.body.deviceCode}});
  assert.equal(approved.status,200,JSON.stringify(approved.body));
  return f.call("/v1/extension/exchange",{
    body:{deviceToken:begin.body.deviceToken},
    headers:{Origin:f.env.EXTENSION_ORIGIN}
  });
}
function count(f, sql) {return f.sql.prepare(sql).get().n;}
function balances(f, id) {
  return f.sql.prepare("SELECT free_balance,paid_balance,free_generation_reserved,paid_generation_reserved FROM credit_accounts WHERE user_id=?").get(id);
}
function assertSignupIntegrity(f,id) {
  const account=balances(f,id);
  assert.equal(account.free_balance,count(f,`SELECT COALESCE(sum(remaining_credits),0) n FROM credit_batches WHERE user_id='${id}' AND bucket='free'`));
  assert.equal(account.paid_balance,count(f,`SELECT COALESCE(sum(remaining_credits),0) n FROM credit_batches WHERE user_id='${id}' AND bucket='paid'`));
  const grant=f.sql.prepare("SELECT amount FROM credit_grants WHERE user_id=? AND grant_type='signup'").get(id);
  const benefit=f.sql.prepare("SELECT status,grant_amount FROM signup_benefit_claims WHERE user_id=?").get(id);
  if(!benefit)return;
  const signupBatches=count(f,`SELECT count(*) n FROM credit_batches WHERE user_id='${id}' AND source_kind='signup'`);
  const signupLedgers=count(f,`SELECT count(*) n FROM credit_ledger WHERE user_id='${id}' AND kind='signup_grant'`);
  assert.equal(Boolean(grant),benefit?.status==='granted');
  assert.equal(signupBatches,grant?1:0);
  assert.equal(signupLedgers,grant?1:0);
  if(grant){
    assert.equal(grant.amount,benefit.grant_amount);
    assert.equal(f.sql.prepare("SELECT grant_credits FROM credit_batches WHERE user_id=? AND source_kind='signup'").get(id).grant_credits,grant.amount);
    assert.deepEqual({...f.sql.prepare("SELECT free_delta,paid_delta,reference_id FROM credit_ledger WHERE user_id=? AND kind='signup_grant'").get(id)},{free_delta:grant.amount,paid_delta:0,reference_id:id});
  }
}
async function approvedToken(f,userId,deviceId) {
  asWebUser(f,userId);
  const begin=await f.call("/v1/extension/device-code",{body:{deviceId},headers:{Origin:f.env.EXTENSION_ORIGIN}});
  assert.equal(begin.status,200,JSON.stringify(begin.body));
  const approved=await f.call("/v1/extension/approve",{body:{deviceCode:begin.body.deviceCode}});
  assert.equal(approved.status,200,JSON.stringify(approved.body));
  return begin.body.deviceToken;
}


test('compatible rollback redeems existing pending accounts once, preserves paid balances and device isolation',async()=>{
 const f=withD1Returning(fixture());
 try{
  newAccount(f,'pending-a');newAccount(f,'pending-b');
  const d=randomUUID();
  assert.equal((await link(f,'pending-a',d)).status,200);
  assert.equal((await link(f,'pending-b',d)).status,200);
  assert.equal((await link(f,'pending-a',d)).status,200);
  assert.equal(balances(f,'pending-a').free_balance,200);
  assert.equal(balances(f,'pending-b').free_balance,0);
  assertSignupIntegrity(f,'pending-a');assertSignupIntegrity(f,'pending-b');
  assert.equal((await link(f,'pending-b',randomUUID())).status,200);
  assertSignupIntegrity(f,'pending-b');
  f.worker=releaseWorker;
  assert.equal((await link(f,'pending-a',d)).status,200);
  assertSignupIntegrity(f,'pending-a');
  assert.equal(balances(f,'pending-a').free_balance,200);
  assert.equal(balances(f,'test-user').free_balance,200);
 }finally{f.sql.close();}
});
test("compatible rollback restores legacy registration while retaining pending redemption", async()=>{
  const f=withD1Returning(fixture());
  try {
    Object.assign(f.env,{
      ENVIRONMENT:"development",
      WEB_ORIGIN:"http://127.0.0.1:4321",
      API_ORIGIN:"http://127.0.0.1:8787",
      PASSWORD_PEPPER:"test-only-pepper-long-enough-for-password-hash",
      TURNSTILE_SECRET_KEY:"1x0000000000000000000000000000000AA"
    });
    const email="new-registered@example.test";
    let debug="";
    const oldLog=console.log;
    console.log=(...args)=>{debug+=args.map(String).join(" ");};
    let registered;
    try {
      registered=await f.call("/v1/auth/register",{
        body:{username:"new_registered",email,password:"a-strong-password-12345",turnstileToken:"local-test-token"},
        headers:{Origin:f.env.WEB_ORIGIN}
      });
    } finally {console.log=oldLog;}
    assert.equal(registered.status,200,JSON.stringify(registered.body));
    const code=debug.match(/:\s*(\d{6})/ )?.[1];
    assert.ok(code,"local-only email verification should produce a code");
    const verified=await f.call("/v1/auth/verify-registration",{
      body:{email,code},
      headers:{Origin:f.env.WEB_ORIGIN}
    });
    assert.equal(verified.status,200,JSON.stringify(verified.body));
    const user=f.sql.prepare("SELECT id FROM users WHERE email=?").get(email);
    assert.ok(user);
    assert.equal(balances(f,user.id).free_balance,200);
    assert.equal(f.sql.prepare("SELECT status FROM signup_benefit_claims WHERE user_id=?").get(user.id),undefined);
    assert.equal(count(f,"SELECT count(*) n FROM credit_grants WHERE grant_type='signup' AND user_id='"+user.id+"'"),1);
    assert.equal(count(f,"SELECT count(*) n FROM credit_ledger WHERE kind='signup_grant' AND user_id='"+user.id+"'"),1);
    assert.equal(count(f,"SELECT count(*) n FROM credit_batches WHERE source_kind='signup' AND user_id='"+user.id+"'"),1);
  } finally {f.sql.close();}
});

