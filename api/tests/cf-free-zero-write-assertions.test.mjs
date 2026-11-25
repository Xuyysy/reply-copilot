import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fixture, temp } from './helpers/payment-v2.mjs';
import { creditInvariant } from '../src/credit-assertion.js';

const FLAG = 'CF_FREE_ZERO_WRITE_ASSERTIONS';
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

test('credit invariant is default-off and only literal 1 selects a read-only statement', () => {
  const db = { prepare(query) { return { query, bind(...args) { return {query,args}; } }; } };
  for (const flag of [undefined,'0','true','']) {
    const stmts = creditInvariant({DB:db,[FLAG]:flag},'op','? = 1',[1]);
    assert.equal(stmts.length,2);
    assert.match(stmts[0].query,/^INSERT INTO credit_operation_assertions/);
    assert.match(stmts[1].query,/^DELETE FROM credit_operation_assertions/);
    assert.deepEqual(stmts[0].args,['op',1]);
  }
  const stmts = creditInvariant({DB:db,[FLAG]:'1'},'op','? = 1',[1]);
  assert.equal(stmts.length,1);
  assert.match(stmts[0].query,/^SELECT CASE WHEN/);
  assert.deepEqual(stmts[0].args,['op',1]);
});

test('local workerd D1 batch: success, false, NULL, missing rows, collision and later failure are atomic', async () => {
  // No remote bindings, account IDs, real users or network requests.
  const mf = new Miniflare({workers:[{
    config:{name:'xrh-assertion-offline',compatibilityDate:'2026-10-14',
      env:{DB:{type:'d1',id:'xrh-assertion-offline'}},
      manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("offline")}}'}}}},
    dev:{outboundService:{type:'fetcher',handler:()=>{throw Error('Offline only');}}}
  }]});
  try {
    const db = await mf.getD1Database('DB');
    await db.batch([
      db.prepare('CREATE TABLE balances(id TEXT PRIMARY KEY,n INTEGER NOT NULL CHECK(n>=0))'),
      db.prepare('CREATE TABLE ledger(id TEXT PRIMARY KEY,delta INTEGER NOT NULL)'),
      db.prepare('CREATE TABLE credit_operation_assertions(operation_id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1))'),
      db.prepare("INSERT INTO balances VALUES('u',5)")
    ]);
    const measured=[];
    for(const flag of ['0','1']){
      const env={DB:db,[FLAG]:flag};
      async function reset(){
        await db.batch([db.prepare('DELETE FROM ledger'),db.prepare('DELETE FROM credit_operation_assertions'),db.prepare("UPDATE balances SET n=5 WHERE id='u'")]);
      }
      async function snapshot(){
        return {
          balance:await db.prepare("SELECT n FROM balances WHERE id='u'").first('n'),
          ledger:(await db.prepare('SELECT id,delta FROM ledger ORDER BY id').all()).results,
          assertions:(await db.prepare('SELECT operation_id,ok FROM credit_operation_assertions ORDER BY operation_id').all()).results
        };
      }
      const mutate=()=>[db.prepare("UPDATE balances SET n=n-1 WHERE id='u'"),db.prepare("INSERT INTO ledger VALUES('debit',-1)")];
      const condition="EXISTS(SELECT 1 FROM balances WHERE id=? AND n=?) AND EXISTS(SELECT 1 FROM ledger WHERE id=?)";
      await reset();
      const result=await db.batch([...mutate(),...creditInvariant(env,'op',condition,['u',4,'debit'])]);
      assert.deepEqual(await snapshot(),{balance:4,ledger:[{id:'debit',delta:-1}],assertions:[]});
      if(flag==='1')assert.equal(result[2].results[0].assertion_ok,1);
      // Count only the committed batch (not setup, reads or reset). Keep local
      // D1 metadata separate from cloud billing; no extrapolation to production.
      const readWrite = key => result.every(r => Number.isSafeInteger(r.meta?.[key]))
        ? result.reduce((sum,r)=>sum+r.meta[key],0) : null;
      measured.push({mode:flag==='1'?'select':'insert-delete',statements:result.length,
        rowsRead:readWrite('rows_read'),rowsWritten:readWrite('rows_written'),
        assertionRowsWritten:result.slice(2).every(r=>Number.isSafeInteger(r.meta?.rows_written))
          ? result.slice(2).reduce((sum,r)=>sum+r.meta.rows_written,0):null});
      for(const [predicate,args] of [['?',[0]],['?',[null]], [condition,['missing',4,'debit']]]){
        await reset();
        const before=await snapshot();
        await assert.rejects(db.batch([...mutate(),...creditInvariant(env,'op',predicate,args)]));
        assert.deepEqual(await snapshot(),before);
      }
      await reset();
      await db.prepare("INSERT INTO credit_operation_assertions VALUES('op',1)").run();
      const collisionBefore=await snapshot();
      await assert.rejects(db.batch([...mutate(),...creditInvariant(env,'op',condition,['u',4,'debit'])]));
      assert.deepEqual(await snapshot(),collisionBefore);
      await reset();
      const laterBefore=await snapshot();
      await assert.rejects(db.batch([...mutate(),...creditInvariant(env,'op',condition,['u',4,'debit']),db.prepare("INSERT INTO ledger VALUES('debit',-1)")]));
      assert.deepEqual(await snapshot(),laterBefore);
    }
    assert.equal(measured[0].statements-measured[1].statements,1);
    if(measured[1].assertionRowsWritten!==null)assert.equal(measured[1].assertionRowsWritten,0);
    if(measured.every(row=>row.rowsWritten!==null))assert.ok(measured[0].rowsWritten>measured[1].rowsWritten);
    console.log('CF_FREE_LOCAL_D1_METADATA '+JSON.stringify(measured));
  } finally { await mf.dispose(); }
});

