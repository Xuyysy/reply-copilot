import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {localPerformanceDb,measure,NOW,DAY} from './helpers/d1-performance.mjs';
import {COST_HISTORY_SQL} from '../src/ai-cost-queries.js';
import {fixture} from './helpers/payment-v2.mjs';
const beforeSql=readFileSync(new URL('./fixtures/model-cost-before.sql',import.meta.url),'utf8');
test('empty history and exact UTC month/day boundaries preserve cost results',()=>{
 const f=fixture();try{
  const month=Date.UTC(2026,10,1),day=Date.UTC(2026,10,3),args=[month,day,day,day,day];
  assert.deepEqual(f.sql.prepare(COST_HISTORY_SQL).all(...args),[]);
  for(const [i,time]of [month-1,month,day-1,day].entries())f.sql.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) VALUES('test-user',?,'legacy',10,5,50,?)").run('boundary-'+i,time);
  const result=f.sql.prepare(COST_HISTORY_SQL).all(...args);
  assert.deepEqual(result,f.sql.prepare(beforeSql).all(...args));
  assert.equal(result.length,1);assert.equal(result[0].monthRequests,3);assert.equal(result[0].todayRequests,1);assert.equal(result[0].monthCost,150);assert.equal(result[0].todayCost,50);
 }finally{f.sql.close()}
});
test('aggregate immutable cost versions before attribution: identical totals with bounded configuration joins',{timeout:120000},async()=>{
 const report=[];
 for(const size of [2000,20000]){
  const l=await localPerformanceDb(size);try{
   const {db}=l;await l.applyIndexes();
   await db.prepare("INSERT INTO ai_provider_configs(id,display_name,latest_version,created_at,updated_at,updated_by) VALUES('managed','Managed',2,1,1,'u0')").run();
   for(const version of [1,2])await db.prepare("INSERT INTO ai_provider_config_versions(config_id,version,provider,protocol,base_url,model_id,api_key_ciphertext,input_rate_micro_usd_per_million,output_rate_micro_usd_per_million,max_output_tokens,timeout_ms,options_json,endpoint_addresses_json,created_at,created_by) VALUES('managed',?,'qwen','openai_chat','https://example.test','managed-model',?,1,2,512,3000,'{}','[]',1,'u0')").bind(version,'x'.repeat(40)).run();
   // Include zero usage with nonzero estimated cost, shared model aliases, two config versions, unresolved
   // references, mock and legacy attribution; no credential is selected.
   // Managed models dominate the representative fixture; all legacy classes
   // are still present. This is a labelled workload assumption, not live data.
   await db.prepare("UPDATE ai_usage_costs SET provider_config_id=CASE WHEN CAST(substr(request_id,2) AS INT)%10<7 THEN 'managed' WHEN CAST(substr(request_id,2) AS INT)%10=7 THEN 'missing' ELSE NULL END,provider_config_version=CASE WHEN CAST(substr(request_id,2) AS INT)%2=0 THEN 1 ELSE 2 END,model=CASE WHEN CAST(substr(request_id,2) AS INT)%10=9 THEN 'mock' ELSE 'upstream-alias' END").run();
   await db.prepare("INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at) VALUES('u0','zero-usage','legacy',0,0,5,?)").bind(NOW).run();
   const args=[NOW-10*DAY,NOW-DAY,NOW-DAY,NOW-DAY,NOW-DAY],old=await measure(db,beforeSql,args),candidate=await measure(db,COST_HISTORY_SQL,args);
   assert.deepEqual(candidate.results,old.results,'cost and historical attribution must remain exact');
   assert.ok(candidate.rowsRead<old.rowsRead*.8,JSON.stringify({old:old.rowsRead,candidate:candidate.rowsRead}));
   assert.equal(candidate.rowsWritten,0);
   report.push({size,old:{...old,results:undefined},candidate:{...candidate,results:undefined}});
  }finally{await l.close()}
 }
 if(process.env.FREE_COST_REPORT)writeFileSync(process.env.FREE_COST_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report.map(x=>({size:x.size,before:x.old.rowsRead,after:x.candidate.rowsRead}))));
});
