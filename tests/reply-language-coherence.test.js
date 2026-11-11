import test from "node:test";
import assert from "node:assert/strict";
import { resolveRequiredReplyLanguage, assertReplyLanguageConsistency } from "../domain/reply-language-policy.js";
import { buildPrompts } from "../prompts/prompt-builder.js";
import { DEFAULT_VOICE_PROFILE } from "../domain/voice-profile.js";
import { executeAiGeneration } from "../api/src/ai-generation-flow.js";
const json=(language,natural,light_humor,thoughtful)=>JSON.stringify({
  recommendation:"reply",defaultStyle:"natural",language,
  replies:{natural,light_humor,thoughtful},reason:"Relevant",quoteCandidate:null
});
test("auto routing is strong for English, Japanese and Korean, conservative for Han-only",()=>{
  assert.equal(resolveRequiredReplyLanguage({sourceText:"Shipped an update today."}),"en");
  assert.equal(resolveRequiredReplyLanguage({sourceText:"今日は新作を公開しました"}),"ja");
  assert.equal(resolveRequiredReplyLanguage({sourceText:"오늘 새 앱을 만들었어요"}),"ko");
  assert.equal(resolveRequiredReplyLanguage({sourceText:"今天发布了新版本"}),"auto");
  assert.equal(resolveRequiredReplyLanguage({sourceText:"東京"}),"auto");
  assert.equal(resolveRequiredReplyLanguage({sourceText:"Hello",selectedLanguage:"ko"}),"ko");
});
test("v2 prompt explicitly prioritizes target language over Chinese samples without altering V1 wording",()=>{
  for(const [text,lang] of [["I shipped a new app!","en"],["新しいアプリを公開しました","ja"],["새 앱을 출시했어요","ko"]]){
    const prompt=buildPrompts({postContext:{text},voiceProfile:{...DEFAULT_VOICE_PROFILE,language:"auto",writingSamples:["这太好笑了"]},recentHistory:[{style:"natural",reply:"哈哈真的"}],outputSchemaVersion:2});
    assert.match(prompt.system,/OFFHAND HUMAN REPLY RULES/);
    assert.match(prompt.system,new RegExp("Required reply language: "+lang));
    assert.match(prompt.user,new RegExp("Write every reply in "+lang));
    assert.ok(prompt.user.includes(text));
  }
  const v1=buildPrompts({postContext:{text:"Hello"},voiceProfile:DEFAULT_VOICE_PROFILE,outputSchemaVersion:1});
  assert.ok(!v1.user.includes("FINAL REPLY LANGUAGE"));
});
test("guard accepts legitimate languages and catches wrong labels and Chinese text",()=>{
  const en={sourceText:"Shipped my app today"};
  assert.doesNotThrow(()=>assertReplyLanguageConsistency(json("en","Nice work!","That's fun.","I like this."),en));
  assert.throws(()=>assertReplyLanguageConsistency(json("zh","这太棒了","哈哈太好了","很有意思"),en),/tag_mismatch/);
  assert.throws(()=>assertReplyLanguageConsistency(json("en","这太棒了","哈哈太好了","很有意思"),en),/text_mismatch/);
  const ja={sourceText:"今日は新しいアプリを公開しました"};
  assert.doesNotThrow(()=>assertReplyLanguageConsistency(json("ja","すごいですね","これは面白い","良い方向だと思います"),ja));
  assert.throws(()=>assertReplyLanguageConsistency(json("ja","这也太厉害了","我真的笑了","确实挺好的"),ja),/text_mismatch/);
  const ko={sourceText:"오늘 새 앱을 만들었어요"};
  assert.doesNotThrow(()=>assertReplyLanguageConsistency(json("ko","정말 멋져요","ㅋㅋ 재밌네요","좋은 생각이에요"),ko));
  assert.throws(()=>assertReplyLanguageConsistency(json("ko","太有意思了","这很不错","我支持你"),ko),/text_mismatch/);
  assert.throws(()=>assertReplyLanguageConsistency(json("zh","这很不错","支持一下","真不错"),{sourceText:"Hello",selectedLanguage:"ja"}),/tag_mismatch/);
});
test("invalid language triggers one provider attempt and a refund, not silent paid regeneration",async()=>{
  let calls=0;const settled=[];
  const response=await executeAiGeneration({
    reserve:async()=>({kind:"reserved"}),
    provider:async()=>{calls++;return {raw:json("en","这太棒了","我很喜欢","确实不错"),usage:{model:"test",inputTokens:5,outputTokens:10,costMicroUsd:10}};},
    validate:result=>assertReplyLanguageConsistency(result.raw,{sourceText:"Launching today"}),
    finish:async(raw,usage)=>{settled.push({raw,usage});return true;}
  });
  assert.equal(response.kind,"failed");
  assert.equal(calls,1);
  assert.equal(settled.length,1);
  assert.equal(settled[0].raw,null);
  assert.equal(settled[0].usage.costMicroUsd,10);
});