buildSync({entryPoints:[new URL('../src/quota.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:temp+'/cf-free-quota.cjs'});
const {reserveGeneration,finishGeneration,releaseExpiredDeliveryReservations}=createRequire(import.meta.url)(temp+'/cf-free-quota.cjs');
const session={user_id:'test-user',kind:'extension'};
const reserve=(f,n)=>reserveGeneration(f.env,session,id(n),'hash-'+n,100);
const usage={model:'mock',inputTokens:1,outputTokens:3,costMicroUsd:10};
async function ack(f,n){
  f.sql.exec("UPDATE sessions SET kind='extension'");
  return f.call('/v1/ai/requests/'+id(n)+'/delivered',{headers:{Authorization:'Bearer '+'b'.repeat(64),Origin:f.env.EXTENSION_ORIGIN},body:{requestId:id(n)}});
}
function setup(f,source){
  f.env.SUBSCRIPTIONS_ENABLED=source==='subscription'?'1':'0';
  if(source==='paid'){
    f.sql.exec("DELETE FROM credit_batches WHERE id='free-batch'; UPDATE credit_accounts SET free_balance=0,paid_balance=200");
    f.sql.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES('paid-batch','test-user','paid','legacy_paid',200,200,1,'tracked','active')").run();
  }
  if(source==='subscription'){
    const now=Date.now(),start=now-2*86400000-10000;
    f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES('sub-order','test-user','basic-v1','purchase',6990,'paid',1,9999999999999,1,1,?,?)").run(now,now);
    f.sql.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,provider_trade_id,payment_channel,amount_fen,status,risk_state,created_at,updated_at,paid_at) VALUES('sub-txn','sub-order','local_mock','sub-trade','LOCAL_MOCK',6990,'paid','clear',1,1,?)").run(now);
    f.sql.prepare("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,received_at) VALUES('sub-event','sub-txn','local_mock','sub-event-key','PAYMENT_SUCCEEDED',6990,?)").run(now);
    f.sql.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('sub-period','test-user','sub-order','basic-v1',500,'active',?,?,1,1)").run(start,start+30*86400000);
  }
}
function state(f){
  return Object.fromEntries(Object.entries({
    accounts:"SELECT user_id,free_balance,paid_balance,free_generation_reserved,paid_generation_reserved,paid_reserved_for_refunds FROM credit_accounts ORDER BY user_id",
    lots:"SELECT id,remaining_credits,consumed_credits,generation_reserved_credits,refund_reserved_credits FROM credit_batches ORDER BY id",
    requests:"SELECT request_id,status,consumed,credit_source FROM ai_requests ORDER BY request_id",
    ledger:"SELECT kind,free_delta,paid_delta,reference_id FROM credit_ledger ORDER BY kind,reference_id",
    daily:"SELECT period_id,day_index,used,reserved FROM subscription_daily_usage ORDER BY period_id,day_index",
    allocations:"SELECT request_id,state FROM subscription_ai_allocations ORDER BY request_id",
    events:"SELECT request_id,event_type FROM subscription_usage_events ORDER BY request_id,event_type",
    assertionRows:"SELECT operation_id,ok FROM credit_operation_assertions ORDER BY operation_id"
  }).map(([key,sql])=>[key,f.sql.prepare(sql).all().map(row=>({...row}))]));
}
for(const source of ['free','paid','subscription']){
  test('business parity: '+source+' reserve, ACK replay, expired delivery and injected failure',async()=>{
    const snapshots=[];
    for(const flag of ['0','1']){
      const f=fixture();
      try{
        f.env[FLAG]=flag;setup(f,source);
        const seen=[];
        const batch=f.DB.batch.bind(f.DB);
        f.DB.batch=async statements=>{
          seen.push(...statements.map(s=>s.query));
          return batch(statements);
        };
        assert.equal((await reserve(f,101)).kind,'new');
        await finishGeneration(f.env,'test-user',id(101),'three drafts',usage);
        const ok=await ack(f,101);
        assert.equal(ok.status,200,JSON.stringify(ok.body));
        assert.equal(ok.body.alreadyConfirmed,false);
        const repeat=await ack(f,101);
        assert.equal(repeat.status,200,JSON.stringify(repeat.body));
        assert.equal(repeat.body.alreadyConfirmed,true);
        assert.equal((await reserve(f,102)).kind,'new');
        await finishGeneration(f.env,'test-user',id(102),'three drafts',usage);
        f.sql.prepare('UPDATE ai_requests SET response_expires_at=? WHERE request_id=?').run(Date.now()-1,id(102));
        await releaseExpiredDeliveryReservations(f.env,Date.now(),'test-user');
        const before=state(f);
        // Force the real invariant statement to fail within the fixture's atomic batch.
        f.DB.batch=async statements=>batch(statements.map(s=>{
          if(flag==='1'&&s.query.includes(' AS assertion_ok'))return f.DB.prepare("SELECT json_extract('assert-failed','$')");
          if(flag==='0'&&s.query.startsWith('INSERT INTO credit_operation_assertions'))return f.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) VALUES('forced-failure',0)");
          return s;
        }));
        await assert.rejects(reserve(f,103));
        assert.deepEqual(state(f),before);
        assert.equal(before.assertionRows.length,0);
        assert.equal(before.requests.find(r=>r.request_id===id(101)).consumed,1);
        assert.equal(before.requests.find(r=>r.request_id===id(102)).consumed,0);
        if(flag==='1'){
          assert.ok(seen.some(s=>s.includes(' AS assertion_ok')));
          assert.equal(seen.some(s=>/^\s*(INSERT INTO|DELETE FROM) credit_operation_assertions/.test(s)),false);
        }else assert.ok(seen.some(s=>s.startsWith('INSERT INTO credit_operation_assertions')));
        snapshots.push(before);
      }finally{f.sql.close();}
    }
    assert.deepEqual(snapshots[0],snapshots[1]);
  });
}
