import test from "node:test";
import assert from "node:assert/strict";
import { buildLiveProductionV3Prompts } from "../prompts/prompt-v3-live-parity.js";
import { buildFastV4Prompts } from "../prompts/prompt-v4-fast.js";
import { DEFAULT_VOICE_PROFILE } from "../domain/voice-profile.js";

const profile={...DEFAULT_VOICE_PROFILE, name:"Test Voice", writingSamples:["sample-one","sample-two"],customInstructions:"A little dry.",interests:["coding"]};
const request={postContext:{text:"上线第一天，bug 比用户还多。",url:"https://x.com/example/status/1"},voiceProfile:profile,recentHistory:[{style:"natural",reply:"older reply"}],styleStats:{natural:4},replyStyle:"bold",outputSchemaVersion:2};
const bytes=p=>Buffer.byteLength(p.system)+Buffer.byteLength(p.user);
test("legacy v1 payload is byte-identical",()=>{
  const args={...request,outputSchemaVersion:1};
  assert.deepEqual(buildFastV4Prompts(args),buildLiveProductionV3Prompts(args));
});
test("V4 reduces static prompt bytes without cutting personalization or changing JSON schema",()=>{
  const old=buildLiveProductionV3Prompts(request), next=buildFastV4Prompts(request);
  assert.ok(bytes(next)<bytes(old), "V4 must not grow prompt bytes");
  const shape=p=>p.system.slice(p.system.indexOf("Required JSON shape ("),p.system.indexOf("REPLY LANGUAGE POLICY")).trim();
  assert.equal(shape(next),shape(old));
  assert.equal(next.user.slice(next.user.indexOf("<post_text_json>")),old.user.slice(old.user.indexOf("<post_text_json>")));
  for(const value of ["Test Voice","sample-one","sample-two","A little dry.","coding"])
    assert.ok(next.system.includes(value));
  assert.match(next.system,/untrusted data/);
  assert.match(next.system,/Always give three nonempty strings/);
  assert.match(next.system,/Never invent personal experiences/);
});
test("all four language policies and requested length, style, history remain intact",()=>{
  for (const [language,text] of [["auto","日本語の投稿"],["auto","한국어 게시글"],["auto","中文帖子"],["auto","English post"],["zh","English post"],["en","中文"],["ja","English"],["ko","English"]]){
    for(const replyLength of ["short","medium","adaptive"]){
      const args={...request,postContext:{text},voiceProfile:{...profile,language,replyLength}};
      const old=buildLiveProductionV3Prompts(args),next=buildFastV4Prompts(args);
      const policy=p=>p.system.split("REPLY LANGUAGE POLICY\n")[1].split("\nVOICE PROFILE")[0].trim();
      assert.equal(policy(next),policy(old));
      assert.ok(next.system.includes(JSON.stringify(replyLength)));
      assert.equal(next.user.slice(next.user.indexOf("<post_text_json>")),old.user.slice(old.user.indexOf("<post_text_json>")));
      assert.ok(bytes(next)<bytes(old));
    }
  }
});
test("fixed rules and output schema precede per-user profile",()=>{
  const a=buildFastV4Prompts(request), b=buildFastV4Prompts({...request,voiceProfile:{...profile,name:"Different"}});
  const prefix=p=>p.system.split("\nVOICE PROFILE")[0];
  assert.equal(prefix(a),prefix(b));
});
