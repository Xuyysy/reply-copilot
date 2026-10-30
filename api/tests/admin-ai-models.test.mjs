import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers/payment-v2.mjs';

const modelId='11111111-1111-4111-8111-111111111111';
const apiKey='synthetic-provider-test-key-never-real';
function setup(){
  const f=fixture();f.env.ADMIN_PORTAL_ENABLED='1';f.env.AI_CONFIG_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
  f.sql.exec("UPDATE users SET role='admin'");f.sql.exec("INSERT INTO site_administrator VALUES(1,'test-user',1)");
  f.sql.prepare('INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES(?,?)').run('test-session',Date.now()+900000);
  return f;
}
function operation(extra={}){return {operationId:randomUUID(),reason:'Staging 模型管理安全测试操作',...extra};}
const modelBody=(extra={})=>operation({id:modelId,name:'DeepSeek test',provider:'deepseek',protocol:'openai_chat',baseUrl:'https://api.deepseek.com/v1',modelId:'deepseek-chat',apiKey,inputRateUsdPerMillion:0.3,outputRateUsdPerMillion:1.32,maxOutputTokens:512,timeoutMs:10000,options:{},...extra});
const validOutput=language=>JSON.stringify({recommendation:'reply',defaultStyle:'natural',language,reason:'A concise response.',replies:{natural:'First distinct reply.',light_humor:'A playful second reply.',thoughtful:'A reflective third reply.'},quoteCandidate:null});
async function mockProvider(run){
  const original=globalThis.fetch;let upstreamCalls=0;
  globalThis.fetch=async(url,init={})=>{
    const parsed=new URL(String(url));
    if(parsed.hostname==='cloudflare-dns.com'){
      const answer=parsed.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[];
      return new Response(JSON.stringify({Status:0,Answer:answer}),{headers:{'content-type':'application/dns-json'}});
    }
    upstreamCalls++;
    if(init.body&&JSON.parse(init.body).messages?.[0]?.content==='Reply exactly with the word OK.'){
      await new Promise(resolve=>setTimeout(resolve,15));
      return Response.json({choices:[{finish_reason:'stop',message:{content:'OK'}}],usage:{prompt_tokens:3,completion_tokens:1}});
    }
    const body=JSON.parse(init.body);const language=body.messages[1].content.includes('复杂问题')?'zh':'en';
    await new Promise(resolve=>setTimeout(resolve,15));
    return Response.json({choices:[{finish_reason:'stop',message:{content:validOutput(language)}}],usage:{prompt_tokens:20,completion_tokens:30}});
  };
  try{return await run(()=>upstreamCalls);}finally{globalThis.fetch=original;}
}

test('model API key is encrypted and absent from API responses and audit records; admin and CSRF gates apply',async()=>{
  const f=setup();
  assert.equal((await f.call('/v1/admin/ai-models',{method:'GET',headers:{Cookie:''}})).status,401);
  const response=await mockProvider(()=>f.call('/v1/admin/ai-models',{body:modelBody()}));
  assert.equal(response.status,200);assert.equal(response.body.keyConfigured,true);
  const cipher=f.sql.prepare('SELECT api_key_ciphertext FROM ai_provider_config_versions WHERE config_id=?').get(modelId).api_key_ciphertext;
  assert.ok(cipher!==apiKey&&!cipher.includes(apiKey));
  const persisted=JSON.stringify(f.sql.prepare('SELECT * FROM admin_audit_logs').all())+JSON.stringify(f.sql.prepare('SELECT * FROM admin_operations').all());
  assert.ok(!persisted.includes(apiKey));
  const listed=await f.call('/v1/admin/ai-models',{method:'GET'});assert.equal(listed.status,200);
  const publicJson=JSON.stringify(listed.body);assert.ok(!publicJson.includes(apiKey)&&!publicJson.includes(cipher));
  f.sql.exec("UPDATE users SET role='user'");
  assert.equal((await f.call('/v1/admin/ai-models',{method:'GET'})).status,403);
  f.sql.exec("UPDATE users SET role='admin'");
  const noCsrf=await f.call('/v1/admin/ai-models',{body:modelBody({id:modelId,apiKey:undefined}),headers:{'X-CSRF-Token':''}});
  assert.equal(noCsrf.status,403);
});

test('concurrent duplicate provider test IDs make one budget claim and one upstream request',async()=>{
  const f=setup();await mockProvider(()=>f.call('/v1/admin/ai-models',{body:modelBody()}));
  const testId=randomUUID();
  const [a,b]=await mockProvider(async count=>{
    const body=()=>operation({testId});
    const results=await Promise.all([
      f.call(`/v1/admin/ai-models/${modelId}/test-connection`,{body:body()}),
      f.call(`/v1/admin/ai-models/${modelId}/test-connection`,{body:body()}),
    ]);
    return {results,count:count()};
  }).then(({results,count})=>[results,count]);
  assert.equal(a.length,2,JSON.stringify(a));assert.equal(a.filter(x=>x.status===200).length,1,JSON.stringify(a));assert.equal(a.filter(x=>x.status===409).length,1,JSON.stringify(a));
  assert.equal(b,1);
  const budget=f.sql.prepare('SELECT calls,reserved_micro_usd,settled_micro_usd FROM ai_provider_test_budget_days').get();
  assert.equal(budget.calls,1);assert.equal(budget.reserved_micro_usd,0);assert.ok(budget.settled_micro_usd>0);
});

test('verified Chinese and English generation tests are required before activation and rollback restores legacy',async()=>{
  const f=setup();await mockProvider(()=>f.call('/v1/admin/ai-models',{body:modelBody()}));
  const testGeneration=language=>f.call(`/v1/admin/ai-models/${modelId}/test-generation`,{body:operation({testId:randomUUID(),language})});
  const denied=await f.call(`/v1/admin/ai-models/${modelId}/activate`,{body:operation()});assert.equal(denied.status,409);
  const connection=await mockProvider(()=>f.call(`/v1/admin/ai-models/${modelId}/test-connection`,{body:operation({testId:randomUUID()})}));
  const zh=await mockProvider(()=>testGeneration('zh'));
  const en=await mockProvider(()=>testGeneration('en'));
  assert.equal(connection.body.ok,true);assert.equal(zh.body.jsonValid,true);assert.equal(en.body.jsonValid,true);
  const active=await f.call(`/v1/admin/ai-models/${modelId}/activate`,{body:operation()});assert.equal(active.status,200);
  assert.equal(f.sql.prepare('SELECT active_config_id FROM ai_provider_runtime WHERE id=1').get().active_config_id,modelId);
  const rollback=await f.call('/v1/admin/ai-models/rollback',{body:operation()});assert.equal(rollback.body.legacyFallback,true);
  assert.equal(f.sql.prepare('SELECT active_config_id FROM ai_provider_runtime WHERE id=1').get().active_config_id,null);
  const settled=f.sql.prepare('SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days').get();assert.equal(settled.reserved_micro_usd,0);assert.ok(settled.settled_micro_usd>0);
});
