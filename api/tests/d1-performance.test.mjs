import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {localPerformanceDb,measure,measureIndexWrites,NOW,DAY} from './helpers/d1-performance.mjs';
import {auditPage,auditOptions,runCreditAudit} from '../scripts/lib/credit-audit.mjs';
import {LOGIN_USER_SQL,RECENT_LEDGER_SQL,USER_USAGE_SQL,GENERATION_TOTALS_SQL} from '../src/admin-read-queries.js';

// Historical bad queries are confined to this synthetic fixture, never shipped
// as a maintenance command or executed against a remote database.
const oldMissingAllocation=`SELECT COUNT(*) missing FROM ai_requests r WHERE r.status='succeeded' AND NOT EXISTS(SELECT 1 FROM ai_credit_allocations a WHERE a.request_id=r.request_id AND a.state='consumed')`;
const oldMissingCost=`SELECT COUNT(*) missing FROM ai_requests r WHERE r.status='succeeded' AND NOT EXISTS(SELECT 1 FROM ai_usage_costs c WHERE c.request_id=r.request_id)`;
const oldReconcile=`SELECT COUNT(*) missing FROM ai_requests r WHERE r.status='succeeded' AND NOT EXISTS(SELECT 1 FROM ai_credit_allocations a WHERE a.request_id=r.request_id AND a.state='consumed' AND EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='generation_debit' AND instr(l.reference_id,r.request_id)>0))`;
const defaultQueries={
 login:{sql:LOGIN_USER_SQL,beforeSql:'SELECT id,password_hash,status FROM users WHERE email=? OR username=? LIMIT 1',args:['absent@example.test','absent@example.test']},
 ledger:{sql:RECENT_LEDGER_SQL,args:[]},
 userDetail:{sql:USER_USAGE_SQL,args:['u0']},
 generationTotals:{sql:GENERATION_TOTALS_SQL,args:[Date.UTC(2026,10,2),Date.UTC(2026,10,1),NOW]},
 costs:{sql:'SELECT SUM(input_tokens) inputTokens,SUM(output_tokens) outputTokens,SUM(estimated_cost_micro_usd) cost FROM ai_usage_costs WHERE created_at>=?',args:[Date.UTC(2026,10,1)]},
 users:{sql:'SELECT id FROM users ORDER BY created_at DESC,id LIMIT 200',args:[]},
 orders:{sql:'SELECT id FROM recharge_orders ORDER BY created_at DESC LIMIT 200',args:[]},
 audits:{sql:'SELECT id FROM admin_audit_logs ORDER BY created_at DESC LIMIT 10',args:[]},
};

test('isolated workerd reports bounded audit reads, full-key plan, and measured index benefits as history grows',{timeout:120000},async()=>{
 const report={runtime:'local Miniflare/workerd D1, synthetic full0019 schema; no remote SQL',scales:[]};
 for(const size of [2000,8000,20000]){
  const local=await localPerformanceDb(size);try{
   const {db}=local,item={recordsPerHistoryTable:size,before:{},after:{},unsafeHistorical:{}};
   for(const [name,q]of Object.entries(defaultQueries))item.before[name]=await measure(db,q.beforeSql||q.sql,q.args);
   // Limit the intentionally expensive reference to8000; the improved path is
   // additionally checked at20000. Large-scale old queries are never needed.
   if(size<=8000)for(const [name,sql]of Object.entries({allocations:oldMissingAllocation,costs:oldMissingCost,reconcile:oldReconcile}))item.unsafeHistorical[name]=await measure(db,sql);
   const plan=auditOptions({limit:200,pages:2},NOW),query=auditPage(plan);
   item.audit=await measure(db,query.sql,query.args);
   const audit=await runCreditAudit(db,{limit:200,pages:2},NOW);
   assert.equal(audit.counts.checked,200);assert.equal(audit.counts.missingAllocations+audit.counts.missingCosts+audit.counts.missingDebits,0);
   assert.ok(audit.metrics.rowsRead<5000,JSON.stringify(audit.metrics));
   assert.ok(item.audit.plan.filter(p=>/ai_credit_allocations|ai_usage_costs|credit_ledger/.test(p)).every(p=>!/SCAN /.test(p)),item.audit.plan.join('\n'));
   item.sameWindow={};
   for(const [name,sql]of Object.entries({allocations:oldMissingAllocation,costs:oldMissingCost})){
    const bounded=sql.replace("WHERE r.status='succeeded'","WHERE r.created_at>=? AND r.created_at<? AND r.status='succeeded'");
    const result=await measure(db,bounded,[NOW-DAY,NOW]);assert.equal(result.results[0].missing,0);
    result.resultRows=result.results.length;delete result.results;item.sameWindow[name]=result;
   }
   item.writesBefore=await measureIndexWrites(db);
   item.indexBuild=await local.applyIndexes();
   item.writesAfter=await measureIndexWrites(db);
   for(const [name,q]of Object.entries(defaultQueries)){
    const result=item.after[name]=await measure(db,q.sql,q.args);
    assert.deepEqual(result.results,item.before[name].results,'results changed: '+name);
    assert.ok(result.rowsRead<=item.before[name].rowsRead,'reads increased: '+name);
   }
   assert.ok(item.after.login.rowsRead<=5,JSON.stringify(item.after.login));
   assert.ok(item.after.ledger.rowsRead<500);
   assert.ok(item.after.costs.rowsRead<1000);
   assert.ok(item.after.userDetail.rowsRead<500);
   // Keep exported evidence aggregate-only; the test data identities and rows
   // do not belong in operational reports.
   for(const group of [item.before,item.after,item.unsafeHistorical])for(const q of Object.values(group)){q.resultRows=q.results.length;delete q.results;}
   item.audit.resultRows=item.audit.results.length;delete item.audit.results;
   report.scales.push(item);
  }finally{await local.close()}
 }
 const small=report.scales[0],large=report.scales[1];
 assert.ok(large.unsafeHistorical.allocations.rowsRead>small.unsafeHistorical.allocations.rowsRead*10,'reference should expose superlinear request-only lookup');
 assert.ok(large.audit.rowsRead<small.audit.rowsRead*2,'bounded full-key audit should not grow with unrelated history');
 if(process.env.D1_PERF_REPORT)writeFileSync(process.env.D1_PERF_REPORT,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.scales.map(s=>({records:s.recordsPerHistoryTable,auditRowsRead:s.audit.rowsRead,oldAllocationReads:s.unsafeHistorical.allocations?.rowsRead,indexedLedgerReads:s.after.ledger.rowsRead}))));
});
