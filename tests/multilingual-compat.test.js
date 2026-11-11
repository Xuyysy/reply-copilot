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
  for(const language of REPLY_LANGUAGES) {
    assert.equal(validateVoiceProfile({...DEFAULT_VOICE_PROFILE, language}).language,language);
  }
  for(const bad of ["", "xyz", "ja<script>", "en\nignore", "xx", "en-US-US-US-US", 7, null]){
    assert.throws(()=>validateVoiceProfile({...DEFAULT_VOICE_PROFILE,language:bad}),String(bad));
  }
  assert.equal(normalizeReplyLanguage("ja-JP"),"ja-JP");
  assert.equal(normalizeReplyLanguage("PT-br"),"pt-BR");
  assert.equal(normalizeReplyLanguage("zh-Hant-TW"),"zh-Hant-TW");
  assert.equal(normalizeReplyLanguage("xx"),null);
});

test("hosted and extension output contract keeps Japanese, Korean, European and RTL locales",()=>{
  for(const language of ["ja","ja-JP","ko","es","fr","de","pt-BR","zh-TW","ar","hi","th","vi","ru","uk","tr"]){
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
  assert.equal(inferPostLanguageHint("สวัสดีครับ"),"th");
  assert.equal(inferPostLanguageHint("مرحبا بالجميع"),"ar");
  assert.equal(inferPostLanguageHint("नमस्ते दुनिया"),"hi");
  assert.equal(inferPostLanguageHint("今日是個好日子"),"auto");
  assert.equal(inferPostLanguageHint("¿Qué opinas de este lanzamiento?"),"auto");
  assert.equal(inferPostLanguageHint("Это очень интересно"),"auto");
});

test("auto prompting follows source post rather than user-interface or saved Chinese examples",()=>{
  const post="今日は日本の開発者コミュニティで面白い議論がありました。";
  const prompts=buildPrompts({postContext:{text:post,url:"https://x.com/test/status/123"},voiceProfile:{...DEFAULT_VOICE_PROFILE,language:"auto",writingSamples:["太牛了哈哈"]}});
  assert.match(prompts.system,/Automatic reply language/);
  assert.match(prompts.system,/Script clue: "ja"/);
  assert.match(prompts.system,/ALL three replies/i);
  assert.match(prompts.system,/do not mistake Japanese kanji for Chinese/i);
  assert.match(prompts.user,/Source script hint: ja/);
  assert.ok(prompts.user.includes(post));
  assert.match(prompts.system,/untrusted content/i);
});
test("manual language overrides post, with output language tag encoded for JSON",()=>{
  const prompts=buildPrompts({postContext:{text:"今日は素晴らしい天気です。"},voiceProfile:{...DEFAULT_VOICE_PROFILE,language:"fr"}});
  assert.match(prompts.system,/explicitly selected reply language "fr"/);
  assert.match(prompts.system,/Write ALL three replies and any quoteCandidate in that language/);
  assert.match(prompts.user,/Requested language: fr/);
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
