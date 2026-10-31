import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers/payment-v2.mjs";

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

test("first verified extension exchange issues one atomic 200-credit signup grant", async()=>{
  const f=withD1Returning(fixture());
  try{
    newAccount(f,"new-a");
    assert.equal(balances(f,"new-a").free_balance,0);
    const linked=await link(f,"new-a",randomUUID());
    assert.equal(linked.status,200,JSON.stringify(linked.body));
    assert.equal(linked.body.status,"approved");
    assert.match(linked.body.accessToken,/^[0-9a-f]{64}$/);
    assert.equal(balances(f,"new-a").free_balance,200);
    assert.equal(count(f,"SELECT count(*) n FROM device_free_claims"),1);
    assert.equal(count(f,"SELECT count(*) n FROM credit_grants WHERE user_id='new-a' AND grant_type='signup'"),1);
    assert.equal(count(f,"SELECT count(*) n FROM credit_batches WHERE user_id='new-a' AND source_kind='signup'"),1);
    assert.equal(count(f,"SELECT count(*) n FROM credit_ledger WHERE user_id='new-a' AND kind='signup_grant'"),1);
    assert.equal(f.sql.prepare("SELECT status FROM signup_benefit_claims WHERE user_id='new-a'").get().status,"granted");
  } finally {f.sql.close();}
});

test("switching accounts on a previously claimed installation does not duplicate welcome credits or block binding", async()=>{
  const f=withD1Returning(fixture());
  try{
    newAccount(f,"new-a");
    newAccount(f,"new-b");
    const device=randomUUID();
    assert.equal((await link(f,"new-a",device)).status,200);
    assert.equal((await link(f,"new-b",device)).status,200);
    assert.equal(balances(f,"new-a").free_balance,200);
    assert.equal(balances(f,"new-b").free_balance,0);
    assert.equal(f.sql.prepare("SELECT status FROM signup_benefit_claims WHERE user_id='new-b'").get().status,"pending");
    assert.equal(count(f,"SELECT count(*) n FROM credit_ledger WHERE kind='signup_grant' AND user_id IN ('new-a','new-b')"),1);
    assert.equal(count(f,"SELECT count(*) n FROM device_free_claims"),1);
    // Binding again to the original owner or a different installation
    // cannot produce a second signup grant for that owner.
    assert.equal((await link(f,"new-a",device)).status,200);
    assert.equal((await link(f,"new-a",randomUUID())).status,200);
    assert.equal(balances(f,"new-a").free_balance,200);
    assert.equal(count(f,"SELECT count(*) n FROM credit_ledger WHERE user_id='new-a' AND kind='signup_grant'"),1);
  } finally {f.sql.close();}
});

test("new account can claim on its own eligible installation; previous free claim remains reserved", async()=>{
  const f=withD1Returning(fixture());
  try{
    newAccount(f,"new-a");
    newAccount(f,"new-b");
    const first=randomUUID();
    assert.equal((await link(f,"new-a",first)).status,200);
    assert.equal((await link(f,"new-b",first)).status,200);
    assert.equal((await link(f,"new-b",randomUUID())).status,200);
    assert.equal(balances(f,"new-b").free_balance,200);
    assert.equal(count(f,"SELECT count(*) n FROM device_free_claims"),2);
    assert.equal(count(f,"SELECT count(*) n FROM credit_ledger WHERE kind='signup_grant' AND user_id IN ('new-a','new-b')"),2);
  } finally {f.sql.close();}
});

test("legacy signup credits remain intact, and binding reserves the first observed installation", async()=>{
  const f=withD1Returning(fixture());
  try{
    // fixture() represents an existing account. This historical grant is
    // intentionally not backfilled into signup_benefit_claims.
    f.sql.prepare("INSERT INTO credit_grants(user_id,grant_type,amount,created_at) VALUES('test-user','signup',200,1)").run();
    const device=randomUUID();
    assert.equal((await link(f,"test-user",device)).status,200);
    assert.equal(balances(f,"test-user").free_balance,200);
    assert.equal(count(f,"SELECT count(*) n FROM device_free_claims"),1);
    newAccount(f,"new-b");
    assert.equal((await link(f,"new-b",device)).status,200);
    assert.equal(balances(f,"new-b").free_balance,0);
    assert.equal(balances(f,"test-user").paid_balance,0);
  } finally {f.sql.close();}
});

