import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setupSyntheticWorkerd} from '../scripts/cf-free-workerd-cpu.mjs';
import {normalizeAiInput} from '../src/ai-input.js';
import {buildProductionV55NoCorpusPrompts} from '../../prompts/prompt-v5-no-corpus.js';
import {parseAIOutput} from '../../utils/output-parser.js';
const API='https://isolated-api.example.test',EXT='chrome-extension://'+'a'.repeat(32);
const headers={Origin:EXT,Authorization:'Bearer '+'e'.repeat(64),'Content-Type':'application/json'};
const output={recommendation:'reply',defaultStyle:'natural',language:'zh',reason:'A real detail.',replies:{natural:'确实如此',light_humor:'这下有点意思了',thoughtful:'这个项目的发布时间挺关键'},quoteCandidate:null};
const hash=s=>createHash('sha256').update(s).digest('hex');
for(const source of ['free','paid','subscription'])for(const productionProvider of ['legacy','managed']){
 test('Production V5.5 actual workerd HTTP + D1 + intercepted '+productionProvider+' '+source,{timeout:120000},async()=>{
  let calls=0,invalid=false,expectedPrompt=null;
  const f=await setupSyntheticWorkerd({source,productionProvider,assertionMode:process.env.CF_FREE_LAB_BASELINE==='1'?'legacy':'select',expiryIndex:process.env.CF_FREE_LAB_BASELINE==='1'?'full':'partial',measureBatches:true,syntheticUpstream:payload=>{
   calls++;
   assert.deepEqual(payload.messages,[{role:'system',content:expectedPrompt.system},{role:'user',content:expectedPrompt.user}]);
   assert.match(payload.messages[0].content,/SOCIAL TONE:/);
   const result=invalid?{...output,replies:{natural:'same',light_humor:'same',thoughtful:'different'}}:output;
   return Response.json({model:'synthetic-provider',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:40,completion_tokens:30}});
  }});
  try{
   const post={text:'今天发布了一个新项目，具体来说是中文测试。',url:'https://x.com/example/status/123'};
   const body={requestId:randomUUID(),post,outputSchemaVersion:2,voiceProfile:{language:'auto',tone:'relaxed_friendly',writingSamples:['自然一点']},recentHistory:[{style:'natural',reply:'上次的回复'}]};
   const normalized=normalizeAiInput(body);
   expectedPrompt=buildProductionV55NoCorpusPrompts({postContext:normalized.post,voiceProfile:normalized.profile,recentHistory:normalized.history,styleStats:normalized.styleStats,replyStyle:normalized.replyStyle,outputSchemaVersion:2});
   const request=async(path,b)=>{const start=performance.now();const r=await f.mf.dispatchFetch(API+path,{method:'POST',headers,body:JSON.stringify(b)});const data=await r.json();return {status:r.status,data,wall:performance.now()-start,metrics:JSON.parse(r.headers.get('X-CF-Free-Local-Batch')||'null')};};
   const generate=()=>request('/v1/ai/generate',body);
   const ack=()=>request('/v1/ai/requests/'+body.requestId+'/delivered',{requestId:body.requestId});
   const first=await generate();assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(calls,1);
   const parsed=parseAIOutput(first.data.raw);assert.equal(parsed.defaultStyle,'thoughtful');assert.deepEqual(parsed.replies,output.replies);assert.equal(Object.hasOwn(JSON.parse(first.data.raw),'score'),false);
   assert.equal(first.data.quota===undefined,source==='subscription');
   const replay=await generate();assert.equal(replay.status,200);assert.equal(replay.data.raw,first.data.raw);assert.equal(calls,1);
   const delivery=await ack();assert.equal(delivery.status,200,JSON.stringify(delivery.data));assert.equal((await ack()).data.alreadyConfirmed,true);
   const after=await generate();assert.equal(after.status,200);assert.equal(after.data.raw,first.data.raw);assert.equal(calls,1);
   invalid=true;const failed=await request('/v1/ai/generate',{...body,requestId:randomUUID()});assert.equal(failed.status,503);assert.equal(calls,2);
   const account=await f.db.prepare('SELECT free_balance,paid_balance,free_generation_reserved,paid_generation_reserved FROM credit_accounts WHERE user_id=?').bind('benchmark-main-user').first();
   assert.deepEqual(account,{free_balance:source==='free'?199:source==='paid'?0:200,paid_balance:source==='paid'?199:0,free_generation_reserved:0,paid_generation_reserved:0});
   const daily=await f.db.prepare('SELECT COALESCE(SUM(used),0) used,COALESCE(SUM(reserved),0) reserved FROM subscription_daily_usage').first();
   assert.deepEqual(daily,{used:source==='subscription'?1:0,reserved:0});
   const usage=await f.db.prepare('SELECT count(*) n,sum(estimated_cost_micro_usd) cost FROM ai_usage_costs').first();assert.equal(usage.n,2);assert.ok(usage.cost>0);
   assert.equal((await f.db.prepare('SELECT COALESCE(SUM(reserved_micro_usd),0) n FROM ai_budget_days').first()).n,0);
   assert.equal(f.getExternalCalls(),0);
   console.log('CF_FREE_PRODUCTION_V55_LOCAL '+JSON.stringify({source,productionProvider,scope:'LOCAL_WORKERD_ONLY',freeCertified:false,syntheticModelCalls:calls,unexpectedOutbound:0,promptHash:hash(expectedPrompt.system+'\0'+expectedPrompt.user),outputHash:hash(first.data.raw),account,daily,usage,wallMs:{generate:first.wall,replay:replay.wall,ack:delivery.wall,confirmedReplay:after.wall},calls:{generate:first.metrics,replay:replay.metrics,ack:delivery.metrics,confirmedReplay:after.metrics}}));
  }finally{await f.mf.dispose();}
 });
}
