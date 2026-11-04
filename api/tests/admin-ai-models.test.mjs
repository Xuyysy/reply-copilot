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

test('connection tests request and parse JSON across DeepSeek, Qwen, Gemini, SiliconFlow and custom-compatible adapters',async()=>{
  const cases=[
    {provider:'deepseek',baseUrl:'https://api.deepseek.com/v1',modelId:'deepseek-chat',jsonMode:true},
    {provider:'qwen',baseUrl:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',modelId:'qwen-plus',jsonMode:true},
    {provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',modelId:'gemini-2.5-flash',jsonMode:false},
    {provider:'siliconflow',baseUrl:'https://api.siliconflow.cn/v1',modelId:'deepseek-ai/DeepSeek-V4-Flash',jsonMode:true},
    {provider:'openai_compatible',baseUrl:'https://api.example.com/v1',modelId:'custom-chat',jsonMode:false,custom:true},
  ];
  for(const item of cases){
    const f=setup(),id=randomUUID(),captured=[];
    const body=modelBody({id,name:`${item.provider} connection`,provider:item.provider,baseUrl:item.baseUrl,modelId:item.modelId,options:item.custom?{customEndpointRiskConfirmed:true}:item.provider==='siliconflow'?{rateCurrency:'USD',chinaRatesConvertedToUsd:true}:{}});
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

for (const region of ['china','global']) test(`SiliconFlow ${region} config is encrypted and activates only after connection and bilingual tests`,async()=>{
  const host=region==='global'?'api.siliconflow.com':'api.siliconflow.cn';
  const f=setup(),id=randomUUID();f.env.AI_MODE='production';
  const body=modelBody({id,name:'SiliconFlow test',provider:'siliconflow',baseUrl:`https://${host}/v1`,modelId:'deepseek-ai/DeepSeek-V4-Flash',options:{thinkingMode:'disabled',jsonMode:true,rateCurrency:'USD',chinaRatesConvertedToUsd:true}});
  try{
    const invalid=await f.call('/v1/admin/ai-models',{body:{...body,operationId:randomUUID(),baseUrl:'https://api.siliconflow.cn.evil.example/v1'}});
    assert.equal(invalid.status,400);assert.equal(invalid.body.code,'INVALID_MODEL_ENDPOINT');
    const saved=await mockProvider(()=>f.call('/v1/admin/ai-models',{body}));
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    const config=f.sql.prepare('SELECT provider,base_url,model_id,options_json,api_key_ciphertext FROM ai_provider_config_versions WHERE config_id=?').get(id);
    assert.equal(config.provider,'openai_compatible');assert.equal(config.base_url,`https://${host}/v1`);
    assert.deepEqual(JSON.parse(config.options_json),{thinkingMode:'disabled',jsonMode:true,providerPreset:'siliconflow',rateCurrency:'USD',chinaRatesConvertedToUsd:true,siliconflowRegion:region});
    assert.ok(!config.api_key_ciphertext.includes(apiKey));
    assert.equal((await f.call('/v1/admin/ai-models',{method:'GET'})).body.configs.find(c=>c.id===id).provider,'siliconflow');
    assert.equal((await f.call('/v1/admin/ai-models/'+id+'/activate',{body:operation()})).status,409);
    const seen=[];
    const original=globalThis.fetch;
    globalThis.fetch=async(url,init={})=>{
      if(new URL(String(url)).hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:new URL(String(url)).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
      seen.push({url:String(url),body:JSON.parse(init.body)});
      const language=init.body.includes('复杂问题')?'zh':'en';
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.parse(init.body).messages[0].content.includes('{"ok":true}')?'{"ok":true}':validOutput(language)}}],usage:{prompt_tokens:20,completion_tokens:30}});
    };
    try{
      for(const kind of ['test-connection','test-generation','test-generation']){
        const language=kind==='test-generation'?(seen.some(x=>x.body.messages[1].content.includes('复杂问题'))?'en':'zh'):undefined;
        const result=await f.call('/v1/admin/ai-models/'+id+'/'+kind,{body:operation({testId:randomUUID(),language})});
        assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.ok,true,JSON.stringify(result.body));
      }
    }finally{globalThis.fetch=original;}
    assert.equal(seen.length,3);
    for(const item of seen){
      assert.equal(item.url,`https://${host}/v1/chat/completions`);
      assert.equal(item.body.enable_thinking,false);
      assert.deepEqual(item.body.response_format,{type:'json_object'});
    }
    assert.equal((await f.call('/v1/admin/ai-models/'+id+'/activate',{body:operation()})).status,200);
    const dashboard=await f.call('/v1/admin/dashboard',{method:'GET'});
    assert.equal(dashboard.body.aiService.provider,region==='global'?'SiliconFlow Global':'SiliconFlow China');
    const snapshot=(await f.call('/v1/admin/ai-models',{method:'GET'})).body;
    assert.equal(snapshot.active.provider,'siliconflow');
    assert.equal((await f.call('/v1/admin/ai-models/rollback',{body:operation()})).status,200);
    const edited=await mockProvider(()=>f.call('/v1/admin/ai-models',{body:{...body,operationId:randomUUID(),apiKey:'',options:{jsonMode:false,rateCurrency:'USD',chinaRatesConvertedToUsd:true}}}));
    assert.equal(edited.status,200,JSON.stringify(edited.body));assert.equal(edited.body.version,2);
    const listed=(await f.call('/v1/admin/ai-models',{method:'GET'})).body;
    assert.equal(listed.active,null);assert.equal(listed.previous.provider,'siliconflow');
    const item=listed.configs.find(c=>c.id===id);assert.equal(item.provider,'siliconflow');assert.equal(item.options.jsonMode,false);assert.equal('thinkingMode' in item.options,false);
    assert.equal(item.keyConfigured,true);assert.ok(!JSON.stringify(listed).includes(apiKey));
    assert.equal((await f.call('/v1/admin/ai-models/'+id+'/activate',{body:operation()})).status,409);
  }finally{f.sql.close();}
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
test('SiliconFlow China and Global keep separate records/keys; region changes never reuse ciphertext',async()=>{
 const f=setup();f.env.AI_MODE='production';const ids=[randomUUID(),randomUUID()];
 const cn=modelBody({id:ids[0],provider:'siliconflow',baseUrl:'https://api.siliconflow.cn/v1',apiKey:'synthetic-china-only',options:{jsonMode:true,thinkingMode:'disabled',rateCurrency:'USD',chinaRatesConvertedToUsd:true}});
 const global=modelBody({id:ids[1],provider:'siliconflow',baseUrl:'https://api.siliconflow.com/v1',apiKey:'synthetic-global-only',options:{jsonMode:false,rateCurrency:'USD'}});
 try{
  for(const body of [cn,global]){const r=await mockProvider(()=>f.call('/v1/admin/ai-models',{body}));assert.equal(r.status,200,JSON.stringify(r.body));}
  const list=(await f.call('/v1/admin/ai-models',{method:'GET'})).body;assert.equal(list.configs.length,2);assert.equal(list.configs.find(c=>c.id===ids[0]).options.siliconflowRegion,'china');assert.equal(list.configs.find(c=>c.id===ids[1]).options.siliconflowRegion,'global');
  const changed=await mockProvider(()=>f.call('/v1/admin/ai-models',{body:{...cn,operationId:randomUUID(),baseUrl:global.baseUrl,apiKey:'',options:global.options}}));assert.equal(changed.status,409);assert.equal(changed.body.code,'MODEL_REGION_CHANGE_REQUIRES_NEW_CONFIG');
  const seen=[],original=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{const u=new URL(String(url));if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});seen.push({url:String(url),authorization:init.headers.authorization});return new Response('Unauthorized',{status:401});};
  try{for(const id of ids){const r=await f.call('/v1/admin/ai-models/'+id+'/test-connection',{body:operation({testId:randomUUID()})});assert.equal(r.status,200);assert.equal(r.body.ok,false);assert.equal(r.body.errorCategory,'authentication_error');}}finally{globalThis.fetch=original;}
  assert.deepEqual(seen,[{url:'https://api.siliconflow.cn/v1/chat/completions',authorization:'Bearer synthetic-china-only'},{url:'https://api.siliconflow.com/v1/chat/completions',authorization:'Bearer synthetic-global-only'}]);
  const badCurrency=await mockProvider(()=>f.call('/v1/admin/ai-models',{body:{...cn,id:randomUUID(),operationId:randomUUID(),options:{rateCurrency:'CNY'}}}));assert.equal(badCurrency.status,400);assert.equal(badCurrency.body.code,'MODEL_RATE_CURRENCY_INVALID');
  const unconverted=await mockProvider(()=>f.call('/v1/admin/ai-models',{body:{...cn,id:randomUUID(),operationId:randomUUID(),options:{rateCurrency:'USD'}}}));assert.equal(unconverted.status,400);assert.equal(unconverted.body.code,'MODEL_RATE_CONVERSION_REQUIRED');
 }finally{f.sql.close();}
});
