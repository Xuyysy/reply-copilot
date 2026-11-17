import test from 'node:test';
import assert from 'node:assert/strict';
import {localPerformanceDb,measure} from './helpers/d1-performance.mjs';
import {ADMIN_USER_DIRECTORY_SELECT} from '../src/admin-user-directory-queries.js';

// Historical heavy count is used ONLY against isolated synthetic workerd D1.
// It is never a remote inspection query or an operational command.
const BASELINE_SQL = `SELECT u.id,u.username,u.email,u.created_at,
  COALESCE(a.free_balance,0) free_balance,
  COALESCE(a.paid_balance,0) paid_balance,
  (SELECT COUNT(*) FROM ai_requests r WHERE r.user_id=u.id
    AND r.status='succeeded' AND r.consumed=1
    AND r.delivery_confirmation_id IS NOT NULL
    AND r.delivery_confirmation_id<>'' AND r.delivery_confirmed_at IS NOT NULL) generations
FROM users u LEFT JOIN credit_accounts a ON a.user_id=u.id
ORDER BY u.created_at DESC,u.id LIMIT 200`;

test('production-like directory avoids high-cost per-user lifetime scans in isolated D1',{timeout:120000},async()=>{
 const f=await localPerformanceDb(8000);
 try{
   await f.applyIndexes();
   const baseline=await measure(f.db,BASELINE_SQL);
   const optimized=await measure(f.db,ADMIN_USER_DIRECTORY_SELECT+' ORDER BY u.created_at DESC,u.id LIMIT 200');
   assert.deepEqual(optimized.results.map(x=>x.id),baseline.results.map(x=>x.id));
   assert.deepEqual(optimized.results.map(x=>[x.free_balance,x.paid_balance]),
     baseline.results.map(x=>[x.free_balance,x.paid_balance]));
   assert.equal(optimized.results.length,200);
   assert.equal(optimized.rowsWritten,0);
   assert.ok(optimized.results.every(x=>x.generations===null&&x.last_active_at===null));
   assert.ok(optimized.rowsRead*5<baseline.rowsRead,
     JSON.stringify({before:baseline.rowsRead,after:optimized.rowsRead,plan:optimized.plan}));
   assert.ok(!optimized.plan.some(x=>/SCAN (r|ai_requests)|SEARCH (r|ai_requests)/i.test(x)),optimized.plan.join('; '));
   console.log(JSON.stringify({event:'cf_free_admin_directory_local_only',
     syntheticHistoryRows:8000,beforeRowsRead:baseline.rowsRead,afterRowsRead:optimized.rowsRead,
     baselineIsLowerBound:true,explanation:'baseline omits extra last-activity subqueries'}));
 }finally{await f.close();}
});
