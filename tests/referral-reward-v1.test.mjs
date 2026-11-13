import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {normalizeReferralCode,referralAwardPlan,REFERRAL_BONUS,REFERRAL_MONTHLY_LIMIT} from "../api/src/referral-award-plan.mjs";

const migration=readFileSync(new URL("../api/sql-proposals/0027_referral_rewards_v1.sql",import.meta.url),"utf8");
const now=1_790_000_000_000;
function setup({delivered=true,deviceSame=false,testInvitee=false,testInviter=false,adminInviter=false,signupGranted=true}={}){
 const db=new DatabaseSync(":memory:");
 db.exec("PRAGMA foreign_keys=ON");
 db.exec([
  "CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,role TEXT,status TEXT,is_test_account INTEGER,email_verified_at INTEGER)",
  "CREATE TABLE pending_registrations(email TEXT PRIMARY KEY)",
  "CREATE TABLE site_administrator(id INTEGER PRIMARY KEY,user_id TEXT)",
  "CREATE TABLE signup_benefit_claims(user_id TEXT PRIMARY KEY,status TEXT,device_digest TEXT)",
  "CREATE TABLE device_free_claims(device_digest TEXT PRIMARY KEY,user_id TEXT)",
  "CREATE TABLE ai_requests(user_id TEXT,status TEXT,delivery_confirmation_id TEXT,delivery_confirmed_at INTEGER)",
  "CREATE TABLE credit_accounts(user_id TEXT PRIMARY KEY,free_balance INTEGER DEFAULT 0,paid_balance INTEGER DEFAULT 0,version INTEGER DEFAULT 0,updated_at INTEGER DEFAULT 0)",
  "CREATE TABLE credit_batches(id TEXT PRIMARY KEY,user_id TEXT,bucket TEXT,source_kind TEXT,grant_credits INTEGER,remaining_credits INTEGER,granted_at INTEGER,history_confidence TEXT,status TEXT)",
  "CREATE TABLE credit_ledger(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,free_delta INTEGER,paid_delta INTEGER,reference_id TEXT UNIQUE,reason TEXT,created_at INTEGER)",
  "CREATE TABLE credit_operation_assertions(operation_id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1))",
  "CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER)"
 ].join(";\n")+";");
 db.exec(migration);
 db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run("inviter","inviter@example.test","user","active",testInviter?1:0,1000);
 db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run("invitee","invitee@example.test","user","active",testInvitee?1:0,1000);
 db.prepare("INSERT INTO credit_accounts(user_id,free_balance) VALUES('inviter',0),('invitee',200)").run();
 db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES('welcome:invitee','invitee','free','signup',200,200,0,'tracked','active')").run();
 db.prepare("INSERT INTO signup_benefit_claims VALUES(?,?,?)").run("invitee",signupGranted?"granted":"pending",deviceSame?"shared":"invitee-device");
 db.prepare("INSERT INTO device_free_claims VALUES('inviter-device','inviter')").run();
 if(deviceSame)db.prepare("INSERT INTO device_free_claims VALUES('shared','inviter')").run();
 if(adminInviter)db.prepare("INSERT INTO site_administrator VALUES(1,'inviter')").run();
 if(delivered)db.prepare("INSERT INTO ai_requests VALUES('invitee','succeeded','confirmed-ack',?)").run(now);
 else db.prepare("INSERT INTO ai_requests VALUES('invitee','reserved',NULL,NULL)").run();
 db.prepare("INSERT INTO referral_codes VALUES('inviter','0123456789abcdef',?)").run(now);
 db.prepare("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,status,registered_at) VALUES('invitee','inviter','0123456789abcdef','pending',?)").run(now);
 return db;
}
function run(db,nonce){
 const plan=referralAwardPlan({inviteeId:"invitee",nonce,now});
 db.exec("BEGIN");
 try{const rows=plan.map(entry=>db.prepare(entry.sql).run(...entry.params));db.exec("COMMIT");return rows;}
 catch(e){db.exec("ROLLBACK");throw e;}
}
function get(db,sql){return db.prepare(sql).get();}
function verifyNoGrant(db){
 assert.equal(get(db,"SELECT status FROM referral_invites WHERE invited_user_id='invitee'").status,"pending");
 assert.equal(get(db,"SELECT COUNT(*) n FROM referral_awards").n,0);
 assert.equal(get(db,"SELECT COUNT(*) n FROM credit_ledger").n,0);
 assert.equal(get(db,"SELECT COUNT(*) n FROM credit_batches WHERE id LIKE 'referral:%'").n,0);
 assert.equal(get(db,"SELECT free_balance FROM credit_accounts WHERE user_id='inviter'").free_balance,0);
 assert.equal(get(db,"SELECT free_balance FROM credit_accounts WHERE user_id='invitee'").free_balance,200);
}

