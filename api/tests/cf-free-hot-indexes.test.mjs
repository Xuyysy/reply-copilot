import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const sql = readFileSync(fileURLToPath(new URL('../../api/sql-proposals/0032_cf_free_hot_query_indexes.sql', import.meta.url)), 'utf8');
function fixture() {
 const db = new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE ai_requests(user_id TEXT,request_id TEXT,status TEXT,consumed INTEGER,delivery_confirmation_id TEXT,delivery_confirmed_at INTEGER,created_at INTEGER);
 CREATE INDEX ai_requests_status_idx ON ai_requests(user_id,status,created_at);
 CREATE INDEX ai_requests_delivered_at_idx ON ai_requests(status,delivery_confirmed_at) WHERE status='succeeded' AND consumed=1 AND delivery_confirmation_id IS NOT NULL AND delivery_confirmation_id<>'';
 CREATE TABLE subscription_usage_events(id TEXT,period_id TEXT,day_index INTEGER,event_type TEXT,created_at INTEGER);
 CREATE INDEX subscription_usage_events_period_idx ON subscription_usage_events(period_id,day_index,created_at DESC);`);
 db.exec('BEGIN');
 const r = db.prepare('INSERT INTO ai_requests VALUES(?,?,?,?,?,?,?)');
 const e = db.prepare('INSERT INTO subscription_usage_events VALUES(?,?,?,?,?)');
 for (let i = 0; i < 12000; i++) {
  const isSuccess = i%3!==0, delivered = isSuccess && i%7!==0;
  r.run(i<9000?'heavy':`u${i%800}`,`r${i}`,isSuccess?'succeeded':'upstream_failed',delivered?1:0,delivered?`ack${i}`:null,delivered?1_000_000+i:null,1_000_000+i);
  e.run(`e${i}`,`p${i%100}`,i%30,i%5===0?'reserve':'consume',1_000_000+i);
 }
 db.exec('COMMIT');
 return db;
}
const countSql = `SELECT COUNT(*) generations FROM ai_requests r WHERE r.user_id=? AND r.status='succeeded' AND r.consumed=1 AND r.delivery_confirmation_id IS NOT NULL AND r.delivery_confirmation_id<>'' AND r.delivery_confirmed_at IS NOT NULL`;
const eventsSql = `SELECT e.id,e.created_at FROM subscription_usage_events e WHERE e.created_at>=? AND e.created_at<? AND e.event_type<>'reserve' ORDER BY e.created_at DESC,e.id DESC LIMIT ?`;
const plan=(db,query,args)=>db.prepare('EXPLAIN QUERY PLAN '+query).all(...args).map(x=>x.detail).join(' | ');
test('candidate indexes preserve exact ACK count and event cursor/order, and SQLite chooses both indexes',()=>{
 const db=fixture();
 try {
  const countBefore=db.prepare(countSql).get('heavy');
  const eventsBefore=db.prepare(eventsSql).all(1_000_000,1_020_000,51);
  const oldEventPlan=plan(db,eventsSql,[1_000_000,1_020_000,51]);
  assert.match(oldEventPlan,/SCAN e/);
  assert.equal((sql.match(/CREATE INDEX /g)||[]).length,2);
  assert.doesNotMatch(sql,/\b(?:DROP|DELETE|UPDATE|INSERT|ALTER|TRIGGER)\b/);
  db.exec(sql);
  assert.deepEqual(db.prepare(countSql).get('heavy'),countBefore);
  assert.deepEqual(db.prepare(eventsSql).all(1_000_000,1_020_000,51),eventsBefore);
  assert.match(plan(db,countSql,['heavy']),/cf_free_ai_delivered_user_count_idx/);
  assert.match(plan(db,eventsSql,[1_000_000,1_020_000,51]),/cf_free_subscription_events_recent_idx/);
  assert.ok(eventsBefore.every(row=>!row.id.endsWith('0')&&!row.id.endsWith('5')));
 } finally {db.close();}
});
