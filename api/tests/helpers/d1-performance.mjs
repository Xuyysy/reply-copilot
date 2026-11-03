import {Miniflare} from 'miniflare';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
const migrationRoot=new URL('../../migrations/',import.meta.url);
export const NOW=Date.UTC(2026,10,2,12),DAY=86400000;
export async function localPerformanceDb(size){
 let outbound=0;
 const mf=new Miniflare({workers:[{config:{name:'isolated-d1-performance',compatibilityDate:'2026-10-14',env:{DB:{type:'d1',id:'synthetic-performance-db'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("isolated")}}'}}}},dev:{outboundService:{type:'fetcher',handler:()=>{outbound++;throw Error('No external access permitted')}}}}]});
 try{
  const db=await mf.getD1Database('DB'),schema=new DatabaseSync(':memory:');
  for(const name of readdirSync(migrationRoot).filter(x=>x.endsWith('.sql')&&x<'0020').sort())schema.exec(readFileSync(new URL(name,migrationRoot),'utf8'));
  const ddl=schema.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index') ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name").all();
  for(const row of ddl)await db.prepare(row.sql).run();schema.close();
  await db.prepare(`WITH RECURSIVE seq(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM seq WHERE i+1<${size})
   INSERT INTO users(id,email,email_verified_at,created_at,username) SELECT 'u'||i,'person'||i||'@example.test',1,${NOW}-i*1000,'Person_'||i FROM seq`).run();
  await db.prepare("INSERT INTO recharge_packages(id,name_zh,name_en,credits,price_cents,sort_order,updated_at) VALUES('starter','测试','Test',400,100,1,0)").run();
  await db.prepare(`INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,consumed_credits,granted_at,history_confidence,status) VALUES('batch','u0','free','signup',${size},0,${size},1,'tracked','active')`).run();
  const seq=`WITH RECURSIVE seq(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM seq WHERE i+1<${size})`;
  const time=`CASE WHEN i<${size}-200 THEN ${NOW-3*DAY}-(${size}-i)*1000 ELSE ${NOW}-(${size}-i)*1000 END`;
  await db.prepare(`${seq} INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at,completed_at,generation_phase,delivery_confirmed_at,delivery_confirmation_id)
    SELECT 'u0','r'||i,'2026-11-02','nonce'||i,'succeeded',1,'hash',${time},${time},'awaiting_delivery',${time},'ack'||i FROM seq`).run();
  await db.prepare(`${seq} INSERT INTO ai_credit_allocations(id,user_id,request_id,credit_batch_id,state,created_at,consumed_at) SELECT 'allocation'||i,'u0','r'||i,'batch','consumed',${time},${time} FROM seq`).run();
  await db.prepare(`${seq} INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) SELECT 'ledger'||i,'u0','generation_debit',-1,0,'u0:r'||i,${time} FROM seq`).run();
  await db.prepare(`${seq} INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) SELECT 'u0','r'||i,'mock',1,2,3,${time} FROM seq`).run();
  await db.prepare(`${seq} INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) SELECT 'order'||i,'u0','starter','Test',400,100,'USD','pending',${time} FROM seq`).run();
  await db.prepare(`${seq} INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,created_at) SELECT 'audit'||i,'u0','synthetic','test','local performance fixture',${time} FROM seq`).run();
  return {db,applyIndexes:async()=>{const evidence=[];for(const sql of readFileSync(new URL('0020_d1_read_indexes.sql',migrationRoot),'utf8').replace(/--[^\n]*/g,'').split(';').map(x=>x.trim()).filter(Boolean)){const result=await db.prepare(sql).run();evidence.push({index:sql.match(/CREATE INDEX (\w+)/)[1],rowsWritten:result.meta.rows_written,sizeBytes:result.meta.size_after});}return evidence;},async close(){await mf.dispose();if(outbound)throw Error('Unexpected external request')}};
 }catch(error){await mf.dispose();throw error}
}
export async function measure(db,sql,args=[]){
 const plan=await db.prepare('EXPLAIN QUERY PLAN '+sql).bind(...args).all();
 const start=performance.now(),result=await db.prepare(sql).bind(...args).all();
 return {plan:plan.results.map(r=>r.detail),rowsRead:result.meta.rows_read,rowsWritten:result.meta.rows_written,durationMs:result.meta.duration,sizeBytes:result.meta.size_after,wallMs:Math.round((performance.now()-start)*100)/100,results:result.results};
}

// Actual index-maintenance writes reported by the same local D1 runtime.
// Each probe is inserted and removed atomically; no remote/real data exists.
export async function measureIndexWrites(db){
 const probes={
  users:["INSERT INTO users(id,email,email_verified_at,created_at,username) VALUES('write-probe','write@example.test',1,1,'write_probe')","DELETE FROM users WHERE id='write-probe'"],
  requests:["INSERT INTO ai_requests(user_id,request_id,quota_date,reservation_nonce,status,consumed,request_hash,created_at) VALUES('u0','write-probe','2026-11-02','write-probe','reserved',0,'hash',1)","DELETE FROM ai_requests WHERE user_id='u0' AND request_id='write-probe'"],
  costs:["INSERT INTO ai_usage_costs(user_id,request_id,model,created_at) VALUES('u0','write-probe','mock',1)","DELETE FROM ai_usage_costs WHERE user_id='u0' AND request_id='write-probe'"],
  ledger:["INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,created_at) VALUES('write-probe','u0','generation_debit',-1,0,'u0:write-probe',1)","DELETE FROM credit_ledger WHERE id='write-probe'"],
  orders:["INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,created_at) VALUES('write-probe','u0','starter','Test',400,100,'USD','pending',1)","DELETE FROM recharge_orders WHERE id='write-probe'"],
  audits:["INSERT INTO admin_audit_logs(id,actor_user_id,action,target_id,reason,created_at) VALUES('write-probe','u0','synthetic','test','local-only',1)","DELETE FROM admin_audit_logs WHERE id='write-probe'"]
 };
 const result={};for(const [table,[insert,remove]]of Object.entries(probes)){
  const measured=await db.batch([db.prepare(insert),db.prepare(remove)]);result[table]={insertRowsWritten:measured[0].meta.rows_written,deleteRowsWritten:measured[1].meta.rows_written};
 }return result;
}
