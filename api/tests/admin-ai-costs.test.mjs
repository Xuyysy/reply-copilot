import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';

const configId='33333333-3333-4333-8333-333333333333';
const cipher='synthetic-ciphertext-not-a-real-key-'.repeat(2);
const now=Date.UTC(2026,9,30,12);
const today=Date.UTC(2026,9,30),earlier=Date.UTC(2026,9,5),old=Date.UTC(2026,8,30);
function setup(){
 const f=fixture();Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',AI_MODE:'production',DEEPSEEK_API_KEY:'synthetic-legacy-key',AI_CONFIG_ENCRYPTION_KEY:'synthetic-master-key'});
 f.sql.exec("UPDATE users SET role='admin';INSERT INTO site_administrator VALUES(1,'test-user',1)");
 f.sql.prepare("INSERT INTO ai_provider_configs(id,display_name,latest_version,created_at,updated_at,updated_by) VALUES(?,'Multi-version model',3,?,?, 'test-user')").run(configId,now,now);
 for(const [version,provider,model]of [[1,'deepseek','deepseek-flash'],[2,'qwen','qwen3.7-flash'],[3,'gemini','gemini-flash']]){
  f.sql.prepare(`INSERT INTO ai_provider_config_versions(config_id,version,provider,protocol,base_url,model_id,api_key_ciphertext,input_rate_micro_usd_per_million,output_rate_micro_usd_per_million,max_output_tokens,timeout_ms,options_json,endpoint_addresses_json,created_at,created_by)
    VALUES(?,?,?,'openai_chat','https://api.example.test/v1',?,?,300000,1000000,512,10000,'{}','[]',?,'test-user')`).run(configId,version,provider,model,cipher,now);
 }
 return f;
}
async function withFixture(run){const clock=Date.now;Date.now=()=>now;const f=setup();try{await run(f);}finally{Date.now=clock;f.sql.close();}}
const dashboard=f=>f.call('/v1/admin/dashboard',{method:'GET'}).then(r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;});
function usage(f,id,model,at,input,output,cost,version=null){f.sql.prepare(`INSERT INTO ai_usage_costs(user_id,request_id,model,input_tokens,output_tokens,estimated_cost_micro_usd,created_at,provider_config_id,provider_config_version)
 VALUES('test-user',?,?,?,?,?,?,?,?)`).run(id,model,input,output,cost,at,version===null?null:configId,version);}

test('dashboard reads the pinned active version and never returns model keys or ciphertext',()=>withFixture(async f=>{
 f.sql.prepare('UPDATE ai_provider_runtime SET active_config_id=?,active_version=2 WHERE id=1').run(configId);
 const data=await dashboard(f);
 assert.equal(data.aiService.provider,'Qwen');assert.equal(data.aiService.model,'qwen3.7-flash');
 assert.equal(data.aiService.configVersion,2);assert.equal(data.aiService.configurationSource,'managed');assert.equal(data.aiService.keyConfigured,true);
 assert.ok(!JSON.stringify(data).includes(cipher));assert.ok(!JSON.stringify(data).includes(f.env.DEEPSEEK_API_KEY));
 delete f.env.DEEPSEEK_API_KEY;assert.equal((await dashboard(f)).aiService.keyConfigured,true,'managed key status is independent from the legacy key');
 delete f.env.AI_CONFIG_ENCRYPTION_KEY;
 assert.equal((await dashboard(f)).aiService.keyConfigured,false,'legacy key cannot satisfy managed encryption requirements');
}));