test("paid credit and account binding survive an already claimed installation", async()=>{
  const f=withD1Returning(fixture());
  try{
    newAccount(f,"new-a");newAccount(f,"new-b");
    const device=randomUUID();
    assert.equal((await link(f,"new-a",device)).status,200);
    f.sql.prepare("UPDATE credit_accounts SET paid_balance=50 WHERE user_id='new-b'").run();
    f.sql.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES('new-b-paid','new-b','paid','legacy_paid',50,50,1,'tracked','active')").run();
    const result=await link(f,"new-b",device);
    assert.equal(result.status,200);
    assert.equal(balances(f,"new-b").paid_balance,50);
    assert.equal(balances(f,"new-b").free_balance,0);
  } finally {f.sql.close();}
});

test("a database failure during issuance rolls back extension exchange and every signup ledger write", async()=>{
  const f=withD1Returning(fixture());
  try{
    newAccount(f,"new-a");
    const device=randomUUID();
    asWebUser(f,"new-a");
    const begin=await f.call("/v1/extension/device-code",{body:{deviceId:device},headers:{Origin:f.env.EXTENSION_ORIGIN}});
    assert.equal(begin.status,200);
    assert.equal((await f.call("/v1/extension/approve",{body:{deviceCode:begin.body.deviceCode}})).status,200);
    // Fail inside the transaction after the claim is tentatively written.
    f.sql.exec("CREATE TRIGGER prevent_signup_ledger BEFORE INSERT ON credit_ledger WHEN NEW.kind='signup_grant' BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
    const fail=await f.call("/v1/extension/exchange",{body:{deviceToken:begin.body.deviceToken},headers:{Origin:f.env.EXTENSION_ORIGIN}});
    assert.notEqual(fail.status,200);
    assert.equal(balances(f,"new-a").free_balance,0);
    assert.equal(count(f,"SELECT count(*) n FROM device_free_claims"),0);
    assert.equal(count(f,"SELECT count(*) n FROM credit_ledger WHERE user_id='new-a'"),0);
    assert.equal(f.sql.prepare("SELECT status FROM signup_benefit_claims WHERE user_id='new-a'").get().status,"pending");
    assert.equal(f.sql.prepare("SELECT status FROM extension_authorizations WHERE code_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1").get().status,"approved");
    f.sql.exec("DROP TRIGGER prevent_signup_ledger");
    const retried=await f.call("/v1/extension/exchange",{body:{deviceToken:begin.body.deviceToken},headers:{Origin:f.env.EXTENSION_ORIGIN}});
    assert.equal(retried.status,200,JSON.stringify(retried.body));
    assert.equal(balances(f,"new-a").free_balance,200);
  } finally {f.sql.close();}
});

test("email verification creates a pending welcome entitlement without any spendable signup grant", async()=>{
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
    assert.equal(balances(f,user.id).free_balance,0);
    assert.equal(f.sql.prepare("SELECT status,grant_amount FROM signup_benefit_claims WHERE user_id=?").get(user.id).status,"pending");
    assert.equal(count(f,"SELECT count(*) n FROM credit_grants WHERE grant_type='signup' AND user_id='"+user.id+"'"),0);
    assert.equal(count(f,"SELECT count(*) n FROM credit_ledger WHERE kind='signup_grant' AND user_id='"+user.id+"'"),0);
    assert.equal(count(f,"SELECT count(*) n FROM credit_batches WHERE source_kind='signup' AND user_id='"+user.id+"'"),0);
  } finally {f.sql.close();}
});
