import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {normalizeAiInput} from "../api/src/ai-input.js";
import {HostedAIClient} from "../services/hosted-ai-client.js";
import {buildPrompts} from "../prompts/prompt-builder.js";
import {DEFAULT_VOICE_PROFILE} from "../domain/voice-profile.js";
import {parseAIOutput} from "../utils/output-parser.js";

const requestId="12345678-1234-4234-8234-123456789abc";
const source={requestId,post:{text:"今日は良い天気です",url:"https://x.com/author/status/123"},voiceProfile:DEFAULT_VOICE_PROFILE,recentHistory:[],styleStats:{},replyStyle:"natural-friendly"};
const sha=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("legacy requests retain EXACT hash and shape regardless of missing or explicit v1 field",()=>{
 const implicit=normalizeAiInput({...source});
 const explicit=normalizeAiInput({...source,outputSchemaVersion:1});
 assert.deepEqual(implicit,explicit);
 assert.equal("outputSchemaVersion" in implicit,false,"adding a new v1 key would break idempotent replay on existing requests");
 assert.equal(sha(implicit),sha(explicit));
 for(const bad of [0,"2",3,null]) assert.deepEqual(normalizeAiInput({...source,outputSchemaVersion:bad}),implicit);
 const modern=normalizeAiInput({...source,outputSchemaVersion:2});
 assert.equal(modern.outputSchemaVersion,2);
 assert.notEqual(sha(modern),sha(implicit));
});
test("Production prompt preserves old extension zh/en while opt-in v2 supports ja/ko",()=>{
 for(const language of ["auto","ja","ko"]){
  const postContext={text:"今日は日本語で話します"};
  const profile={...DEFAULT_VOICE_PROFILE,language};
  const v1=buildPrompts({postContext,voiceProfile:profile,outputSchemaVersion:1});
  const v2=buildPrompts({postContext,voiceProfile:profile,outputSchemaVersion:2});
  assert.match(v1.system,/only in Chinese \(zh\) or English \(en\)/);
  assert.match(v1.system,/never ja\/ko\/other tags/);
  assert.match(v2.system,/Write all three replies|Automatic reply language/);
  assert.match(v2.system,/OFFHAND HUMAN REPLY RULES/);
 }
});
test("new Production Chrome sends schema 2 and ACKs Japanese text using same request ID",async()=>{
 const raw=JSON.stringify({recommendation:"reply",defaultStyle:"natural",language:"ja",reason:"Relevant",quoteCandidate:null,replies:{natural:"いいですね",light_humor:"これは面白い",thoughtful:"そういう視点もありますね"}});
 const requests=[];
 const client=new HostedAIClient({config:{hostedApiUrl:"https://api.x-reply-helper.top",requestTimeoutMs:30000},accountClient:{request:async(path,options)=>{requests.push({path,options});return path.includes("/delivered")?{ok:true,quota:{totalRemaining:4}}:{raw};}}});
 const out=await client.generateReplies({sourceText:source.post.text,sourceUrl:source.post.url,voiceProfile:{...DEFAULT_VOICE_PROFILE,language:"ja"},requestId,recentHistory:[],styleStats:{}});
 assert.equal(parseAIOutput(out).language,"ja");
 assert.deepEqual(requests.map(x=>x.path),["/v1/ai/generate",`/v1/ai/requests/${requestId}/delivered`]);
 assert.equal(requests[0].options.body.outputSchemaVersion,2);
 assert.equal(requests[0].options.body.requestId,requestId);
 assert.equal(requests[1].options.body.requestId,requestId);
 assert.equal(client.lastQuota.totalRemaining,4);
});