test('mixed model history uses immutable config versions, keeps legacy distinct and preserves all-model totals and reservations',()=>withFixture(async f=>{
 f.sql.prepare('UPDATE ai_provider_runtime SET active_config_id=?,active_version=2 WHERE id=1').run(configId);
 usage(f,'legacy','deepseek-flash',today,10,20,100);
 usage(f,'managed-ds','deepseek-flash',earlier,30,40,200,1);
 usage(f,'qwen-today','qwen3.7-flash',today,50,60,300,2);
 usage(f,'qwen-earlier','qwen3.7-flash',earlier,70,80,400,2);
 // Provider failures may retain an estimated label, but the pinned config
 // still identifies the model which incurred the cost. No successful ACK required.
 usage(f,'failed-estimated','unknown-estimated',today,0,0,500,2);
 usage(f,'older-month','deepseek-flash',old,1000,1000,10000);
 f.sql.prepare("INSERT INTO ai_budget_days(budget_day,settled_micro_usd,reserved_micro_usd) VALUES('2026-10-30',950,200)").run();
 f.sql.exec("UPDATE system_settings SET value='1000' WHERE key='daily_cost_limit_micro_usd'");
 const data=await dashboard(f);
 assert.deepEqual(data.cost,{inputTokens:160,outputTokens:200,costMicroUsd:1500});
 assert.deepEqual(data.todayCost,{inputTokens:60,outputTokens:80,costMicroUsd:900});
 assert.equal(data.dailyCostMicroUsd,950,'global settled budget includes costs outside user-generation usage rows');
 assert.equal(data.reservedCostMicroUsd,200);assert.equal(data.circuitOpen,true);assert.equal(data.remainingBudgetMicroUsd,0);
 assert.equal(data.costByModel.length,3);
 const legacy=data.costByModel.find(x=>x.configurationSource==='legacy');
 assert.equal(legacy.provider,'DeepSeek');assert.equal(legacy.model,'deepseek-flash');
 assert.deepEqual(legacy.today,{requests:1,inputTokens:10,outputTokens:20,costMicroUsd:100});
 const qwen=data.costByModel.find(x=>x.provider==='Qwen');
 assert.equal(qwen.model,'qwen3.7-flash','never use the latest Gemini config version');
 assert.deepEqual(qwen.today,{requests:2,inputTokens:50,outputTokens:60,costMicroUsd:800});
 assert.deepEqual(qwen.month,{requests:3,inputTokens:120,outputTokens:140,costMicroUsd:1200});
 assert.equal(data.costByModel.reduce((n,x)=>n+x.month.costMicroUsd,0),data.cost.costMicroUsd);
 assert.equal(data.costByModel.reduce((n,x)=>n+x.today.costMicroUsd,0),data.todayCost.costMicroUsd);
}));

test('empty history, legacy fallback, unconfigured service and mock mode are explicit',()=>withFixture(async f=>{
 const legacy=await dashboard(f);assert.deepEqual(legacy.costByModel,[]);
 assert.equal(legacy.aiService.provider,'DeepSeek');assert.equal(legacy.aiService.configurationSource,'legacy');assert.equal(legacy.aiService.keyConfigured,true);
 delete f.env.DEEPSEEK_API_KEY;assert.equal((await dashboard(f)).aiService.keyConfigured,false);
 delete f.env.AI_MODE;const unconfigured=await dashboard(f);assert.equal(unconfigured.aiService.mode,'unconfigured');assert.equal(unconfigured.aiService.keyConfigured,false);
 f.env.AI_MODE='mock';f.sql.prepare('UPDATE ai_provider_runtime SET active_config_id=?,active_version=2 WHERE id=1').run(configId);
 assert.equal((await dashboard(f)).aiService.provider,'Mock AI');
}));

test('unresolved managed history is not relabeled as legacy or the active provider',()=>withFixture(async f=>{
 usage(f,'unresolved','old-model',today,4,5,6,999);
 const data=await dashboard(f);
 assert.equal(data.costByModel[0].configurationSource,'unresolved');assert.equal(data.costByModel[0].provider,'Unknown');assert.equal(data.costByModel[0].model,'old-model');
 assert.equal(data.cost.costMicroUsd,6);
}));

test('SiliconFlow immutable regional history remains separate even with identical model IDs and after rollback',()=>withFixture(async f=>{
 for(const [version,region]of [[1,'china'],[2,'global'],[3,null]]){
  const options={providerPreset:'siliconflow',...(region?{siliconflowRegion:region}:{}),rateCurrency:'USD'};
  f.sql.prepare("UPDATE ai_provider_config_versions SET provider='openai_compatible',model_id='Qwen/Same-Model',options_json=? WHERE config_id=? AND version=?").run(JSON.stringify(options),configId,version);
 }
 usage(f,'china','Qwen/Same-Model',today,10,20,100,1);
 usage(f,'global','Qwen/Same-Model',today,30,40,200,2);
 usage(f,'old-china','Qwen/Same-Model',earlier,5,6,50,3);
 for(const [version,label]of [[2,'SiliconFlow Global'],[1,'SiliconFlow China']]){
  f.sql.prepare('UPDATE ai_provider_runtime SET active_config_id=?,active_version=? WHERE id=1').run(configId,version);
  const data=await dashboard(f);assert.equal(data.aiService.provider,label);assert.equal(data.costByModel.length,2);
  const cn=data.costByModel.find(x=>x.provider==='SiliconFlow China'),global=data.costByModel.find(x=>x.provider==='SiliconFlow Global');
  assert.equal(cn.month.requests,2);assert.equal(cn.month.costMicroUsd,150);assert.equal(global.month.requests,1);assert.equal(global.month.costMicroUsd,200);assert.equal(data.cost.costMicroUsd,350);
 }
}));
