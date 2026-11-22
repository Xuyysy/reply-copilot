import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPrompts } from '../prompts/prompt-builder.js';
import { buildFastV4Prompts } from '../prompts/prompt-v4-fast.js';
import { buildProductionV55NoCorpusPrompts } from '../prompts/prompt-v5-no-corpus.js';
import { rerankV5DefaultStyle } from '../prompts/reply-v5-quality.js';

test('Production no-corpus contains common V5.5 prompt and exactly one final language reminder',()=>{
 for(const [text,language,expected] of [['今天又加班了','auto','match the original X post language'],['Another AI code bug','auto','en'],['こんにちは','auto','ja'],['코드 오류','auto','ko'],['English original','ja','ja']]){
  for(const recentHistory of [[],[{style:'natural',reply:'Previously selected reply'}]]){
   const a={postContext:{text},voiceProfile:{language,tone:'confident_direct',writingSamples:['Personal style sample'],customInstructions:'Use plain words',replyLength:'short'},recentHistory,outputSchemaVersion:2};
   const actual=buildProductionV55NoCorpusPrompts(a),base=buildFastV4Prompts(a);
   assert.equal(actual.user,base.user);
   assert.equal((actual.user.match(/FINAL REPLY LANGUAGE:/g)||[]).length,1);
   assert.ok(actual.user.includes('FINAL REPLY LANGUAGE: '+expected));
   assert.match(actual.system,/SOCIAL TONE: For the default relaxed_friendly voice/);
   assert.match(actual.system,/Friendliness does not require an agreement preface/);
   assert.match(actual.system,/three genuinely different conversational moves/);
   assert.match(actual.system,/Answer a genuine question directly/);
   assert.ok(actual.system.includes('Personal style sample'));
   assert.equal(actual.system.includes('HISTORY: Recent selected replies'),recentHistory.length>0);
   assert.doesNotMatch(actual.system,/STYLE EXAMPLES:/);
   assert.doesNotMatch(actual.user,/<reply_style_examples_json>/);
   assert.deepEqual(buildProductionV55NoCorpusPrompts({...a,outputSchemaVersion:1}),buildPrompts({...a,outputSchemaVersion:1}));
  }
 }
});
test('Production anti-template filter preserves candidates, score, schema and aliases',()=>{
 const record={recommendation:'reply',defaultStyle:'natural',default_style:'natural',best_reply_style:'natural',language:'zh',replies:{natural:'确实如此',light_humor:'哈哈',thoughtful:'这个项目的发布时间挺关键'},reason:'reply',quoteCandidate:null,score:80};
 const raw=JSON.stringify(record),out=JSON.parse(rerankV5DefaultStyle(raw,{ENVIRONMENT:'production'},2));
 assert.deepEqual(out,{...record,defaultStyle:'thoughtful',default_style:'thoughtful',best_reply_style:'thoughtful'});
 for(const env of ['staging','development'])assert.equal(rerankV5DefaultStyle(raw,{ENVIRONMENT:env},2),raw);
 assert.equal(rerankV5DefaultStyle(raw,{ENVIRONMENT:'production'},1),raw);
 for(const recommendation of ['quote','skip']){const value=JSON.stringify({...record,recommendation});assert.equal(rerankV5DefaultStyle(value,{ENVIRONMENT:'production'},2),value);}
 const clean=JSON.stringify({...record,replies:{...record.replies,natural:'这周才刚上线吧'}});assert.equal(rerankV5DefaultStyle(clean,{ENVIRONMENT:'production'},2),clean);
});
test('Production retains single provider call and canonical validation before preference adjustment',()=>{
 const source=readFileSync(new URL('../api/src/ai.ts',import.meta.url),'utf8');
 assert.equal((source.match(/await executeAiGeneration\(/g)||[]).length,1);
 assert.equal((source.match(/provider: \(\) => configuredModel \?/g)||[]).length,1);
 assert.match(source,/result\.raw = serializeModelOutput\(result\.raw\);\s*result\.raw = rerankV5DefaultStyle\(result\.raw,env,input\.outputSchemaVersion\);/);
 const prompt=readFileSync(new URL('../prompts/prompt-v5-no-corpus.js',import.meta.url),'utf8');
 assert.doesNotMatch(prompt,/REPLY_V5_EXAMPLES|selectReplyV5Examples|reply-v5-examples\.js/);
});
