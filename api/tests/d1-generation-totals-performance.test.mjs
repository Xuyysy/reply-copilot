import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {localPerformanceDb,measure,NOW} from './helpers/d1-performance.mjs';
import {GENERATION_TOTALS_SQL} from '../src/admin-read-queries.js';
const oldSql=`SELECT COUNT(*) monthGenerations,COALESCE(SUM(CASE WHEN completed_at>=? THEN 1 ELSE 0 END),0) todayGenerations FROM ai_requests WHERE status='succeeded' AND completed_at>=?`;
const args=[Date.UTC(2026,10,2),Date.UTC(2026,10,1),NOW];
const migration=()=>readFileSync(new URL('../migrations/0021_ai_delivery_statistics_index.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean);
async function writes(db){
 const rows=await db.batch([
  db.prepare("INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at) VALUES('u0','stats-probe','2026-11-02','stats-probe','reserved',0,'hash',?)").bind(NOW),
  db.prepare("UPDATE ai_requests SET status='succeeded',consumed=1,delivery_confirmed_at=?,delivery_confirmation_id='probe' WHERE user_id='u0' AND request_id='stats-probe'").bind(NOW),
  db.prepare("DELETE FROM ai_requests WHERE user_id='u0' AND request_id='stats-probe'")]);
 return {reserve:rows[0].meta.rows_written,ack:rows[1].meta.rows_written,remove:rows[2].meta.rows_written};
}
test('real isolated workerd bounds ACK-time statistics with a partial index, preserves rows and measures write cost',{timeout:120000},async()=>{
 const report={runtime:'isolated Miniflare/workerd D1; synthetic data only',scales:[]};
 for(const size of [2000,20000]){
  const local=await localPerformanceDb(size);try{
   const {db}=local;await local.applyIndexes();
   await db.prepare('UPDATE ai_requests SET completed_at=NULL').run();
   await db.prepare("INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,completed_at,generation_phase) VALUES('u0','pre-ACK-legacy','2026-11-02','legacy-probe','succeeded',1,'hash',?,?,'unknown')").bind(NOW,NOW).run();
   const snapshot=await db.prepare('SELECT * FROM ai_requests ORDER BY user_id,request_id').all();
   const old=await measure(db,oldSql,args.slice(0,2)),before=await measure(db,GENERATION_TOTALS_SQL,args),writesBefore=await writes(db),ddl=[];
   assert.equal(old.results[0].monthGenerations,1,'old predicate misses ACKs and counts pre-ACK legacy instead');
   assert.equal(before.results[0].monthGenerations,200);
   for(const sql of migration()){const r=await db.prepare(sql).run();ddl.push({operation:sql.split(/\s+/).slice(0,3).join(' '),rowsWritten:r.meta.rows_written,sizeBytes:r.meta.size_after});}
   const after=await measure(db,GENERATION_TOTALS_SQL,args),writesAfter=await writes(db);
   assert.deepEqual(after.results,before.results);assert.equal(after.results[0].todayGenerations,200);
   assert.ok(after.plan.some(p=>p.includes('ai_requests_delivered_at_idx')&&p.includes('SEARCH')),JSON.stringify(after.plan));
   assert.ok(after.rowsRead<=205,JSON.stringify(after));assert.ok(before.rowsRead>after.rowsRead*5);
   assert.ok(writesAfter.reserve<=writesBefore.reserve);assert.ok(writesAfter.ack<=writesBefore.ack);
   assert.deepEqual((await db.prepare('SELECT * FROM ai_requests ORDER BY user_id,request_id').all()).results,snapshot.results,'DDL cannot rewrite request history');
   for(const q of [old,before,after]){q.resultRows=q.results.length;q.counts=q.results[0];delete q.results;}
   report.scales.push({history:size,oldIncorrect:old,correctWithoutIndex:before,correctIndexed:after,writesBefore,writesAfter,ddl});
  }finally{await local.close()}
 }
 if(process.env.D1_STATS_PERF_REPORT)writeFileSync(process.env.D1_STATS_PERF_REPORT,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
});
