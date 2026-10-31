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
    if(init.body&&JSON.parse(init.body).messages?.[0]?.content.includes('{"ok":true}')){
      await new Promise(resolve=>setTimeout(resolve,15));
      return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{prompt_tokens:3,completion_tokens:1}});
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
  const f=setup();f.env.AI_MODE='production';f.env.DEEPSEEK_API_KEY='synthetic-legacy-key';
  const metrics=()=>f.call('/v1/admin/dashboard',{method:'GET'}).then(r=>r.body);
  assert.equal((await metrics()).aiService.provider,'DeepSeek');
  await mockProvider(()=>f.call('/v1/admin/ai-models',{body:modelBody({provider:'qwen',baseUrl:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',modelId:'qwen3.7-flash'})}));
  const testGeneration=language=>f.call(`/v1/admin/ai-models/${modelId}/test-generation`,{body:operation({testId:randomUUID(),language})});
  const denied=await f.call(`/v1/admin/ai-models/${modelId}/activate`,{body:operation()});assert.equal(denied.status,409);
  const connection=await mockProvider(()=>f.call(`/v1/admin/ai-models/${modelId}/test-connection`,{body:operation({testId:randomUUID()})}));
  const zh=await mockProvider(()=>testGeneration('zh'));
  const en=await mockProvider(()=>testGeneration('en'));
  assert.equal(connection.body.ok,true);assert.equal(zh.body.jsonValid,true);assert.equal(en.body.jsonValid,true);
  const active=await f.call(`/v1/admin/ai-models/${modelId}/activate`,{body:operation()});assert.equal(active.status,200);
  assert.equal(f.sql.prepare('SELECT active_config_id FROM ai_provider_runtime WHERE id=1').get().active_config_id,modelId);
  const activeMetrics=await metrics();assert.equal(activeMetrics.aiService.provider,'Qwen');assert.equal(activeMetrics.aiService.model,'qwen3.7-flash');assert.equal(activeMetrics.aiService.keyConfigured,true);
  const rollback=await f.call('/v1/admin/ai-models/rollback',{body:operation()});assert.equal(rollback.body.legacyFallback,true);
  assert.equal(f.sql.prepare('SELECT active_config_id FROM ai_provider_runtime WHERE id=1').get().active_config_id,null);
  const rolledBackMetrics=await metrics();assert.equal(rolledBackMetrics.aiService.provider,'DeepSeek');assert.equal(rolledBackMetrics.aiService.model,'deepseek-flash');assert.equal(rolledBackMetrics.aiService.keyConfigured,true);
  assert.equal(rolledBackMetrics.dailyCostMicroUsd,activeMetrics.dailyCostMicroUsd);assert.deepEqual(rolledBackMetrics.cost,activeMetrics.cost);
  const settled=f.sql.prepare('SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days').get();assert.equal(settled.reserved_micro_usd,0);assert.ok(settled.settled_micro_usd>0);
});

test('Chinese and English model tests send distinct real post text and preserve the full reply contract',async()=>{
  const f=setup();
  await mockProvider(()=>f.call('/v1/admin/ai-models',{body:modelBody()}));
  const requests=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const parsed=new URL(String(url));
    if(parsed.hostname==='cloudflare-dns.com'){
      const answer=parsed.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[];
      return Response.json({Status:0,Answer:answer});
    }
    const body=JSON.parse(init.body);requests.push(body);
    const isChinese=body.messages[1].content.includes('今天把复杂问题拆成小步骤，终于推进了一点。');
    return Response.json({choices:[{finish_reason:'stop',message:{content:validOutput(isChinese?'zh':'en')}}],usage:{prompt_tokens:20,completion_tokens:30}});
  };
  try{
    const zh=await f.call(`/v1/admin/ai-models/${modelId}/test-generation`,{body:operation({testId:randomUUID(),language:'zh'})});
    const en=await f.call(`/v1/admin/ai-models/${modelId}/test-generation`,{body:operation({testId:randomUUID(),language:'en'})});
    assert.equal(zh.body.ok,true,JSON.stringify(zh.body));assert.equal(en.body.ok,true,JSON.stringify(en.body));
    assert.equal(requests.length,2);
    const zhUser=requests[0].messages[1].content,enUser=requests[1].messages[1].content;
    assert.match(zhUser,/今天把复杂问题拆成小步骤，终于推进了一点。/);
    assert.match(enUser,/I finally made progress by breaking a complicated problem into smaller steps today\./);
    assert.notEqual(zhUser,enUser);
    for(const body of requests){
      const system=body.messages[0].content;
      for(const field of ['"recommendation"','"defaultStyle"','"language"','"replies"','"reason"','"quoteCandidate"']) assert.ok(system.includes(field),`missing full contract field ${field}`);
      for(const style of ['"natural"','"light_humor"','"thoughtful"']) assert.ok(system.includes(style),`missing reply style ${style}`);
      assert.deepEqual(body.response_format,{type:'json_object'});
    }
    assert.equal(zh.body.jsonValid,true);assert.equal(en.body.jsonValid,true);
  }finally{globalThis.fetch=original;f.sql.close();}
});

test('connection tests request and parse JSON across DeepSeek, Qwen, Gemini and custom-compatible adapters',async()=>{
  const cases=[
    {provider:'deepseek',baseUrl:'https://api.deepseek.com/v1',modelId:'deepseek-chat',jsonMode:true},
    {provider:'qwen',baseUrl:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',modelId:'qwen-plus',jsonMode:true},
    {provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',modelId:'gemini-2.5-flash',jsonMode:false},
    {provider:'openai_compatible',baseUrl:'https://api.example.com/v1',modelId:'custom-chat',jsonMode:false,custom:true},
  ];
  for(const item of cases){
    const f=setup(),id=randomUUID(),captured=[];
    const body=modelBody({id,name:`${item.provider} connection`,provider:item.provider,baseUrl:item.baseUrl,modelId:item.modelId,options:item.custom?{customEndpointRiskConfirmed:true}:{}});
    const original=globalThis.fetch;
    globalThis.fetch=async(url,init={})=>{
      const parsed=new URL(String(url));
      if(parsed.hostname==='cloudflare-dns.com'){
        const answer=parsed.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[];
        return Response.json({Status:0,Answer:answer});
      }
      const request=JSON.parse(init.body);captured.push(request);
      return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'} }],usage:{prompt_tokens:8,completion_tokens:4}});
    };
    try{
      const saved=await f.call('/v1/admin/ai-models',{body});assert.equal(saved.status,200,`${item.provider}: ${JSON.stringify(saved.body)}`);
      const checked=await f.call(`/v1/admin/ai-models/${id}/test-connection`,{body:operation({testId:randomUUID()})});
      assert.equal(checked.status,200,`${item.provider}: ${JSON.stringify(checked.body)}`);
      assert.equal(checked.body.ok,true,item.provider);assert.equal(checked.body.jsonValid,true,item.provider);
      assert.equal(captured.length,1,item.provider);
      const prompt=`${captured[0].messages[0].content}\n${captured[0].messages[1].content}`;
      assert.match(prompt,/JSON/i,item.provider);assert.match(prompt,/\{"ok":true\}/,item.provider);
      assert.equal(Boolean(captured[0].response_format),item.jsonMode,item.provider);
      assert.equal(captured[0].max_tokens<=32,true,item.provider);
    }finally{globalThis.fetch=original;f.sql.close();}
  }
});

test('connection tests reject plain OK text, false status and extra JSON fields',async()=>{
  for(const content of ['OK','{"ok":false}','{"ok":true,"extra":true}','prefix {"ok":true}']){
    const f=setup();await mockProvider(()=>f.call('/v1/admin/ai-models',{body:modelBody()}));const original=globalThis.fetch;
    globalThis.fetch=async(url,init={})=>{
      const parsed=new URL(String(url));
      if(parsed.hostname==='cloudflare-dns.com'){
        const answer=parsed.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[];
        return Response.json({Status:0,Answer:answer});
      }
      return Response.json({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:8,completion_tokens:4}});
    };
    try{
      const result=await f.call(`/v1/admin/ai-models/${modelId}/test-connection`,{body:operation({testId:randomUUID()})});
      assert.equal(result.status,200);assert.equal(result.body.ok,false,content);assert.equal(result.body.jsonValid,false,content);assert.equal(result.body.errorCategory,'connection_check_failed',content);
    }finally{globalThis.fetch=original;f.sql.close();}
  }
});

test('admin can run more than ten daily model tests without a separate $0.05/day ceiling, while global AI budget still applies', async()=>{
  const f=setup();
  try {
    const created=await mockProvider(()=>f.call('/v1/admin/ai-models',{body:modelBody()}));
    assert.equal(created.status,200,JSON.stringify(created.body));
    const day=new Date().toISOString().slice(0,10);
    f.sql.prepare('INSERT INTO ai_provider_test_budget_days(budget_day,calls,reserved_micro_usd,settled_micro_usd) VALUES(?,10,0,50000)').run(day);
    const total=await mockProvider(async upstreamCount=>{
      for(let i=0;i<12;i++){
        const result=await f.call(`/v1/admin/ai-models/${modelId}/test-connection`,{body:operation({testId:randomUUID()})});
        assert.equal(result.status,200,`iteration ${i+1}: ${JSON.stringify(result.body)}`);
        assert.equal(result.body.ok,true);
      }
      return upstreamCount();
    });
    assert.equal(total,12);
    const tracked=f.sql.prepare('SELECT calls,reserved_micro_usd,settled_micro_usd FROM ai_provider_test_budget_days WHERE budget_day=?').get(day);
    assert.equal(tracked.calls,22);
    assert.equal(tracked.reserved_micro_usd,0);
    assert.ok(tracked.settled_micro_usd>50000);
    // All test spending remains reserved against the *shared* daily budget.
    f.sql.prepare("UPDATE system_settings SET value='1' WHERE key='daily_cost_limit_micro_usd'").run();
    const denied=await f.call(`/v1/admin/ai-models/${modelId}/test-connection`,{body:operation({testId:randomUUID()})});
    assert.equal(denied.status,429);
    assert.equal(denied.body.code,'MODEL_TEST_BUDGET_EXHAUSTED');
  } finally { f.sql.close(); }
});