test("referral SQL remains a manual proposal and 0026 is owned by Admin V2",()=>{
 assert.equal(existsSync(new URL("../api/migrations/0027_referral_rewards_v1.sql",import.meta.url)),false);
 assert.equal(existsSync(new URL("../api/sql-proposals/0026_admin_v2_read_indexes.sql",import.meta.url)),true);
});
test("V1 migration is schema-only, gated OFF, historical credit types unchanged",()=>{
 const db=setup();
 assert.equal(get(db,"SELECT value FROM system_settings WHERE key='referrals_enabled'").value,"0");
 assert.equal(get(db,"SELECT COUNT(*) n FROM referral_awards").n,0);
 assert.equal(get(db,"SELECT COUNT(*) n FROM credit_batches").n,1);
 assert.equal(db.prepare("SELECT referral_code FROM pending_registrations WHERE 1=0").all().length,0);
 db.close();
});
test("only 16-hex codes accepted, no user-supplied URLs can become redirect destinations",()=>{
 assert.equal(normalizeReferralCode("A0bcdef012345678"),"a0bcdef012345678");
 for(const value of ["",null,"http://evil.test","../../login","ABC","a".repeat(2048),{},undefined]) assert.equal(normalizeReferralCode(value),null);
 assert.equal(REFERRAL_BONUS,50);assert.equal(REFERRAL_MONTHLY_LIMIT,20);
});
test("delivered ACK + granted signup claim awards exact 50+50, preserves paid balance, retry is idempotent",()=>{
 const db=setup();
 const first=run(db,"nonce1");assert.equal(first[0].changes,1);
 assert.equal(get(db,"SELECT status FROM referral_invites WHERE invited_user_id='invitee'").status,"rewarded");
 assert.equal(get(db,"SELECT COUNT(*) n FROM referral_awards WHERE amount=50").n,2);
 assert.equal(get(db,"SELECT COUNT(*) n FROM credit_ledger WHERE kind='admin_adjustment' AND reason LIKE 'referral_reward:%'").n,2);
 assert.equal(get(db,"SELECT free_balance FROM credit_accounts WHERE user_id='inviter'").free_balance,50);
 assert.equal(get(db,"SELECT free_balance FROM credit_accounts WHERE user_id='invitee'").free_balance,250);
 assert.equal(get(db,"SELECT SUM(paid_balance) n FROM credit_accounts").n,0);
 const retry=run(db,"nonce2");assert.equal(retry[0].changes,0);
 assert.equal(get(db,"SELECT COUNT(*) n FROM referral_awards").n,2);
 assert.equal(get(db,"SELECT SUM(free_balance) n FROM credit_accounts").n,300);
 db.close();
});
test("registration alone, pending delivery, unclaimed installation cannot grant credits",()=>{
 for(const variant of [{delivered:false},{signupGranted:false}]){
  const db=setup(variant);
  assert.equal(run(db,"nonce3")[0].changes,0);
  verifyNoGrant(db);db.close();
 }
});
test("same extension and test accounts cannot receive referral awards",()=>{
 for(const variant of [{deviceSame:true},{testInvitee:true},{testInviter:true}]){
  const db=setup(variant);
  assert.equal(run(db,"nonce4")[0].changes,0);
  verifyNoGrant(db);db.close();
 }
});
test("eligible administrator can invite regular user and still earns exactly 50+50",()=>{
 const db=setup({adminInviter:true});
 db.prepare("UPDATE users SET role='admin' WHERE id='inviter'").run();
 assert.equal(run(db,"admin-inviter")[0].changes,1);
 assert.equal(get(db,"SELECT free_balance FROM credit_accounts WHERE user_id='inviter'").free_balance,50);
 assert.equal(get(db,"SELECT free_balance FROM credit_accounts WHERE user_id='invitee'").free_balance,250);
 assert.equal(run(db,"admin-replay")[0].changes,0);
 db.close();
});
test("administrator cannot be rewarded as invitee",()=>{
 const db=setup();
 db.prepare("UPDATE users SET role='admin' WHERE id='invitee'").run();
 db.prepare("INSERT INTO site_administrator VALUES(2,'invitee')").run();
 assert.equal(run(db,"admin-invitee")[0].changes,0);
 verifyNoGrant(db);
 db.close();
});
test("rolling 30-day cap allows #20, blocks #21 and later unblocks, without rewriting grants",()=>{
 const first=setup();
 for(let i=0;i<19;i++){
  const user="eligible-"+i;
  first.prepare("INSERT INTO users VALUES(?,?,'user','active',0,1000)").run(user,user+"@example.test");
  first.prepare("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,status,reward_claim,registered_at,rewarded_at) VALUES(?,'inviter','0123456789abcdef','rewarded',?,?,?)").run(user,"eligible-claim"+i,now-100,now-100);
 }
 assert.equal(run(first,"nonce-20th")[0].changes,1);
 assert.equal(get(first,"SELECT COUNT(*) n FROM referral_awards WHERE invited_user_id='invitee'").n,2);
 first.close();
 const db=setup();
 for(let i=0;i<20;i++){
  const user="other-"+i;
  db.prepare("INSERT INTO users VALUES(?,?,'user','active',0,1000)").run(user,user+"@example.test");
  db.prepare("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,status,reward_claim,registered_at,rewarded_at) VALUES(?,'inviter','0123456789abcdef','rewarded',?,?,?)").run(user,"old-claim"+i,now-100,now-100);
 }
 assert.equal(run(db,"nonce-cap")[0].changes,0);verifyNoGrant(db);
 db.prepare("UPDATE referral_invites SET rewarded_at=? WHERE invited_user_id='other-0'").run(now-31*86400_000);
 assert.equal(run(db,"nonce-after-window")[0].changes,1);
 assert.equal(get(db,"SELECT COUNT(*) n FROM referral_awards WHERE invited_user_id='invitee'").n,2);
 db.close();
});
test("injected mid-award failure rolls back claimed invite, BOTH wallets, batches and ledgers",()=>{
 const db=setup();
 db.exec("CREATE TRIGGER reject_invitee BEFORE INSERT ON referral_awards WHEN NEW.side='invitee' BEGIN SELECT RAISE(ABORT,'simulated'); END;");
 assert.throws(()=>run(db,"nonce-failure"),/simulated/);
 verifyNoGrant(db);
 assert.equal(get(db,"SELECT COUNT(*) n FROM credit_operation_assertions").n,0);
 db.exec("DROP TRIGGER reject_invitee;");
 assert.equal(run(db,"nonce-fixed")[0].changes,1);
 db.close();
});
test("source integrates attribution at registration and payout after successful delivery ACK, never before",()=>{
 const password=readFileSync(new URL("../api/src/password-auth.ts",import.meta.url),"utf8");
 const quota=readFileSync(new URL("../api/src/quota.ts",import.meta.url),"utf8");
 const routes=readFileSync(new URL("../api/src/index.ts",import.meta.url),"utf8");
 const api=readFileSync(new URL("../api/src/referrals.ts",import.meta.url),"utf8");
 assert.match(password,/referralRegistrationStatement\(env,userId,row\.referral_code,now\)/);
 assert.match(password,/COALESCE\(pending_registrations\.referral_code,excluded\.referral_code\)/);
 assert.match(quota,/bestEffortReferralAward\(env,userId\)/);
 assert.match(routes,/v1\/referrals\/me/);
 assert.match(routes,/v1\/admin\/referrals/);
 assert.match(api,/requireAdminSession\(request,env\)/);
 assert.match(api,/await requireCsrf\(request,env,token\)/);
 assert.match(api,/REFERRAL_REWARD_PENDING_RETRY/);
 assert.doesNotMatch(api,/UPDATE subscription_periods|UPDATE payment_transactions|UPDATE recharge_orders/);
});
