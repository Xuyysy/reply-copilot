import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fixture} from './helpers/payment-v2.mjs';
import {HostedAIClient} from '../../services/hosted-ai-client.js';
import {parseAIOutput as oldParser} from './fixtures/chrome-0.3.1/utils/output-parser.js';
import {parseAIOutput as published032Parser} from './fixtures/chrome-0.3.2/utils/output-parser.js';
import {parseAIOutput as currentParser} from '../../utils/output-parser.js';

const configId='44444444-4444-4444-8444-444444444444',token='f'.repeat(64);
const output={recommendation:'reply',defaultStyle:'natural',language:'zh',reason:'回应帖子的具体内容。',quoteCandidate:null,replies:{natural:'谢谢分享这个细节。',light_humor:'今天的待办又多了一点灵感🙂',thoughtful:'持续记录，才能看见微小但真实的变化。'}};
function setup(){const f=fixture();Object.assign(f.env,{ENVIRONMENT:'production',AI_MODE:'production',ADMIN_PORTAL_ENABLED:'1',AI_CONFIG_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64'),DEEPSEEK_API_KEY:'legacy-synthetic',DEEPSEEK_INPUT_USD_PER_MILLION:'0.30',DEEPSEEK_OUTPUT_USD_PER_MILLION:'1.32'});f.sql.exec("UPDATE users SET role='admin';INSERT INTO site_administrator VALUES(1,'test-user',1)");f.sql.prepare('INSERT INTO admin_reauth_sessions VALUES(?,?)').run('test-session',Date.now()+900000);f.sql.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES('extension-compat',?,'test-user','extension',1,?)").run(createHash('sha256').update(token).digest('hex'),Date.now()+600000);return f;}
async function configure(f,provider){const r=await f.call('/v1/admin/ai-models',{body:{id:configId,operationId:randomUUID(),reason:'Production compatibility isolated mock test',name:'Compatibility model',provider,protocol:'openai_chat',baseUrl:provider==='qwen'?'https://dashscope-intl.aliyuncs.com/compatible-mode/v1':'https://api.deepseek.com/v1',modelId:provider==='qwen'?'qwen3.7-flash':'deepseek-flash',apiKey:'synthetic-only-key',inputRateUsdPerMillion:0.3,outputRateUsdPerMillion:1.32,maxOutputTokens:512,timeoutMs:10000,options:{}}});assert.equal(r.status,200,JSON.stringify(r.body));f.sql.prepare('UPDATE ai_provider_runtime SET active_config_id=?,active_version=1 WHERE id=1').run(configId);}

for(const provider of ['legacy','deepseek','qwen'])for(const score of [undefined,null,0,91,100])test(`${provider} score=${score}: published 0.3.1/0.3.2 parsers and new client accept response, replay and ACK debit once`,async()=>{
 const f=setup(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url)=>{const u=new URL(String(url));if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:u.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[]});calls++;return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({...output,score})}}],usage:{prompt_tokens:20,completion_tokens:30}});};
 try{
  if(provider!=='legacy')await configure(f,provider);
  const requestId=randomUUID(),input={requestId,sourceText:'真实协议兼容性 Mock 帖文 🙂',sourceUrl:'https://x.com/example/status/123'};
  const client=new HostedAIClient({config:{hostedApiUrl:f.env.API_ORIGIN},accountClient:{request:async(path,options)=>{const r=await f.call(path,{headers:{Cookie:'',Authorization:`Bearer ${token}`},body:options.body});assert.equal(r.status,200,JSON.stringify(r.body));if(path==='/v1/ai/generate'){assert.deepEqual(oldParser(r.body.raw),currentParser(r.body.raw));assert.deepEqual(published032Parser(r.body.raw),currentParser(r.body.raw));assert.equal(Object.hasOwn(JSON.parse(r.body.raw),'score'),score!=null);}return r.body;}}});
  const raw=await client.generateReplies(input);assert.equal(await client.generateReplies(input),raw);assert.equal(calls,1);
  assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts').get().free_balance,199);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM ai_usage_costs').get().n,1);
 }finally{globalThis.fetch=original;f.sql.close();}
});

test('cached score:null is served compatibly without rewriting the stored result or calling a model',async()=>{
 const f=setup(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:20,completion_tokens:30}});};
 try{const requestId=randomUUID(),headers={Cookie:'',Authorization:`Bearer ${token}`},body={requestId,post:{text:'Replay original post.'}};
  assert.equal((await f.call('/v1/ai/generate',{headers,body})).status,200);
  const stored=JSON.stringify({...output,score:null});f.sql.prepare('UPDATE ai_requests SET raw_response=? WHERE request_id=?').run(stored,requestId);
  const replay=await f.call('/v1/ai/generate',{headers,body});assert.equal(replay.status,200);assert.doesNotThrow(()=>oldParser(replay.body.raw));assert.equal(calls,1);
  assert.equal(f.sql.prepare('SELECT raw_response FROM ai_requests WHERE request_id=?').get(requestId).raw_response,stored);
 }finally{globalThis.fetch=original;f.sql.close();}
});

for(const bad of [{score:'91'},{score:-1},{score:101},{language:'invalid'},{reason:''},{replies:{...output.replies,thoughtful:output.replies.natural}}])test('invalid contract is rejected before ACK with costs retained: '+JSON.stringify(bad),async()=>{
 const f=setup(),original=globalThis.fetch;globalThis.fetch=async()=>Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({...output,...bad})}}],usage:{prompt_tokens:20,completion_tokens:30}});
 try{const r=await f.call('/v1/ai/generate',{headers:{Cookie:'',Authorization:`Bearer ${token}`},body:{requestId:randomUUID(),post:{text:'Invalid contract test.'}}});assert.equal(r.status,503);assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts').get().free_balance,200);assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,0);assert.ok(f.sql.prepare('SELECT estimated_cost_micro_usd FROM ai_usage_costs').get().estimated_cost_micro_usd>0);}finally{globalThis.fetch=original;f.sql.close();}
});
