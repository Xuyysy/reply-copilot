import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPrompts } from "../prompts/prompt-builder.js";
import { buildLiveProductionV3Prompts } from "../prompts/prompt-v3-live-parity.js";
import { buildFastV4Prompts } from "../prompts/prompt-v4-fast.js";
import { buildHumanV5Prompts } from "../prompts/prompt-v5-human.js";
import { selectStagingReplyPrompts } from "../prompts/staging-reply-prompt-selector.js";
const args={postContext:{text:"今天又加班了",url:"https://x.com/a/status/1"},voiceProfile:{name:"sample",language:"auto",replyLength:"short"},replyStyle:"bold",recentHistory:[{style:"natural",reply:"sample reply"}]};
test("V5 ablation Staging defaults to no-corpus; explicit full V5 and v4/v3/legacy preserved",()=>{
  assert.deepEqual(selectStagingReplyPrompts({ENVIRONMENT:"staging"},args),buildHumanV5Prompts({...args,outputSchemaVersion:2},{useExamples:false}));
  assert.deepEqual(selectStagingReplyPrompts({ENVIRONMENT:"staging",STAGING_REPLY_PROMPT_VERSION:"v5"},args),buildHumanV5Prompts({...args,outputSchemaVersion:2}));
  assert.deepEqual(selectStagingReplyPrompts({ENVIRONMENT:"staging",STAGING_REPLY_PROMPT_VERSION:"v4"},args),buildFastV4Prompts({...args,outputSchemaVersion:2}));
  const v3=selectStagingReplyPrompts({ENVIRONMENT:"staging",STAGING_REPLY_PROMPT_VERSION:"v3"},args);
  assert.deepEqual(v3,buildLiveProductionV3Prompts({...args,outputSchemaVersion:2}));
  assert.match(v3.user,/FINAL REPLY LANGUAGE: match the original X post language/);
  for(const flag of ["legacy","typo",""])assert.deepEqual(selectStagingReplyPrompts({ENVIRONMENT:"staging",STAGING_REPLY_PROMPT_VERSION:flag},args),buildPrompts(args));
});
test("Production and explicit legacy clients never select V4",()=>{
  for(const environment of ["production","development","unknown"])
    for(const version of ["v5","v4","v3",undefined])
      assert.deepEqual(selectStagingReplyPrompts({ENVIRONMENT:environment,STAGING_REPLY_PROMPT_VERSION:version},args),buildPrompts(args));
  const v1={...args,outputSchemaVersion:1};
  assert.deepEqual(selectStagingReplyPrompts({ENVIRONMENT:"staging",STAGING_REPLY_PROMPT_VERSION:"v4"},v1),buildPrompts(v1));
});
test("actual generation route uses the selector without adding a model call or altering the normalized request hash",()=>{
  const src=readFileSync(new URL("../api/src/ai.ts",import.meta.url),"utf8");
  assert.equal((src.match(/const prompts = selectStagingReplyPrompts\(env,/g)||[]).length,1);
  assert.equal((src.match(/await executeAiGeneration\(/g)||[]).length,1);
  assert.equal((src.match(/const hash = await sha256\(JSON\.stringify\(input\)\);/g)||[]).length,1);
  assert.equal((src.match(/provider: \(\) => configuredModel \?/g)||[]).length,1);
});
