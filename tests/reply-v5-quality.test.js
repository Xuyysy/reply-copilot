import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replyV5TemplatePenalty,rerankV5DefaultStyle } from "../prompts/reply-v5-quality.js";
import { serializeModelOutput } from "../api/src/ai-model-provider.js";
const v5={ENVIRONMENT:"staging",STAGING_REPLY_PROMPT_VERSION:"v5"};
const payload={recommendation:"reply",defaultStyle:"natural",language:"zh",replies:{natural:"说得太对了！",light_humor:"今天的会议已经排到明年了",thoughtful:"那这个决定到底是谁来做"},reason:"适合回复",quoteCandidate:null};
const raw=JSON.stringify(payload);
test("V5 only adjusts defaultStyle for high-confidence boilerplate; no text/schema changes",()=>{
 const result=JSON.parse(rerankV5DefaultStyle(serializeModelOutput(raw),v5));
 const baseline=JSON.parse(serializeModelOutput(raw));
 assert.deepEqual(result,{...baseline,defaultStyle:"thoughtful",default_style:"thoughtful",best_reply_style:"thoughtful"});
 assert.deepEqual(JSON.parse(rerankV5DefaultStyle(raw,v5)),{...payload,defaultStyle:"thoughtful"});
 assert.equal(serializeModelOutput(JSON.stringify(result)),JSON.stringify(result));
 assert.equal(replyV5TemplatePenalty("今天真是累死了"),0);
 assert.equal(replyV5TemplatePenalty("确实如此，不过要看使用场景"),0);
 assert.equal(replyV5TemplatePenalty("Not X but Y"),0);
});
test("V5 preserves default for valid specific replies, uncertain or all-template options, and quote/skip",()=>{
 for(const p of [
  {...payload,replies:{...payload.replies,natural:"这会到底还要开多久"}},
  {...payload,replies:{...payload.replies,thoughtful:"值得深思"}},
  {...payload,recommendation:"skip"},
  {...payload,recommendation:"quote",quoteCandidate:"一条单独的观点"},
  {...payload,defaultStyle:"thoughtful"},
 ]){const s=JSON.stringify(p);assert.equal(rerankV5DefaultStyle(s,v5),s);}
});
test("V4, Production and invalid payload are untouched",()=>{
 for(const env of [{ENVIRONMENT:"staging",STAGING_REPLY_PROMPT_VERSION:"v4"},{ENVIRONMENT:"production",STAGING_REPLY_PROMPT_VERSION:"v5"},{ENVIRONMENT:"development",STAGING_REPLY_PROMPT_VERSION:"v5"}])assert.equal(rerankV5DefaultStyle(raw,env),raw);
 for(const s of ["bad json","null","{}",JSON.stringify({...payload,replies:{}})])assert.equal(rerankV5DefaultStyle(s,v5),s);
});
test("generation uses exactly one provider orchestration and only fresh validated output is reranked",()=>{
 const src=readFileSync(new URL("../api/src/ai.ts",import.meta.url),"utf8");
 assert.equal((src.match(/await executeAiGeneration\(/g)||[]).length,1);
 assert.equal((src.match(/rerankV5DefaultStyle\(result\.raw, env\)/g)||[]).length,1);
 assert.ok(src.indexOf("result.raw = serializeModelOutput(result.raw);")<src.indexOf("result.raw = rerankV5DefaultStyle(result.raw, env);"));
 assert.ok(src.indexOf("result.raw = rerankV5DefaultStyle(result.raw, env);")<src.indexOf("finish: (raw:"));
});

test("unset flag on the V5 release candidate only activates the Staging preference",()=>{
 assert.equal(rerankV5DefaultStyle(raw,{ENVIRONMENT:"staging"}),rerankV5DefaultStyle(raw,v5));
 assert.equal(rerankV5DefaultStyle(raw,{ENVIRONMENT:"production"}),raw);
 for(const flag of ["v3","legacy","typo",""])assert.equal(rerankV5DefaultStyle(raw,{ENVIRONMENT:"staging",STAGING_REPLY_PROMPT_VERSION:flag}),raw);
});

test("V5 preserves canonical output fields, score, legacy aliases and replay serialization",()=>{
 const input=serializeModelOutput(JSON.stringify({...payload,score:83}));
 const output=rerankV5DefaultStyle(input,v5);
 const before=JSON.parse(input),after=JSON.parse(output);
 assert.deepEqual(Object.keys(after),Object.keys(before));
 assert.deepEqual(after,{...before,defaultStyle:"thoughtful",default_style:"thoughtful",best_reply_style:"thoughtful"});
 assert.equal(serializeModelOutput(output),output);
 assert.equal(rerankV5DefaultStyle(output,v5),output);
});
