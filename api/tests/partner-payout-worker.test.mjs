import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fixture,worker} from './helpers/payment-v2.mjs';
import {encryptRecipient,decryptRecipient} from '../src/partner-payout-crypto.mjs';
test('payout ciphertext binds identity and version',async()=>{
 const key=randomBytes(32).toString('base64'),value={name:'Synthetic User',account:'synthetic@example.test'};
 const cipher=await encryptRecipient(key,'partner',1,value);assert.ok(!cipher.includes(value.account));assert.notEqual(cipher,await encryptRecipient(key,'partner',1,value));
 assert.deepEqual(await decryptRecipient(key,'partner',1,cipher),value);
 for(const [id,v,k] of [['other',1,key],['partner',2,key],['partner',1,randomBytes(32).toString('base64')]])await assert.rejects(decryptRecipient(k,id,v,cipher));
});
test('CF Free: concurrent payout crypto reuses one scoped import, isolates keys and evicts failures',async()=>{
 const a=randomBytes(32).toString('base64'),b=randomBytes(32).toString('base64'),v={name:'Synthetic User',account:'synthetic@example.test'};
 const sealed=await encryptRecipient(a,'partner',1,v);
 const subtle=crypto.subtle,original=subtle.importKey,own=Object.getOwnPropertyDescriptor(subtle,'importKey');let imports=0,fail=false;
 Object.defineProperty(subtle,'importKey',{configurable:true,writable:true,value:function(...args){imports++;if(fail){fail=false;return Promise.reject(Error('synthetic import failure'));}return original.apply(this,args);}});
 try{
  const scope={},other={};
  assert.deepEqual(await Promise.all(Array.from({length:5},()=>decryptRecipient(a,'partner',1,sealed,scope))),Array(5).fill(v));assert.equal(imports,1);
  await decryptRecipient(a,'partner',1,sealed,other);assert.equal(imports,2);
  const changed=await encryptRecipient(b,'partner',2,v,scope);assert.equal(imports,3);
  assert.deepEqual(await decryptRecipient(b,'partner',2,changed,scope),v);assert.equal(imports,3);
  await assert.rejects(decryptRecipient(b,'partner',1,sealed,scope));assert.equal(imports,3);
  fail=true;await assert.rejects(decryptRecipient(a,'partner',1,sealed,scope));assert.equal(imports,4);
  await decryptRecipient(a,'partner',1,sealed,scope);assert.equal(imports,5);
 }finally{if(own)Object.defineProperty(subtle,'importKey',own);else Reflect.deleteProperty(subtle,'importKey');}
});
test('recipient profile: owner-only, reauth, encrypted versions, request snapshot and pending lock',async t=>{
 const f=fixture({released:false}),db=f.sql;t.after(()=>db.close());
 for(const name of ['0027_referral_rewards_v1.sql','partners_v1a_policy_proposal.sql','partners_manual_record_proposal.sql','partners_payout_profile_proposal.sql'])db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('external forbidden')};t.after(()=>{globalThis.fetch=old});
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',PAYMENTS_ENABLED:'0',XIAODOU_WEBHOOKS_ENABLED:'0',PARTNER_PAYOUT_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
 const tokens={};for(const [id,role] of [['owner','admin'],['partner','user'],['other','user']]){
 const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');tokens[id]=token;
 db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture',?)").run(id,id+'@example.test',id,role);
 db.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'web',1,?)").run('s-'+id,createHash('sha256').update(token).digest('hex'),id,Date.now()+60000);
 }
 db.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'owner',1);UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled')");
 db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('s-owner',?)").run(Date.now()+60000);
 async function call(id,path,body,extra={}){const token=tokens[id];const r=await worker.fetch(new Request(f.env.API_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{Origin:f.env.WEB_ORIGIN,'Content-Type':'application/json','X-Reply-Copilot-Action':'1',...(token?{Cookie:'rc_session='+token,'X-CSRF-Token':createHmac('sha256',f.env.AUTH_HASH_SECRET).update('csrf:'+token).digest('hex')} : {}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);return {status:r.status,body:await r.json(),cache:r.headers.get('Cache-Control')};}
 const me='/v1/partners/payout',admin='/v1/admin/partners/payout',report='/v1/partners/manual-report',policy='/v1/admin/partners/policy',manual='/v1/admin/partners/manual-report';
 const grant={userId:'partner',operationId:randomUUID(),status:'active',level:'standard',rateBps:1500,termMonths:null,expectedVersion:0,reason:'offline synthetic test'};
 assert.equal((await call('owner',policy,grant)).status,200);assert.deepEqual((await call('partner',me)).body,{enabled:false});
 db.exec("UPDATE system_settings SET value='1' WHERE key='partner_payout_profile_enabled'");
 assert.equal((await call(null,me)).status,401);assert.equal((await call('other',me)).status,403);assert.equal((await call('partner',admin+'?userId=partner')).status,403);
 const value={name:'Synthetic Recipient',account:'synthetic@example.test',expectedVersion:0};
 assert.equal((await call('partner',me,value,{'X-CSRF-Token':'bad'})).status,403);
 assert.equal((await call('partner',me,{...value,userId:'other'})).status,409);
 const saved=await call('partner',me,value);assert.equal(saved.status,200);assert.equal(saved.cache,'no-store');assert.equal(saved.body.profile.name,'S***');assert.ok(!JSON.stringify(saved.body).includes(value.account));
 const stored=db.prepare("SELECT * FROM partner_payout_profiles").get();assert.ok(!JSON.stringify(stored).includes(value.account));assert.ok(!JSON.stringify(stored).includes(value.name));
 assert.equal((await call('partner',me,value)).status,409);
 const reveal={userId:'partner',reason:'verify synthetic recipient',operationId:randomUUID()};
 db.exec("DELETE FROM admin_reauth_sessions WHERE session_id='s-owner'");
 assert.equal((await call('owner',admin,reveal)).status,403);assert.equal((await call('other',admin,reveal)).status,403);
 db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('s-owner',?)").run(Date.now()+60000);
 assert.equal((await call('owner',admin+'?userId=partner')).body.configured,true);
 // Actual Worker routes, not source regex: report reads and directory reads
 // must not decrypt, and a profile view or audited reveal decrypts exactly once.
 const subtle=crypto.subtle,originalDecrypt=subtle.decrypt,ownDecrypt=Object.getOwnPropertyDescriptor(subtle,'decrypt');let decrypts=0;
 Object.defineProperty(subtle,'decrypt',{configurable:true,writable:true,value:function(...args){decrypts++;return originalDecrypt.apply(this,args);}});
 try{
  for(let i=0;i<3;i++){const r=await call('partner',report);assert.equal(r.status,200);assert.equal(r.body.recipientReady,true);}
  assert.equal((await call('owner','/v1/admin/partners/list')).status,200);
  assert.equal((await call('owner',admin+'?userId=partner')).status,200);
  assert.equal((await call('owner',manual+'?userId=partner')).status,200);
  assert.equal(decrypts,0);
  assert.equal((await call('partner',me)).status,200);assert.equal(decrypts,1);
  assert.equal((await call('owner',admin,reveal)).status,200);assert.equal(decrypts,2);
 }finally{if(ownDecrypt)Object.defineProperty(subtle,'decrypt',ownDecrypt);else Reflect.deleteProperty(subtle,'decrypt');}

 assert.deepEqual((await call('owner',admin,reveal)).body.profile,{name:value.name,account:value.account});
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_payout_reveal_audit").get().n,2);
 const requestId=randomUUID(),seed=db.prepare("INSERT INTO partner_manual_requests(id,partner_user_id,amount_fen,created_at) VALUES(?,?,?,?)");
 assert.throws(()=>seed.run(randomUUID(),'other',1000,Date.now()));
 seed.run(requestId,'partner',1000,Date.now());
 assert.equal(db.prepare("SELECT profile_version FROM partner_request_recipients WHERE request_id=?").get(requestId).profile_version,1);
 assert.equal((await call('partner',me,{...value,expectedVersion:1})).status,409);
 assert.equal((await call('owner',admin,{...reveal,requestId})).body.version,1);
 assert.equal((await call('owner',manual,{requestId,operationId:randomUUID(),action:'rejected',reason:'synthetic rejection'})).status,200);
 const changed=await call('partner',me,{name:'New Recipient',account:'new@example.test',expectedVersion:1});assert.equal(changed.status,200);assert.equal(changed.body.version,2);
 assert.equal((await call('owner',admin,{...reveal,requestId})).body.profile.account,value.account);
 assert.equal((await call('owner',admin,reveal)).body.profile.account,'new@example.test');
 const key=f.env.PARTNER_PAYOUT_ENCRYPTION_KEY;f.env.PARTNER_PAYOUT_ENCRYPTION_KEY='invalid';
 assert.equal((await call('partner',me)).status,503);assert.equal((await call('owner',admin,reveal)).status,503);
 const denied=await call('partner',report);assert.equal(denied.status,200);assert.equal(denied.body.recipientReady,false);assert.equal(denied.body.requestableFen,null);f.env.PARTNER_PAYOUT_ENCRYPTION_KEY=key;

 // Real application endpoint against isolated paid evidence, never live orders.
 const paid=db.prepare("SELECT effective_at FROM partner_policy_versions WHERE user_id='partner'").get().effective_at;
 db.prepare("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,registered_at) VALUES('other','partner','0123456789abcdef',?)").run(paid);
 db.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('other',0,0,1,1)").run();
  function paidOrder(orderId,principal){
  // Same ordinary recharge fixture contract as the repository's existing
  // offline payment regression tests. No live order or callback is created.
  const tx='tx-'+orderId,out='out-'+orderId,trade='trade-'+orderId;
  db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,payment_method,provider_reference,created_at,paid_at,credited_at) VALUES(?,'other','starter','fixture',500,100,'USD','paid','mk99',?,?,?,?)").run(orderId,out,paid,paid,paid);
  db.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,base_amount_fen,service_fee_fen,fee_rate_bps,fee_snapshot_version,provider_fee_projection_status,status,provider_trade_id,created_at,updated_at,payment_protocol,payment_channel,settlement_mode,exchange_rate_micros,merchant_provider,merchant_account,notification_sign_type,amount_contract,provider_requested_fen,provider_payment_id,paid_at) VALUES(?,?,'xiaodou','CNY',?,?,0,0,'fee-v1','not_applicable','paid',?,?,?,'rsa2','ALIPAY_H5','fixed_cny',1000000,'mk99','fixture','MD5','CNY_EXACT_BUYER_TOTAL',?,?,?)").run(tx,orderId,principal,principal,out,paid,paid,principal,trade,paid);
  db.prepare("INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at,merchant_provider) VALUES(?,'xiaodou',?,?,'PAYMENT_SUCCEEDED',?,'CNY',?,?,'mk99')").run('event-'+orderId,'fixture-paid-'+orderId,tx,principal,'a'.repeat(64),paid);
  db.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES(?,'other','purchase_grant',0,500,?,'offline fixture',?)").run('ledger-'+orderId,orderId,paid);
  db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,source_order_id,grant_credits,remaining_credits,granted_at,paid_at,history_confidence,status) VALUES(?,'other','paid','purchase',?,500,500,?,?,'tracked','active')").run('batch-'+orderId,orderId,paid,paid);
  db.exec("UPDATE credit_accounts SET paid_balance=paid_balance+500 WHERE user_id='other'");
 }
 paidOrder('local-payout-order',10000);
 const validReport=await call('partner',report);assert.equal(validReport.body.requestableFen,1500);
 // A syntactically valid but incorrect key must be rejected at submission,
 // even though the cheap report hint says a profile exists.
 f.env.PARTNER_PAYOUT_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 assert.equal((await call('partner',report)).body.recipientReady,true);
 const blocked=await call('partner',report,{expectedAmountFen:1500});assert.equal(blocked.status,409);assert.equal(blocked.body.code,'PAYOUT_NOT_CONFIGURED');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_manual_requests WHERE status='pending'").get().n,0);
 f.env.PARTNER_PAYOUT_ENCRYPTION_KEY=key;
 const applied=await call('partner',report,{expectedAmountFen:1500});assert.equal(applied.status,200,JSON.stringify(applied.body));
 const pendingId=(await call('partner',report)).body.pendingId;
 assert.equal(db.prepare("SELECT profile_version FROM partner_request_recipients WHERE request_id=?").get(pendingId).profile_version,2);
 const pretransfer={...reveal,requestId:pendingId,forSettlement:true};
 assert.equal((await call('owner',admin,pretransfer)).status,200);
 assert.equal((await call('owner',manual+'?requestId='+pendingId)).body.settlementReady,true);
 db.exec("UPDATE payment_transactions SET risk_state='manual_review' WHERE order_id='local-payout-order'");
 const stale=await call('owner',admin,pretransfer);assert.equal(stale.status,409);assert.equal(stale.body.code,'PARTNER_SETTLEMENT_CHANGED');assert.equal(stale.body.profile,undefined);
 assert.equal((await call('owner',manual+'?requestId='+pendingId)).body.settlementReady,false);
 assert.equal((await call('partner',manual+'?requestId='+pendingId)).status,403);
 db.exec("UPDATE payment_transactions SET risk_state='clear' WHERE order_id='local-payout-order'");
 assert.equal((await call('owner',admin,pretransfer)).status,200);
 // Once an external transfer is completed the admin must be able to record
 // it, even if evidence changes in the meantime; future balance absorbs debt.
 db.exec("UPDATE payment_transactions SET risk_state='manual_review' WHERE order_id='local-payout-order'");
 assert.equal((await call('owner',manual,{requestId:pendingId,operationId:randomUUID(),action:'completed',reason:'synthetic recorded transfer'})).status,200);
 assert.equal((await call('partner',report)).body.summary.differenceFen,-1500);
 assert.equal((await call('owner',admin,pretransfer)).status,409);

 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_payout_profiles").get().n,2);
});
