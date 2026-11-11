import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {REPLY_LANGUAGES, normalizeReplyLanguage, inferPostLanguageHint} from "../domain/language-support.js";
import {DEFAULT_VOICE_PROFILE, validateVoiceProfile} from "../domain/voice-profile.js";
import {parseAIOutput} from "../utils/output-parser.js";
import {buildPrompts} from "../prompts/prompt-builder.js";

function replyControl(attributes = {}) {
  const node = {
    matches: () => true,
    getAttribute: name => attributes[name] ?? null,
    innerText: attributes.text ?? "",
    textContent: attributes.text ?? "",
    closest: () => node,
  };
  return node;
}
function detector() {
  const sandbox={globalThis:null};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(readFileSync(new URL("../content/reply-detector.js",import.meta.url),"utf8"),sandbox);
  return sandbox.ZaneReplyCopilotContent.replyDetector;
}
function payload(language, replies={natural:"これは自然な返事です。",light_humor:"それはちょっと面白いですね。",thoughtful:"そこは考えさせられますね。" }) {
  return JSON.stringify({recommendation:"reply",defaultStyle:"natural",language,replies,reason:"Natural",quoteCandidate:null});
}

test("X reply button recognizes localized UI safely without changing posting behavior",()=>{
  const d=detector();
  for(const label of ["Reply","回复","回覆","返信","답글","Responder","Répondre","Antworten","Rispondi","Ответить","رد","Balas","Trả lời","ตอบกลับ","Yanıtla","जवाब दें"]){
    assert.equal(d.isReplyControl(replyControl({"aria-label":label})),true,label);
  }
  assert.equal(d.isReplyControl(replyControl({"data-testid":"reply",text:""})),true);
  assert.equal(d.isReplyControl(replyControl({"aria-label":"Reply 123"})),true);
  for(const nonReply of ["Replying to","返信先","返信しました","replies","Reply settings","引用","Like","Share","Edit","返信を表示"]){
    assert.equal(d.isReplyControl(replyControl({"aria-label":nonReply})),false,nonReply);
  }
  assert.equal(d.findReplyControl(replyControl({"aria-label":"返信"}))!==null,true);
  assert.equal(d.isReplyControl({matches:()=>false,getAttribute:()=> "reply"}),false);
});

test("all selectable reply locales survive Voice Profile without affecting UI language",()=>{
  assert.equal(DEFAULT_VOICE_PROFILE.language,"auto");
  assert.deepEqual([...REPLY_LANGUAGES],["auto","zh","en","ja","ko"]);
  for(const language of REPLY_LANGUAGES) {
    assert.equal(validateVoiceProfile({...DEFAULT_VOICE_PROFILE, language}).language,language);
  }
  for(const bad of ["", "xyz", "ja<script>", "en\nignore", "xx", "en-US-US-US-US", 7, null]){
    assert.throws(()=>validateVoiceProfile({...DEFAULT_VOICE_PROFILE,language:bad}),String(bad));
  }
  assert.equal(normalizeReplyLanguage("ja-JP"),"ja-JP");
  assert.equal(normalizeReplyLanguage("ko-KR"),"ko-KR");
  assert.equal(normalizeReplyLanguage("pt-BR"),"pt-BR");
  assert.equal(normalizeReplyLanguage("fr"),"fr");
  assert.equal(normalizeReplyLanguage("zh-Hant-TW"),"zh-Hant-TW");
  assert.equal(normalizeReplyLanguage("xx"),null);
});

test("hosted and extension output contract keeps Japanese, Korean, European and RTL locales",()=>{
  for(const language of ["ja","ja-JP","ko","ko-KR","zh-TW","en-US","es","fr","pt-BR","ru","ar"]){
    assert.equal(parseAIOutput(payload(language)).language,language);
  }
  for(const bad of ["Japanese","jp","ja<script>","xx","",null]){
    assert.throws(()=>parseAIOutput(payload(bad)),String(bad));
  }
  assert.equal(parseAIOutput(payload("auto")).language,"auto");
  assert.equal(parseAIOutput(payload("zh")).language,"zh");
  assert.equal(parseAIOutput(payload("en")).language,"en");
});

test("script detection supplies only high-confidence hints and leaves ambiguous scripts to model",()=>{
  assert.equal(inferPostLanguageHint("明日は東京に行きます。新しい発見が楽しみです"),"ja");
  assert.equal(inferPostLanguageHint("오늘은 정말 좋은 하루였습니다"),"ko");
  assert.equal(inferPostLanguageHint("สวัสดีครับ"),"auto");
  assert.equal(inferPostLanguageHint("مرحبا بالجميع"),"auto");
  assert.equal(inferPostLanguageHint("नमस्ते दुनिया"),"auto");
  assert.equal(inferPostLanguageHint("今日是個好日子"),"auto");
  assert.equal(inferPostLanguageHint("¿Qué opinas de este lanzamiento?"),"auto");
  assert.equal(inferPostLanguageHint("Это очень интересно"),"auto");
});

