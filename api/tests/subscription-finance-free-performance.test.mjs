import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {measure} from './helpers/d1-performance.mjs';
import {SUBSCRIPTION_30D_USAGE_SQL} from '../src/admin-subscription-finance-queries.js';

// Completely isolated synthetic workerd D1: no Production, Staging or backup SQL.
test('on-demand subscription finance avoids repeated 30-day read scans on routine admin visits',{timeout:120000},async()=>{
 let outbound=0;
 const mf=new Miniflare({workers:[{config:{
  name:'isolated-subscription-finance',
  compatibilityDate:'2026-10-14',
  env:{DB:{type:'d1',id:'synthetic-subscription-finance'}},
  manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("local")}}'}}}
 },dev:{outboundService:{type:'fetcher',handler:()=>{outbound++;throw Error('No external access permitted')}}}}]});
 try{
  const db=await mf.getD1Database('DB');
  for(const ddl of [
   'CREATE TABLE subscription_usage_events(id TEXT PRIMARY KEY,event_type TEXT NOT NULL,created_at INTEGER NOT NULL)',
   'CREATE TABLE ai_usage_costs(user_id TEXT NOT NULL,request_id TEXT NOT NULL,estimated_cost_micro_usd INTEGER NOT NULL,created_at INTEGER NOT NULL)',
   'CREATE TABLE subscription_ai_allocations(user_id TEXT NOT NULL,request_id TEXT NOT NULL)',
   'CREATE INDEX ai_usage_costs_created_idx ON ai_usage_costs(created_at)',
   'CREATE UNIQUE INDEX subscription_allocations_user_request_idx ON subscription_ai_allocations(user_id,request_id)'
  ])await db.prepare(ddl).run();
  const count=8000,at=Date.UTC(2026,10,17);
  const seq=`WITH RECURSIVE seq(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM seq WHERE i+1<${count})`;
  await db.prepare(`${seq} INSERT INTO subscription_usage_events(id,event_type,created_at) SELECT 'event-'||i,'consume',${at} FROM seq`).run();
  await db.prepare(`${seq} INSERT INTO ai_usage_costs(user_id,request_id,estimated_cost_micro_usd,created_at) SELECT 'u0','r'||i,13,${at} FROM seq`).run();
  await db.prepare(`${seq} INSERT INTO subscription_ai_allocations(user_id,request_id) SELECT 'u0','r'||i FROM seq`).run();
  const full=await measure(db,SUBSCRIPTION_30D_USAGE_SQL,[at-86400000,at-86400000]);
  assert.deepEqual(full.results,[{consumed:count,cost_micro_usd:count*13}]);
  assert.ok(full.rowsRead>=count,JSON.stringify({read:full.rowsRead,plan:full.plan}));
  assert.equal(full.rowsWritten,0);
  console.log(JSON.stringify({event:'cf_free_subscription_finance_local_only',syntheticSubscriptionRows:count,legacyFullRowsRead:full.rowsRead,summaryHistoryRowsRead:0,scope:'optional usage and provider-cost SQL only'}));
 }finally{await mf.dispose();assert.equal(outbound,0,'no remote SQL or network requests');}
});
