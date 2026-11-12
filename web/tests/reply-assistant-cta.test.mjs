import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {replyAssistantCta} from "../src/lib/reply-assistant-cta.mjs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");

test("signed-in visitors always enter their existing account, never registration",()=>{
 for(const status of ["ready","pending","empty"]){
  assert.deepEqual(replyAssistantCta(status,"zh"),{href:"/account/",label:"进入 AI 回复助手"});
  assert.deepEqual(replyAssistantCta(status,"en"),{href:"/account/",label:"Open AI reply assistant"});
 }
});

test("confirmed guests may register; loading/error use safe account fallback",()=>{
 assert.deepEqual(replyAssistantCta("guest","zh"),{href:"/login?mode=register",label:"免费体验 AI 回复助手"});
 assert.deepEqual(replyAssistantCta("guest","en"),{href:"/login?mode=register",label:"Start with AI replies"});
 for(const status of ["loading","error"]){
  assert.equal(replyAssistantCta(status,"zh").href,"/account/");
  assert.equal(replyAssistantCta(status,"en").href,"/account/");
 }
});

test("first-fold reply CTA shares existing /v1/me state refresh without extra credential reads",()=>{
 const home=read("../src/pages/index.astro");
 const base=read("../src/layouts/Base.astro");
 assert.match(home,/<a href="\/account\/" data-reply-assistant-cta class="button momentum-v2-primary">/);
 assert.match(base,/import \{ replyAssistantCta \} from "..\/lib\/reply-assistant-cta.mjs"/);
 assert.match(base,/document.querySelectorAll<HTMLAnchorElement>\("\[data-reply-assistant-cta\]"\)/);
 assert.match(base,/replyAssistantCta\(accountState,en\?"en":"zh"\)/);
 assert.match(base,/await api\("\/v1\/me"\)/);
 assert.match(base,/accountState="ready";updateAccountLinks\(\)/);
 assert.match(base,/event.persisted\)void loadAccountLinks\(\)/);
 assert.doesNotMatch(home,/<a href="\/login\?mode=register" class="button momentum-v2-primary">/);
 assert.match(home,/<a href="#momentum-framework" class="button secondary momentum-v2-secondary">/);
});