test("auto prompting follows source post rather than user-interface or saved Chinese examples",()=>{
  const post="今日は日本の開発者コミュニティで面白い議論がありました。";
  const prompts=buildPrompts({postContext:{text:post,url:"https://x.com/test/status/123"},voiceProfile:{...DEFAULT_VOICE_PROFILE,language:"auto",writingSamples:["太牛了哈哈"]},outputSchemaVersion:2});
  assert.match(prompts.system,/Reply in the original post.s language when Chinese/);
  assert.match(prompts.system,/local script hint is ja/);
  assert.match(prompts.system,/all three replies and any quoteCandidate/i);
  assert.match(prompts.system,/Ignore the Chrome UI language and writing samples/i);
  assert.match(prompts.user,/Requested language: auto/);
  assert.ok(prompts.user.includes(post));
  assert.match(prompts.system,/untrusted content/i);
});
test("manual language overrides post, with output language tag encoded for JSON",()=>{
  const prompts=buildPrompts({postContext:{text:"今日は素晴らしい天気です。"},voiceProfile:{...DEFAULT_VOICE_PROFILE,language:"ko"},outputSchemaVersion:2});
  assert.match(prompts.system,/in ko and return that same language tag/i);
  assert.match(prompts.system,/Write all three replies and any quoteCandidate/i);
  assert.match(prompts.user,/Requested language: ko/);
});
test("options and side panel offer the same languages without changing Chinese UI",()=>{
  const options=readFileSync(new URL("../options/options.html",import.meta.url),"utf8");
  const side=readFileSync(new URL("../sidepanel/sidepanel.html",import.meta.url),"utf8");
  for(const [html,id] of [[options,"language"],[side,"quick-language"]]) {
    assert.match(html,/html lang="zh-CN"/);
    const selection=html.match(new RegExp('<select id="'+id+'">([\\s\\S]*?)<\\/select>'));
    assert.ok(selection,id);
    const values=[...selection[1].matchAll(/<option value="([^"]+)"/g)].map(x=>x[1]);
    assert.deepEqual(values,REPLY_LANGUAGES,id+" option order");
    assert.match(selection[1],/自动识别（跟随原帖）/);
  }
});
test("X DOM extraction preserves original Japanese, Korean and mixed-language text",()=>{
  const sandbox={globalThis:null,URL,location:{href:"https://x.com/home"}};sandbox.globalThis=sandbox;
  vm.runInNewContext(readFileSync(new URL("../content/post-extractor.js",import.meta.url),"utf8"),sandbox);
  const extractor=sandbox.ZaneReplyCopilotContent.postExtractor;
  for(const post of ["明日は新しいプロジェクトを公開します！","새 프로젝트를 공개했습니다","日本語とEnglishが混ざっています"]) {
    const article={matches:q=>q==="article",querySelectorAll:q=>q.includes('/status/')?[{href:"https://x.com/example/status/123",closest:()=>article}]:[{innerText:post,closest:()=>article}]};
    const extracted=extractor.extractPost(article);
    assert.equal(extracted.ok,true);
    assert.equal(extracted.sourceText,post);
  }
});


test("speed-first language policy stays small and skips unsupported locales",()=>{
  const prompts=buildPrompts({postContext:{text:"Bonjour"},voiceProfile:DEFAULT_VOICE_PROFILE,outputSchemaVersion:2});
  const policy=prompts.system.split("REPLY LANGUAGE POLICY")[1].split("VOICE PROFILE")[0];
  assert.ok(policy.length < 440,"language policy should stay compact");
  assert.match(policy,/For other languages use English/i);
  assert.ok(!policy.includes("Spanish, French, Portuguese"));
});


test("legacy model language tags remain parseable even when manual menu is small",()=>{
  assert.equal(REPLY_LANGUAGES.includes("fr"),false);
  assert.equal(parseAIOutput(payload("fr")).language,"fr");
  assert.equal(parseAIOutput(payload("pt-BR")).language,"pt-BR");
});

test("old v1 Chrome must never receive ja/ko JSON despite Japanese or Korean posts",()=>{
 for(const post of ["今日は日本語の投稿です","안녕하세요 오늘 한국어 게시물입니다"]){
   const v1=buildPrompts({postContext:{text:post},voiceProfile:DEFAULT_VOICE_PROFILE,outputSchemaVersion:1});
   assert.match(v1.system,/Legacy client output supports zh or en only/i);
   assert.match(v1.system,/Return only zh or en as the JSON language tag/i);
   assert.match(v1.user,/Requested language: auto/);
   assert.doesNotMatch(v1.system,/Automatic reply language: infer zh, en, ja or ko/);
   const v2=buildPrompts({postContext:{text:post},voiceProfile:DEFAULT_VOICE_PROFILE,outputSchemaVersion:2});
   assert.match(v2.system,/Reply in the original post.s language when Chinese/i);
 }
});
test("legacy v1 profile forced to Korean safely falls back to English rather than incompatible labels",()=>{
 const prompts=buildPrompts({postContext:{text:"오늘은 좋은 날"},voiceProfile:{...DEFAULT_VOICE_PROFILE,language:"ko"},outputSchemaVersion:1});
 assert.match(prompts.user,/Requested language: ko/);
 assert.match(prompts.system,/Return only zh or en as the JSON language tag/i);
});
