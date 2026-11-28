import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parsePartnerPolicy,partnerPolicyAppendPlan,partnerPolicyAtPlan } from '../src/partner-policy.mjs';

const proposal=readFileSync(new URL('../sql-proposals/partners_v1a_policy_proposal.sql',import.meta.url),'utf8');
const policy={status:'active',level:'standard',rateBps:2000,termMonths:12,reason:'test only',expectedVersion:0};
function fixture(t){
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT,email_verified_at INTEGER,archived_at INTEGER,is_test_account INTEGER);
    CREATE TABLE site_administrator(id INTEGER PRIMARY KEY,user_id TEXT REFERENCES users(id));
    CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER);
    INSERT INTO users VALUES ('owner','admin','active',1,NULL,0),('p','user','active',1,NULL,0),
      ('other','user','active',1,NULL,0),('test','user','active',1,NULL,1),
      ('frozen','user','frozen',1,NULL,0),('unverified','user','active',NULL,NULL,0),
      ('archived','user','active',1,1,0),('fake-admin','admin','active',1,NULL,0);
    INSERT INTO site_administrator VALUES(1,'owner');`);
  db.exec(proposal);
  return db;
}
function enable(db){db.exec("UPDATE system_settings SET value='1' WHERE key='partner_program_enabled'");}
function append(db,overrides={}){
  const plan=partnerPolicyAppendPlan({userId:'p',actorId:'owner',now:100,policy,...overrides});
  return Number(db.prepare(plan.sql).run(...plan.params).changes);
}
function at(db,id,time){const plan=partnerPolicyAtPlan(id,time);return db.prepare(plan.sql).get(...plan.params);}
test('policy input explicit, strict and without implicit monetary defaults',()=>{
  assert.equal(parsePartnerPolicy(policy).rateBps,2000);
  for(const x of [{...policy,rateBps:'2000'},{...policy,rateBps:0},{...policy,rateBps:10001},
    {...policy,rateBps:1.5},{...policy,termMonths:0},{...policy,termMonths:undefined},
    {...policy,expectedVersion:-1},{...policy,reason:' '},{...policy,level:'admin'},
    {...policy,status:'paused'},{...policy,actorId:'owner'}]) assert.throws(()=>parsePartnerPolicy(x),/INVALID/);
  const {termMonths,...missing}=policy;
  assert.throws(()=>parsePartnerPolicy(missing),/INVALID/);
  assert.equal(parsePartnerPolicy({...policy,termMonths:null}).termMonths,null);
});
test('flag off, singleton admin and eligible ordinary target required',t=>{
  const db=fixture(t);
  assert.equal(append(db),0);
  enable(db);
  for(const userId of ['test','frozen','unverified','archived','fake-admin','missing']) assert.equal(append(db,{userId}),0);
  for(const actorId of ['other','fake-admin','missing']) assert.equal(append(db,{actorId}),0);
  assert.throws(()=>append(db,{userId:'owner'}),/INVALID/);
  assert.equal(append(db),1);
  assert.equal(append(db),0);
  assert.equal(at(db,'other',100),undefined);
});
test('prospective history, stale writes, pause even after target frozen, immutable records',t=>{
  const db=fixture(t); enable(db);
  assert.equal(append(db),1);
  assert.equal(at(db,'p',99),undefined);
  const v2={...policy,rateBps:2500,expectedVersion:1};
  assert.equal(append(db,{now:200,policy:v2}),1);
  assert.equal(append(db,{now:201,policy:v2}),0);
  assert.equal(append(db,{now:199,policy:{...v2,expectedVersion:2}}),0);
  assert.equal(at(db,'p',199).rate_bps,2000);
  assert.equal(at(db,'p',200).rate_bps,2500);
  db.exec("UPDATE users SET status='frozen' WHERE id='p'");
  assert.equal(append(db,{now:300,policy:{...v2,expectedVersion:2}}),0);
  assert.equal(append(db,{now:300,policy:{...v2,status:'paused',expectedVersion:2}}),1);
  assert.equal(at(db,'p',300).status,'paused');
  assert.throws(()=>db.exec("UPDATE partner_policy_versions SET rate_bps=1"),/immutable/);
  assert.throws(()=>db.exec("DELETE FROM partner_policy_versions"),/immutable/);
});

test('program switch can stop further writes without erasing history',t=>{
 const db=fixture(t);enable(db);assert.equal(append(db),1);
 db.exec("UPDATE system_settings SET value='0' WHERE key='partner_program_enabled'");
 assert.equal(append(db,{now:200,policy:{...policy,expectedVersion:1}}),0);
 assert.equal(at(db,'p',200).version,1);
});
test('new routes preserve original admin guard and require scoped web session',()=>{
 const source=readFileSync(new URL('../src/partners.ts',import.meta.url),'utf8');
 const router=readFileSync(new URL('../src/index.ts',import.meta.url),'utf8');
 assert.match(source,/requireAdminSession\(request,env,write\)/);
 assert.match(source,/session\.kind!=="web"/);
 assert.match(source,/current\(env,session\.user_id\)/);
 assert.match(source,/if\(!await enabled\(env\)\)/);
 assert.match(source,/result\.meta\.changes!==1/);
 assert.match(router,/path === "\/v1\/partners\/me"/);
 assert.match(router,/path === "\/v1\/admin\/partners\/policy"/);
});

test('partner candidate excludes automated transfers and schedulers, gates manual recipient details',()=>{
 const source=readFileSync(new URL('../src/partners.ts',import.meta.url),'utf8');
 const router=readFileSync(new URL('../src/index.ts',import.meta.url),'utf8');
 const card=readFileSync(new URL('../../web/src/components/account/PartnerMembershipCard.tsx',import.meta.url),'utf8');
 const account=readFileSync(new URL('../../web/src/components/account/AccountDashboard.tsx',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../../web/src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/partnerSummaryPlan|partner_commissions|partner_alipay|executePayout|transferFunds/);
 const payout=readFileSync(new URL('../src/partner-payout.ts',import.meta.url),'utf8');
 assert.match(payout,/requireAdminSession\(request,env,write\)/);
 assert.match(payout,/if\(write\)await requireCsrf\(request,env,token\)/);
 assert.match(payout,/encryptRecipient\(key,id,version,value,env\)/);
 assert.doesNotMatch(payout,/\bfetch\s*\(|executePayout|transferFunds|paymentProvider/);
 assert.match(card,/payoutContent=\{result\.payoutProfileEnabled\?<PartnerPayoutProfile/);
 assert.doesNotMatch(router,/scheduledPartner|\/v1\/partners\/alipay|\/v1\/admin\/partners\/(?:discovery|accrual-review|payout-review|order-preview|alipay-requests)/);
 assert.match(card,/if\(!result\?\.enabled\|\|!result\.policy\)return null/);
 assert.match(card,/api<Result>\("\/v1\/partners\/me"\)/);
 const wrapper=readFileSync(new URL('../../web/src/components/account/ReferralAndPartnerCards.tsx',import.meta.url),'utf8');
 assert.match(account,/<ReferralAndPartnerCards key=\{data\.account\.user\.userId\} owner=\{data\.account\.user\.userId\} language=\{language\}\/>/);
 assert.match(wrapper,/<ReferralInviteCard language=\{language\} showRecruitment=\{showRecruitment\} applicationsEnabled=\{result\?\.applicationsEnabled===true\} renderPartner=/);
 assert.match(wrapper,/<PartnerMembershipContent owner=\{owner\} language=\{language\} result=\{result\} inviteRecords=\{invites\}/);
 assert.match(wrapper,/result\?\.enabled===true&&result\.policy===null/);
 assert.match(wrapper,/usePartnerMembership\(owner\)/);
 assert.match(admin,/<PartnerAdminPanel language=\{language\} write=\{write\}/);
 assert.doesNotMatch(card,/PartnerAlipayRecipient|PartnerPayoutRequests|referral-share|\/promote\//);
});
