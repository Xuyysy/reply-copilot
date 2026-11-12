import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeOutputForClientVersion } from '../api/src/ai-model-provider.js';
const result=language=>JSON.stringify({recommendation:'reply',defaultStyle:'natural',language,replies:{natural:'First draft',light_humor:'Second draft',thoughtful:'Third draft'},reason:'Relevant',quoteCandidate:null});
test('0.3.6/legacy output rejects unsupported language tags before reserving delivery',()=>{
 for(const tag of ['ja','ko','fr','zh-TW','en-US']){
  assert.throws(()=>serializeOutputForClientVersion(result(tag),1),/legacy_reply_language_incompatible/);
  assert.equal(JSON.parse(serializeOutputForClientVersion(result(tag),2)).language,tag,'v2 languages unaffected');
 }
 for(const tag of ['zh','en','auto'])assert.equal(JSON.parse(serializeOutputForClientVersion(result(tag),1)).language,tag);
});
test('legacy output keeps original 3 replies; no extra provider call or translation',()=>{
 const raw=result('en'); const before=JSON.parse(raw);
 const result0=JSON.parse(serializeOutputForClientVersion(raw,1));
 assert.deepEqual(result0.replies,before.replies);
 assert.equal(result0.language,'en');
});
