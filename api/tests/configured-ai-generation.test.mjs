import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {fixture} from './helpers/payment-v2.mjs';

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
async function saveModel(f){
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{const parsed=new URL(String(url));if(parsed.hostname!=='cloudflare-dns.com')throw new Error('unexpected_upstream');const answer=parsed.searchParams.get('type')==='A'?[{type:1,data:'8.8.8.8'}]:[];return Response.json({Status:0,Answer:answer});};
 try{
  const response=await f.call('/v1/admin/ai-models',{body:operation({id:configId,name:'Pinned model',provider:'deepseek',protocol:'openai_chat',baseUrl:'https://api.deepseek.com/v1',modelId:'deepseek-chat',apiKey,inputRateUsdPerMillion:0.3,outputRateUsdPerMillion:1.32,maxOutputTokens:512,timeoutMs:10000,options:{}})});
  assert.equal(response.status,200,JSON.stringify(response.body));
 }finally{globalThis.fetch=original;}
 f.sql.prepare('UPDATE ai_provider_runtime SET active_config_id=?,active_version=1 WHERE id=1').run(configId);
}

test('managed AI generation pins its provider version through a switch, charges once, and replays without another call',async()=>{
 const f=setup();await saveModel(f);const requestId=randomUUID(),headers={Cookie:'',Authorization:`Bearer ${extensionToken}`};let switched=false,modelCalls=0;const original=globalThis.fetch;
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
  const pinned=f.sql.prepare('SELECT provider_config_id,provider_config_version,status,generation_phase FROM ai_requests WHERE request_id=?').get(requestId);
  assert.deepEqual({...pinned},{provider_config_id:configId,provider_config_version:1,status:'reserved',generation_phase:'awaiting_delivery'});
  const usage=f.sql.prepare('SELECT provider_config_id,provider_config_version,usage_quality,estimated_cost_micro_usd FROM ai_usage_costs WHERE request_id=?').get(requestId);
  assert.equal(usage.provider_config_id,configId);assert.equal(usage.provider_config_version,1);assert.equal(usage.usage_quality,'verified');assert.ok(usage.estimated_cost_micro_usd>0);
  const ack=await f.call(`/v1/ai/requests/${requestId}/delivered`,{headers,body:{requestId}});assert.equal(ack.status,200,JSON.stringify(ack.body));
  const replay=await f.call('/v1/ai/generate',{headers,body});assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.raw,generated.body.raw);
  assert.equal(modelCalls,1);assert.equal(f.sql.prepare('SELECT free_balance FROM credit_accounts WHERE user_id=?').get('test-user').free_balance,199);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_debit' AND reference_id=?").get(`test-user:${requestId}`).n,1);
 }finally{globalThis.fetch=original;f.sql.close();}
});
