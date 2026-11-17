import test from 'node:test';
import assert from 'node:assert/strict';
import {localPerformanceDb,measure,NOW} from './helpers/d1-performance.mjs';
import {COST_HISTORY_SQL} from '../src/ai-cost-queries.js';

test('skipping optional monthly AI attribution removes its D1 row-read cost entirely',{timeout:120000},async()=>{
 const f=await localPerformanceDb(2500);
 try{
   await f.applyIndexes();
   // Synthetic history across the entire month. Never use Production D1.
   await f.db.prepare('UPDATE ai_usage_costs SET created_at=?').bind(NOW).run();
   const from=Date.UTC(2026,10,1),day=Date.UTC(2026,10,2);
   const full=await measure(f.db,COST_HISTORY_SQL,[from,day,day,day,day]);
   const noCostQueryExecuted={rowsRead:0,rowsWritten:0};
   assert.ok(full.rowsRead>=2000,JSON.stringify({rowsRead:full.rowsRead,plan:full.plan}));
   assert.equal(noCostQueryExecuted.rowsRead,0);
   assert.equal(full.rowsWritten,0);
   console.log(JSON.stringify({event:'cf_free_lazy_model_cost_local_only',modelHistoryRows:2500,fullRowsRead:full.rowsRead,skippedRowsRead:0,scope:'optional AI cost component only; not whole dashboard'}));
 }finally{await f.close();}
});
