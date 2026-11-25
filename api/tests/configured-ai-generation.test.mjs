import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {fixture,worker} from './helpers/payment-v2.mjs';
import {HostedAIClient} from '../../services/hosted-ai-client.js';
import {parseAIOutput} from '../../utils/output-parser.js';

const configId='22222222-2222-4222-8222-222222222222';
const apiKey='test-only';
const extensionToken='e'.repeat(64);
const output=JSON.stringify({recommendation:'reply',defaultStyle:'natural',language:'auto',reason:'A concise response.',replies:{natural:'First distinct reply.',light_humor:'A playful second reply.',thoughtful:'A reflective third reply.'},quoteCandidate:null});

function operation(extra={}){return {operationId:randomUUID(),reason:'Staging managed model integration test',...extra};}
function setup(){
 const f=fixture();Object.assign(f.env,{AI_MODE:'production',ADMIN_PORTAL_ENABLED:'1',AI_CONFIG_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),DEEPSEEK_API_KEY:'legacy-test'});
 f.sql.exec("UPDATE users SET role='admin'");f.sql.exec("INSERT INTO site_administrator VALUES(1,'test-user',1)");
 f.sql.prepare('INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES(?,?)').run('test-session',Date.now()+900000);
 f.sql.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES('extension-ai-session',?,'test-user','extension',1,?)").run(createHash('sha256').update(extensionToken).digest('hex'),Date.now()+600000);
 return f;
}
async function saveModel(f, overrides={}){
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{const parsed=new URL(String(url));if(parsed.hostname!=='cloudflare-dns.com')throw new Error('unexpected_upstream');const answer=parsed.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[];return Response.json({Status:0,Answer:answer});};
 try{
  const response=await f.call('/v1/admin/ai-models',{body:operation({id:configId,name:'Pinned model',provider:'deepseek',protocol:'openai_chat',baseUrl:'https://api.deepseek.com/v1',modelId:'deepseek-chat',apiKey,inputRateUsdPerMillion:0.3,outputRateUsdPerMillion:1.32,maxOutputTokens:512,timeoutMs:10000,options:{},...overrides})});
  assert.equal(response.status,200,JSON.stringify(response.body));
 }finally{globalThis.fetch=original;}
 f.sql.prepare('UPDATE ai_provider_runtime SET active_config_id=?,active_version=1 WHERE id=1').run(configId);
}

test('managed AI generation pins its provider version through a switch, charges once, and replays without another call',async()=>{
 const f=setup();await saveModel(f);const requestId=randomUUID(),headers={Cookie:'',Authorization:`Bearer ${extensionToken}`};let switched=false,modelCalls=0;const original=globalThis.fetch;
 const providerReads=[];const prepare=f.env.DB.prepare.bind(f.env.DB);
 f.env.DB.prepare=sql=>{if(/^\s*SELECT\b/i.test(sql)&&/\bFROM ai_provider_(?:runtime|configs)\b/i.test(sql))providerReads.push(sql);return prepare(sql);};
 globalThis.fetch=async(url,init={})=>{
  const parsed=new URL(String(url));
  if(parsed.hostname==='cloudflare-dns.com'){
   // Emulate the administrator changing the active model only after this
   // request has reserved and snapshotted its original provider version.
   if(!switched){switched=true;f.sql.exec('UPDATE ai_provider_runtime SET active_config_id=NULL,active_version=NULL');}
   const answer=parsed.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[];return Response.json({Status:0,Answer:answer});
  }
  assert.equal(parsed.hostname,'api.deepseek.com');assert.equal(new Headers(init.headers).get('authorization'),`Bearer ${apiKey}`);modelCalls++;
  return Response.json({model:'provider-model-label-is-ignored',choices:[{finish_reason:'stop',message:{content:output}}],usage:{prompt_tokens:30,completion_tokens:45}});
 };
 try{
  const body={requestId,post:{text:'A representative public post for the Staging model test.',url:'https://x.com/example/status/123'}};
  const generated=await f.call('/v1/ai/generate',{headers,body});assert.equal(generated.status,200,JSON.stringify(generated.body));assert.equal(modelCalls,1);assert.equal(switched,true);
  assert.equal(providerReads.length,1,'active provider resolution uses one D1 statement');
  assert.match(providerReads[0],/LEFT JOIN ai_provider_config_versions/);
  assert.equal(generated.body.performance,undefined,'diagnostics are absent by default');
  const pinned=f.sql.prepare('SELECT provider_config_id,provider_config_version,status,generation_phase FROM ai_requests WHERE request_id=?').get(requestId);
  assert.deepEqual({...pinned},{provider_config_id:configId,provider_config_version:1,status:'reserved',generation_phase:'awaiting_delivery'});
  const usage=f.sql.prepare('SELECT provider_config_id,provider_config_version,usage_quality,estimated_cost_micro_usd FROM ai_usage_costs WHERE request_id=?').get(requestId);
  assert.equal(usage.provider_config_id,configId);assert.equal(usage.provider_config_version,1);assert.equal(usage.usage_quality,'verified');assert.ok(usage.estimated_cost_micro_usd>0);
  const ack=await f.call(`/v1/ai/requests/${requestId}/delivered`,{headers,body:{requestId}});assert.equal(ack.status,200,JSON.stringify(ack.body));
  const replay=await f.call('/v1/ai/generate',{headers,body});assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.raw,generated.body.raw);
  assert.equal(modelCalls,1);assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts WHERE user_id=?').get('test-user').free_balance,199);
  assert.equal(providerReads.length,1,'replay does not resolve provider again');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_debit' AND reference_id=?").get(`test-user:${requestId}`).n,1);
 }finally{globalThis.fetch=original;f.sql.close();}
});

