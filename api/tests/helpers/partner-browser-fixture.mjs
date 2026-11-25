import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {fixture,worker} from './payment-v2.mjs';
const root='/v1/admin/partners/';
const me='/v1/partners/';
const secret='local-v2-auth-secret-which-is-not-a-real-secret';
const reason='local synthetic review only';
export function setup(t){
 const f=fixture();t.after(()=>f.sql.close());
 for(const name of ['0027_referral_rewards_v1.sql','partners_v1a_policy_proposal.sql','partners_v1b_ledger_proposal.sql','partners_v1b_recovery_proposal.sql','partners_v1d_payout_proposal.sql','partners_alipay_recipient_proposal.sql','partners_alipay_transfer_proposal.sql','partners_query_indexes_proposal.sql'])f.sql.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 const db=f.sql,now=Date.now();
 // No real network or payment operations. Every account, session and
 // provider fact below is synthetic and confined to this memory database.
 // Browser harness installs its own loopback-only fetch policy.
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',PARTNER_ACCRUAL_REVIEW_ENABLED:'1',PARTNER_SCHEDULED_ACCRUAL_ENABLED:'1',PARTNER_DISCOVERY_ENABLED:'1',PARTNER_SCHEDULED_DISCOVERY_ENABLED:'1',PARTNER_PAYOUT_REVIEW_ENABLED:'1',PARTNER_ALIPAY_KEY_ID:'fixture',PARTNER_ALIPAY_ENCRYPTION_KEY:'42'.repeat(32)});
 const tokens={};
 for(const [id,role,token] of [['a','admin','a'.repeat(64)],['p','user','c'.repeat(64)],['b','user','d'.repeat(64)],['q','user','e'.repeat(64)]]){
  tokens[id]=token;
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture-hash',?)").run(id,id+'@example.test','fixture-'+id,role);
  db.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'web',1,?)").run('session-'+id,createHash('sha256').update(token).digest('hex'),id,now+3600000);
  db.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,0,0,1,1)").run(id);
 }
 db.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'a',1)");
 function reauth(){db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('session-a',?) ON CONFLICT(session_id) DO UPDATE SET expires_at=excluded.expires_at").run(Date.now()+3600000);}
 async function call(id,path,body,extra={}){
  const token=tokens[id];
  const headers={Origin:f.env.WEB_ORIGIN,Cookie:'rc_session='+token,'Content-Type':'application/json','X-Reply-Copilot-Action':'1','X-CSRF-Token':createHmac('sha256',secret).update('csrf:'+token).digest('hex'),...extra};
  const res=await worker.fetch(new Request(f.env.API_ORIGIN+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);
  return {status:res.status,body:await res.json(),cache:res.headers.get('Cache-Control')};
 }
 function enable(){db.exec("UPDATE system_settings SET value='1' WHERE key LIKE 'partner_%_enabled'");}
 const policy={userId:'p',operationId:randomUUID(),status:'active',level:'standard',rateBps:2000,termMonths:12,expectedVersion:0,reason};
 async function ok(...args){const r=await call(...args);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
 return {f,db,call,ok,reauth,enable,policy,tokens};
}

export function seedPaid(db){
 const effective=db.prepare("SELECT effective_at FROM partner_policy_versions WHERE user_id='p'").get().effective_at;
 // The synthetic payment is at the first authorized instant; no mutation
 // of immutable policy rows. The one-millisecond hold is fixture-only.
 const paid=effective,applied=paid;
 db.prepare("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,registered_at) VALUES('b','p','0123456789abcdef',?)").run(paid);
 db.prepare("INSERT INTO partner_accrual_windows VALUES('w',?,NULL,'product_principal',1,'a','fixture only')").run(paid);
 db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,payment_method,provider_reference,created_at,paid_at,credited_at) VALUES('o','b','starter','fixture',500,100,'USD','paid','mk99','out',?,?,?)").run(paid,paid,applied);
 db.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,base_amount_fen,service_fee_fen,fee_rate_bps,fee_snapshot_version,provider_fee_projection_status,status,provider_trade_id,created_at,updated_at,payment_protocol,payment_channel,settlement_mode,exchange_rate_micros,merchant_provider,merchant_account,notification_sign_type,amount_contract,provider_requested_fen,provider_payment_id,paid_at) VALUES('tx','o','xiaodou','CNY',10000,10000,0,0,'fee-v1','not_applicable','paid','out',?,?,'rsa2','ALIPAY_H5','fixed_cny',1000000,'mk99','fixture','MD5','CNY_EXACT_BUYER_TOTAL',10000,'trade',?)").run(paid,paid,paid);
 db.prepare("INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at,merchant_provider) VALUES('ev','xiaodou','mk99:paid:trade','tx','PAYMENT_SUCCEEDED',10000,'CNY',?,?,'mk99')").run('a'.repeat(64),paid);
 db.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES('l','b','purchase_grant',0,500,'o','fixture',?)").run(applied);
 db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,source_order_id,grant_credits,remaining_credits,granted_at,paid_at,history_confidence,status) VALUES('cb','b','paid','purchase','o',500,500,?,?,'tracked','active')").run(applied,paid);
 db.exec("UPDATE credit_accounts SET paid_balance=500 WHERE user_id='b'");

 return {paid,applied};
}
