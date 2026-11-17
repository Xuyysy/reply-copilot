import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';
import {localPerformanceDb,measure,NOW,DAY} from './helpers/d1-performance.mjs';
import {COST_HISTORY_SQL} from '../src/ai-cost-queries.js';

// Historical query is kept only in this isolated regression test; never shipped
// as a production maintenance command or executed against remote D1.
const ORIGINAL_COST_SQL = `WITH attributed AS (
  SELECT CASE WHEN u.provider_config_id IS NOT NULL THEN COALESCE(v.provider,'unknown')
      WHEN u.model='mock' THEN 'mock' ELSE 'deepseek' END providerCode,
    COALESCE(v.model_id,u.model) model,
    CASE WHEN u.provider_config_id IS NULL THEN CASE WHEN u.model='mock' THEN 'mock' ELSE 'legacy' END
      WHEN v.config_id IS NULL THEN 'unresolved' ELSE 'managed' END configurationSource,
    u.created_at,u.input_tokens,u.output_tokens,u.estimated_cost_micro_usd
  FROM ai_usage_costs u LEFT JOIN ai_provider_config_versions v
    ON v.config_id=u.provider_config_id AND v.version=u.provider_config_version
  WHERE u.created_at>=?
) SELECT providerCode,model,configurationSource,COUNT(*) monthRequests,
  SUM(input_tokens) monthInput,SUM(output_tokens) monthOutput,
  SUM(estimated_cost_micro_usd) monthCost,
  SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) todayRequests,
  SUM(CASE WHEN created_at>=? THEN input_tokens ELSE 0 END) todayInput,
  SUM(CASE WHEN created_at>=? THEN output_tokens ELSE 0 END) todayOutput,
  SUM(CASE WHEN created_at>=? THEN estimated_cost_micro_usd ELSE 0 END) todayCost
  FROM attributed GROUP BY providerCode,model,configurationSource
  ORDER BY monthCost DESC,providerCode,model,configurationSource`;

const month=Date.UTC(2026,10,1),today=Date.UTC(2026,10,17);
const args=[month,today,today,today,today];

test('optimized cost aggregation exactly preserves legacy, managed, unresolved, null and UTC-boundary reports',()=>{
 const f=fixture();
 try {
  const id='33333333-3333-4333-8333-333333333333';
  f.sql.prepare("INSERT INTO ai_provider_configs(id,display_name,latest_version,created_at,updated_at,updated_by) VALUES(?,'Synthetic versions',2,1,1,'test-user')").run(id);
  for(const [version,provider,model] of [[1,'qwen','qwen-old'],[2,'gemini','gemini-new']]){
   f.sql.prepare(`INSERT INTO ai_provider_config_versions
    (config_id,version,provider,protocol,base_url,model_id,api_key_ciphertext,input_rate_micro_usd_per_million,output_rate_micro_usd_per_million,max_output_tokens,timeout_ms,options_json,endpoint_addresses_json,created_at,created_by)
    VALUES(?,?,?,'openai_chat','https://example.invalid',?,'synthetic-key-material-not-a-secret-000000000000000000',300000,1000000,512,10000,'{}','[]',1,'test-user')`).run(id,version,provider,model);
  }
  const insert=f.sql.prepare(`INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at,provider_config_id,provider_config_version) VALUES('test-user',?,?,?,?,?,?,?,?)`);
  for(let i=0;i<1200;i++){
   const mode=i%6;
   const assigned=mode===0?null:mode===5?'00000000-0000-4000-8000-000000000001':id;
   const version=mode===1||mode===2?1:mode===5?999:2;
   const at=i%4===0?month-1:i%4===1?month:i%4===2?today:today-1;
   insert.run('cost-'+i,mode===0?'mock':mode===5?'forgotten-model':'synthetic-'+mode,
     i%13===0?0:i%7, i%17===0?0:i%11, i%19===0?0:i%23,at,assigned,assigned?version:null);
  }
  const oldRows=f.sql.prepare(ORIGINAL_COST_SQL).all(...args);
  const newRows=f.sql.prepare(COST_HISTORY_SQL).all(...args);
  assert.deepEqual(newRows,oldRows);
  assert.ok(newRows.some(x=>x.configurationSource==='managed'));
  assert.ok(newRows.some(x=>x.configurationSource==='unresolved'));
  assert.ok(newRows.some(x=>x.configurationSource==='legacy'));
  assert.equal(newRows.reduce((n,x)=>n+x.monthRequests,0),900,'records before month remain excluded');
 } finally {f.sql.close();}
});

test('local workerd D1 rows_read improves with history size; no external calls or live data',{timeout:120000},async()=>{
 const f=await localPerformanceDb(2000);
 try {
  const bound=[NOW-5*DAY,NOW-DAY,NOW-DAY,NOW-DAY,NOW-DAY];
  const baseline=await measure(f.db,ORIGINAL_COST_SQL,bound);
  const improved=await measure(f.db,COST_HISTORY_SQL,bound);
  assert.deepEqual(improved.results,baseline.results);
  assert.equal(improved.rowsWritten,0);
  assert.ok(improved.rowsRead<=baseline.rowsRead,JSON.stringify({
    beforeRowsRead:baseline.rowsRead,afterRowsRead:improved.rowsRead,
    beforePlan:baseline.plan,afterPlan:improved.plan
  }));
  console.log(JSON.stringify({event:'cf_free_ai_cost_local_only',
    rows:2000,beforeRowsRead:baseline.rowsRead,afterRowsRead:improved.rowsRead,
    beforeDurationMs:baseline.durationMs,afterDurationMs:improved.durationMs}));
 } finally {await f.close();}
});
