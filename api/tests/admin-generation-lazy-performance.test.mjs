import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localPerformanceDb,measure,NOW} from './helpers/d1-performance.mjs';
import {ADMIN_EXACT_GENERATIONS_SQL} from '../src/admin-user-directory-queries.js';
import {GENERATION_TOTALS_SQL} from '../src/admin-read-queries.js';

// Fully synthetic local workerd D1; zero external calls or remote SQL.
test('CF Free: exact lifetime/month ACK counters read index history when requested, and routine views skip these queries',{timeout:120000},async()=>{
 const fixture=await localPerformanceDb(8000);
 try{
  const db=fixture.db;
  await fixture.applyIndexes();
  const sql=readFileSync(new URL('../migrations/0021_ai_delivery_statistics_index.sql',import.meta.url),'utf8')
   .replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean);
  for(const statement of sql)await db.prepare(statement).run();
  // Move only isolated synthetic ACK timestamps into the current test month.
  await db.prepare("UPDATE ai_requests SET delivery_confirmed_at=? WHERE status='succeeded'").bind(NOW-1000).run();
  const lifetime=await measure(db,ADMIN_EXACT_GENERATIONS_SQL,['u0']);
  const monthly=await measure(db,GENERATION_TOTALS_SQL,[Date.UTC(2026,10,2),Date.UTC(2026,10,1),NOW]);
  assert.equal(lifetime.results[0].generations,8000);
  assert.equal(monthly.results[0].monthGenerations,8000);
  assert.equal(monthly.results[0].todayGenerations,8000);
  assert.ok(lifetime.rowsRead>=7900,JSON.stringify({lifetimeRead:lifetime.rowsRead}));
  assert.ok(monthly.rowsRead>=7900,JSON.stringify({monthRead:monthly.rowsRead}));
  assert.ok(monthly.plan.some(q=>q.includes('ai_requests_delivered_at_idx')),JSON.stringify(monthly.plan));
  assert.equal(lifetime.rowsWritten,0);
  assert.equal(monthly.rowsWritten,0);
  console.log(JSON.stringify({event:'cf_free_lazy_ack_counts_local_only',syntheticCount:8000,
   explicitLifetimeReads:lifetime.rowsRead,explicitMonthlyReads:monthly.rowsRead,
   routineOverviewLifetimeCountQueries:0,routineOverviewMonthlyCountQueries:0}));
 }finally{await fixture.close();}
});