test('Qwen without score survives backend normalization, plugin parsing and duplicate delivery ACK with one debit',async()=>{
 const f=setup();f.env.AI_PERFORMANCE_DIAGNOSTICS='1';const original=globalThis.fetch;let modelCalls=0,acks=0;
 const trace=globalThis.ReplyCopilotPerformance.createTrace({enabled:true});
 try{
  await saveModel(f,{provider:'qwen',baseUrl:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',modelId:'qwen3.7-flash'});
  globalThis.fetch=async(url)=>{
   const parsed=new URL(String(url));
   if(parsed.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:parsed.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});
   assert.equal(parsed.hostname,'dashscope-intl.aliyuncs.com');modelCalls++;
   assert.equal(Object.hasOwn(JSON.parse(output),'score'),false);
   return Response.json({choices:[{finish_reason:'stop',message:{content:output}}],usage:{prompt_tokens:30,completion_tokens:45}});
  };
  const requestId=randomUUID();
  const client=new HostedAIClient({config:{hostedApiUrl:f.env.API_ORIGIN},accountClient:{request:async(path,options)=>{
   const result=await f.call(path,{body:options.body,headers:{Cookie:'',Authorization:`Bearer ${extensionToken}`}});
   assert.equal(result.status,200,JSON.stringify(result.body));
   if(path==='/v1/ai/generate'){
    assert.equal(Object.hasOwn(JSON.parse(result.body.raw),'score'),false);
    const timing=result.body.performance;
    assert.equal(timing.outcome,'success');assert.ok(timing.durations.worker_total>=0);
    if(!acks)for(const key of ['worker_prepare','worker_reserve','worker_finish','dns','model'])assert.ok(timing.durations[key]>=0,key);
    assert.equal(/test-only|test-user|api_key|sourceText/.test(JSON.stringify(timing)),false);
    assert.deepEqual(parseAIOutput(result.body.raw),parseAIOutput(JSON.stringify(parseAIOutput(result.body.raw))));
   }else{acks++;}
   return result.body;
  }}});
  const input={requestId,sourceText:'A public post. 中文 🙂\nSecond line.',sourceUrl:'https://x.com/example/status/123'};
  const raw=await client.generateReplies({...input,performanceTrace:trace});
  assert.equal(await client.generateReplies({...input,performanceTrace:trace}),raw);
  assert.ok(trace.snapshot().durations.ack>=0);assert.ok(trace.snapshot().durations.dns>=0);
  assert.equal(acks,2);assert.equal(modelCalls,1);
  const row=f.sql.prepare('SELECT status,generation_phase,consumed,delivery_confirmed_at FROM ai_requests WHERE request_id=?').get(requestId);
  assert.equal(row.status,'succeeded');assert.equal(row.consumed,1);assert.ok(row.delivery_confirmed_at);
  assert.equal(f.sql.prepare('SELECT free_balance,free_generation_reserved FROM credit_accounts').get().free_balance,199);
  assert.equal(f.sql.prepare('SELECT free_generation_reserved FROM credit_accounts').get().free_generation_reserved,0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_debit' AND reference_id=?").get(`test-user:${requestId}`).n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_usage_costs WHERE request_id=?').get(requestId).n,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM ai_credit_allocations WHERE request_id=? AND state='consumed'").get(requestId).n,1);
 }finally{globalThis.fetch=original;f.sql.close();}
});

test('unacknowledged normalized Qwen output expires and releases only its reservation while preserving provider cost',async()=>{
 const f=setup();const original=globalThis.fetch;
 try{
  await saveModel(f,{provider:'qwen',baseUrl:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',modelId:'qwen3.7-flash'});
  globalThis.fetch=async(url)=>new URL(String(url)).hostname==='cloudflare-dns.com'
   ?Response.json({Status:0,Answer:new URL(String(url)).searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]})
   :Response.json({choices:[{finish_reason:'stop',message:{content:output}}],usage:{prompt_tokens:30,completion_tokens:45}});
  const requestId=randomUUID(),headers={Cookie:'',Authorization:`Bearer ${extensionToken}`};
  const result=await f.call('/v1/ai/generate',{headers,body:{requestId,post:{text:'Expired delivery sample.'}}});
  assert.equal(result.status,200,JSON.stringify(result.body));
  const cost=f.sql.prepare('SELECT estimated_cost_micro_usd FROM ai_usage_costs WHERE request_id=?').get(requestId).estimated_cost_micro_usd;
  assert.ok(cost>0);
  f.sql.prepare('UPDATE ai_requests SET response_expires_at=? WHERE request_id=?').run(Date.now()-1,requestId);
  await worker.scheduled({},f.env);await worker.scheduled({},f.env);
  const row=f.sql.prepare('SELECT status,consumed,raw_response FROM ai_requests WHERE request_id=?').get(requestId);
  assert.equal(row.status,'upstream_failed');assert.equal(row.consumed,0);assert.equal(row.raw_response,null);
  assert.deepEqual({...f.sql.prepare('SELECT free_balance,free_generation_reserved FROM credit_accounts').get()},{free_balance:200,free_generation_reserved:0});
  assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_release' AND reference_id=?").get(`test-user:${requestId}`).n,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,0);
  assert.equal(f.sql.prepare('SELECT estimated_cost_micro_usd FROM ai_usage_costs WHERE request_id=?').get(requestId).estimated_cost_micro_usd,cost);
  const ack=await f.call(`/v1/ai/requests/${requestId}/delivered`,{headers,body:{requestId}});
  assert.equal(ack.status,409);
 }finally{globalThis.fetch=original;f.sql.close();}
});
