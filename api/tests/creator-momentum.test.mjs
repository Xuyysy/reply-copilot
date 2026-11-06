import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture} from './helpers/payment-v2.mjs';
import {DEFAULT_MOMENTUM_CONFIG} from '../../domain/creator-momentum.js';
function admin(f){f.env.ADMIN_PORTAL_ENABLED='1';f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator VALUES(1,'test-user',1); INSERT INTO admin_reauth_sessions VALUES('test-session',9999999999999)");}
const body=extra=>({operationId:randomUUID(),reason:'受控本地创作者功能配置测试',...extra});
function paid(f){f.sql.exec(`INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at,paid_at,credited_at) VALUES('paid-order','test-user','starter','fixture',400,149,'USD','paid',1,1,1);
 INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,status,provider_trade_id,created_at,updated_at,paid_at,risk_state,base_amount_fen) VALUES('paid-txn','paid-order','xiaodou','CNY',1043,'paid','verified-transaction',1,1,1,'clear',990);
 INSERT INTO credit_ledger(id,user_id,kind,paid_delta,reference_id,created_at) VALUES('real-purchase','test-user','purchase_grant',400,'paid-order',1);`);}
test('entitlements distinguish real settled purchase from gifts, exhausted credits, refunds and frozen state',async()=>{const f=fixture();try{
 let r=await f.call('/v1/entitlements',{method:'GET'});assert.equal(r.body.features?.interactionMomentum?.eligible,false);
 f.sql.exec("UPDATE credit_accounts SET paid_balance=500");assert.equal((await f.call('/v1/entitlements',{method:'GET'})).body.features.interactionMomentum.eligible,false);
 paid(f);f.sql.exec('UPDATE credit_accounts SET paid_balance=0,free_balance=0');r=await f.call('/v1/entitlements',{method:'GET'});assert.equal(r.body.features.interactionMomentum.eligible,true);assert.equal(r.body.status,'credits_exhausted');
 for(const q of ["UPDATE payment_transactions SET risk_state='manual_review'","UPDATE payment_transactions SET status='refunded'","UPDATE payment_transactions SET principal_refunded_fen=990"]){f.sql.exec(q);assert.equal((await f.call('/v1/entitlements',{method:'GET'})).body.features.interactionMomentum.eligible,false);f.sql.exec("UPDATE payment_transactions SET risk_state='clear',status='paid',principal_refunded_fen=0");}
 f.sql.exec('UPDATE payment_transactions SET principal_refunded_fen=100');assert.equal((await f.call('/v1/entitlements',{method:'GET'})).body.features.interactionMomentum.eligible,true);
 f.sql.exec("INSERT INTO payment_refunds(id,transaction_id,out_refund_no,amount_fen,status,reason,created_at,updated_at) VALUES('refund','paid-txn','R1',100,'pending','fixture',1,1)");assert.equal((await f.call('/v1/entitlements',{method:'GET'})).body.features.interactionMomentum.eligible,false);
 f.sql.exec("DELETE FROM payment_refunds; UPDATE users SET status='frozen'");assert.notEqual((await f.call('/v1/entitlements',{method:'GET'})).body.features?.interactionMomentum?.eligible,true);
 }finally{f.sql.close();}});
test('creator config requires admin, CSRF, reauth; versioned saves, stale writes, audit, rollback and isolated Staging preview',async()=>{const f=fixture();try{
 assert.equal((await f.call('/v1/admin/creator-momentum',{method:'GET'})).status,404);admin(f);
 const first=(await f.call('/v1/admin/creator-momentum',{method:'GET'})).body;assert.equal(first.config.enabled,false);
 const config={...DEFAULT_MOMENTUM_CONFIG,enabled:true};
 assert.equal((await f.call('/v1/admin/creator-momentum',{body:body({config,expectedVersion:first.config.version}),headers:{'X-CSRF-Token':''}})).status,403);
 const save=body({config,expectedVersion:first.config.version});let r=await f.call('/v1/admin/creator-momentum',{body:save});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.config.version,save.operationId);
 assert.equal((await f.call('/v1/admin/creator-momentum',{body:save})).status,200,'same operation replays');
 assert.equal((await f.call('/v1/admin/creator-momentum',{body:body({config,expectedVersion:first.config.version})})).status,409);
 const next=body({config:{...config,titleZh:'新的活动信号'},expectedVersion:save.operationId});assert.equal((await f.call('/v1/admin/creator-momentum',{body:next})).status,200);
 assert.equal((await f.call('/v1/admin/creator-momentum/restore',{body:body({versionId:save.operationId,expectedVersion:next.operationId})})).status,200);
 const latest=(await f.call('/v1/admin/creator-momentum',{method:'GET'})).body;assert.equal(latest.config.titleZh,config.titleZh);assert.equal(latest.versions.length,4);
 const count=f.sql.prepare('SELECT count(*) n FROM admin_audit_logs').get().n;
 assert.equal((await f.call('/v1/admin/creator-momentum/simulate',{body:{stage:3}})).status,200);assert.equal(f.sql.prepare('SELECT count(*) n FROM admin_audit_logs').get().n,count);
 f.env.ENVIRONMENT='production';assert.equal((await f.call('/v1/admin/creator-momentum/simulate',{body:{stage:1}})).status,404);
 assert.equal(f.sql.prepare('SELECT paid_balance FROM credit_accounts').get().paid_balance,0);
 }finally{f.sql.close();}});
test('creator config validates paid-only policy, bounds and recent reauth without changing orders or balances',async()=>{const f=fixture();try{admin(f);
 for(const patch of [{paidOnly:false},{maxReminders:100},{cooldownMinutes:1},{ranges:[[10,30],[20,40],[100,200]]},{researchZh:{html:'unsafe'}}]){const r=await f.call('/v1/admin/creator-momentum',{body:body({config:{...DEFAULT_MOMENTUM_CONFIG,...patch},expectedVersion:'default-v1'})});assert.equal(r.status,400);}
 f.sql.exec('DELETE FROM admin_reauth_sessions');assert.equal((await f.call('/v1/admin/creator-momentum',{body:body({config:DEFAULT_MOMENTUM_CONFIG,expectedVersion:'default-v1'})})).status,403);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM credit_ledger').get().n,0);
 }finally{f.sql.close();}});
test('concurrent config update rolls back operation and audit rather than overwriting another version',async()=>{const f=fixture();try{admin(f);const a=body({config:DEFAULT_MOMENTUM_CONFIG,expectedVersion:'default-v1'});assert.equal((await f.call('/v1/admin/creator-momentum',{body:a})).status,200);
 const batch=f.DB.batch.bind(f.DB);let raced=false;f.DB.batch=async statements=>{if(!raced&&statements.some(s=>s.query.includes('INSERT INTO system_settings'))){raced=true;const row=JSON.parse(f.sql.prepare("SELECT value FROM system_settings WHERE key='creator_momentum_v1'").get().value);row.version='concurrent-other';f.sql.prepare("UPDATE system_settings SET value=? WHERE key='creator_momentum_v1'").run(JSON.stringify(row));}return batch(statements);};
 const r=await f.call('/v1/admin/creator-momentum',{body:body({config:{...DEFAULT_MOMENTUM_CONFIG,enabled:true},expectedVersion:a.operationId})});assert.equal(r.status,409);assert.equal(f.sql.prepare('SELECT count(*) n FROM admin_operations').get().n,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM admin_audit_logs').get().n,1);assert.equal(JSON.parse(f.sql.prepare("SELECT value FROM system_settings WHERE key='creator_momentum_v1'").get().value).version,'concurrent-other');
 }finally{f.sql.close();}});
