import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setupSyntheticWorkerd,InspectorClient} from '../scripts/cf-free-workerd-cpu.mjs';
import {migrationStatements,summarizeWallMs,summarizeV8Profile} from '../scripts/lib/workerd-cpu-evidence.mjs';

// Only isolated Workerd + Miniflare D1. No remote bindings or real funds.
// This proposal uses top-level unindented DDL statements; do not split
// triggers on CASE ... END; inside the trigger body.
const ledgerStatements=source=>source.replace(/^\s*--[^\n]*$/gm,'').split(/(?=^(?:CREATE |INSERT INTO ))/m).map(x=>x.trim()).filter(Boolean);
test('local actual D1 incremental commission: 125 orders, bounded sync and indexed clean read',{timeout:120000},async()=>{
 const f=await setupSyntheticWorkerd({profile:true,measureBatches:true,partnerLedger:true});
 let inspector;
 try{
  const db=f.db,user='benchmark-main-user',buyer='ledger-buyer',owner='ledger-admin';
  const run=(q,...p)=>db.prepare(q).bind(...p).run();
  const proposal=name=>readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8');
  for(const name of ['0027_referral_rewards_v1.sql','partners_v1a_policy_proposal.sql','partners_manual_record_proposal.sql','0028_boltutil_usdt.sql'])
   for(const stmt of migrationStatements(proposal(name)))await run(stmt);
  for(const stmt of ledgerStatements(proposal('partner_commission_ledger_proposal.sql')))await run(stmt);
  await run("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture','admin')",owner,owner+'@example.test',owner);
  await run("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture','user')",buyer,buyer+'@example.test',buyer);
  await run("INSERT INTO partner_policy_versions(user_id,version,status,level,rate_bps,term_months,effective_at,authorized_by,reason) VALUES(?,1,'active','standard',1500,NULL,1,?,'offline')",user,owner);
  await run("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,registered_at) VALUES(?,?,'0123456789abcdef',1)",buyer,user);
  await run("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled','partner_commission_ledger_enabled')");
  const paid=Date.now()-1000;
  const payment=async id=>{
   const tx='tx-'+id;
   const statements=[
    db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,payment_method,provider_reference,created_at,paid_at,credited_at) VALUES(?,?,'starter','fixture',500,100,'USD','paid','xiaodou',?,?,?,?)").bind(id,buyer,'out-'+id,paid,paid,paid),
    db.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,base_amount_fen,service_fee_fen,fee_rate_bps,fee_snapshot_version,provider_fee_projection_status,status,provider_trade_id,created_at,updated_at,payment_protocol,payment_channel,settlement_mode,exchange_rate_micros,merchant_provider,merchant_account,notification_sign_type,amount_contract,provider_requested_fen,paid_at) VALUES(?,?,'xiaodou','CNY',1990,1990,0,0,'fee-v1','not_applicable','paid',?,?,?,'rsa2','ALIPAY_H5','fixed_cny',1000000,'xiaodou','fixture','RSA2','CNY_EXACT_BUYER_TOTAL',1990,?)").bind(tx,id,'out-'+id,paid,paid,paid),
    db.prepare("INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at,merchant_provider) VALUES(?,'xiaodou',?,?,'PAYMENT_SUCCEEDED',1990,'CNY',?,?,'xiaodou')").bind('event-'+id,'event-'+id,tx,'a'.repeat(64),paid),
    db.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES(?,?,'purchase_grant',0,500,?,'local fixture',?)").bind('ledger-'+id,buyer,id,paid),
    db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,source_order_id,grant_credits,remaining_credits,granted_at,paid_at,history_confidence,status) VALUES(?,?,'paid','purchase',?,500,500,?,?,'tracked','active')").bind('batch-'+id,buyer,id,paid,paid)
   ];return db.batch(statements);
  };
  const metadata=rs=>rs.reduce((a,r)=>({rowsRead:a.rowsRead+(r.meta?.rows_read??0),rowsWritten:a.rowsWritten+(r.meta?.rows_written??0),missing:a.missing+(Number.isSafeInteger(r.meta?.rows_read)&&Number.isSafeInteger(r.meta?.rows_written)?0:1)}),{rowsRead:0,rowsWritten:0,missing:0});
  const token='a'.repeat(64),auth='isolated-benchmark-auth-key-not-a-secret-123',url='https://isolated-api.example.test/v1/partners/manual-report';
  const headers={Origin:'https://isolated-web.example.test',Cookie:'rc_session='+token,'Content-Type':'application/json','X-Reply-Copilot-Action':'1','X-CSRF-Token':createHmac('sha256',auth).update('csrf:'+token).digest('hex')};
  const call=async sync=>{
   const start=performance.now(),r=await f.mf.dispatchFetch(url,{method:sync?'POST':'GET',headers,...(sync?{body:JSON.stringify({sync:true})}:{})}),body=await r.json();
   assert.equal(r.status,200,JSON.stringify(body));return {body,wall:performance.now()-start,tally:JSON.parse(r.headers.get('X-CF-Free-Local-Batch'))};
  };
  const first=metadata(await payment('order-000'));
  let r=await call(true);assert.equal(r.body.summary.estimatedFen,298);const one=r.tally;
  const cleanOne=await call(false);assert.equal(cleanOne.tally.calls,0);
  for(let i=1;i<125;i++)await payment('order-'+String(i).padStart(3,'0'));
  const before=await call(false);assert.equal(before.body.syncPending,true);assert.equal(before.body.requestableFen,null);
  const sync=[];
  while(r.body.summary.verifiedOrders<125){r=await call(true);sync.push(r.tally);assert.ok(sync.length<=7);}
  assert.equal(r.body.summary.estimatedFen,125*298);assert.equal(r.body.syncPending,false);
  inspector=await InspectorClient.connect(f.mf);await inspector.call('Profiler.start');
  const times=[],clean=[];
  let profile;
  try{for(let i=0;i<3;i++){const read=await call(false);assert.equal(read.body.summary.estimatedFen,125*298);assert.equal(read.tally.calls,0);assert.equal(read.tally.standaloneCalls,cleanOne.tally.standaloneCalls);times.push(read.wall);clean.push(read.tally);}}
  finally{profile=(await inspector.call('Profiler.stop')).profile;}
  const pagePlan=await db.prepare("EXPLAIN QUERY PLAN SELECT domain,order_id,paid_at FROM partner_commission_entries WHERE partner_user_id=? AND state<>'excluded' ORDER BY paid_at DESC,domain DESC,order_id DESC LIMIT 31").bind(user).all();
  assert.match(JSON.stringify(pagePlan.results),/partner_commission_entries_page_idx/);
  assert.equal(f.getExternalCalls(),0);
  console.log('XRH_COMMISSION_LOCAL '+JSON.stringify({scope:'instrumented isolated Workerd D1',payment:first,oneSync:one,fullBatches:sync,cleanOne:cleanOne.tally,clean125:clean,wall:summarizeWallMs(times),cpuProfile:summarizeV8Profile(profile),externalCalls:0,caveat:'Local D1 batch metadata only; standalone calls are counted, not rows. Instrumented V8 and wall time are not billed Cloudflare CPU.'}));
 }finally{if(inspector)inspector.close();await f.mf.dispose();}
});
