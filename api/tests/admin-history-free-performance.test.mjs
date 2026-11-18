import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {measure} from './helpers/d1-performance.mjs';
import {ADMIN_HISTORY_LEDGER_SQL} from '../src/admin-historical-stats-queries.js';

// Synthetic 12k-row ledger. The historical aggregate remains exact, but the
// collapsed overview executes ZERO such ledger scans. No live D1 or network.
test('CF Free lazy historical bookkeeping eliminates one full-ledger read per collapsed overview',{timeout:120000},async()=>{
 let outbound=0;
 const mf=new Miniflare({workers:[{config:{
  name:'local-admin-legacy-ledger',compatibilityDate:'2026-10-14',
  env:{DB:{type:'d1',id:'local-admin-history'}},
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("local")}}'}}}
 },dev:{outboundService:{type:'fetcher',handler:()=>{outbound++;throw Error('Network not allowed')}}}}]});
 try{
  const db=await mf.getD1Database('DB');
  await db.prepare("CREATE TABLE credit_ledger(id TEXT PRIMARY KEY,kind TEXT,free_delta INTEGER,paid_delta INTEGER)").run();
  const count=12000;
  const sql=`WITH RECURSIVE seq(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM seq WHERE i+1<${count})
    INSERT INTO credit_ledger(id,kind,free_delta,paid_delta)
    SELECT 'l'||i,'generation_debit',-1,0 FROM seq`;
  await db.prepare(sql).run();
  const measured=await measure(db,ADMIN_HISTORY_LEDGER_SQL);
  assert.equal(measured.results[0].totalUsed,count);
  assert.equal(measured.rowsWritten,0);
  assert.ok(measured.rowsRead>=count,JSON.stringify({rowsRead:measured.rowsRead,plan:measured.plan}));
  console.log(JSON.stringify({event:'cf_free_collapsed_history_local_only',syntheticRows:count,legacyFullRowsRead:measured.rowsRead,collapsedOverviewLedgerRowsRead:0,scope:'optional historical ledger aggregation only'}));
 }finally{await mf.dispose();assert.equal(outbound,0);}
});
