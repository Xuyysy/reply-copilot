import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
function moduleApi(name, extra={}) {
  const sandbox={globalThis:null,URL,location:{href:"https://x.com/home"},...extra};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(readFileSync(new URL("../content/"+name+".js",import.meta.url),"utf8"),sandbox);
  return sandbox.ZaneReplyCopilotContent;
}
test("translation wrapper retargets pointer: genuine reply remains discoverable via composedPath",()=>{
 const {replyDetector}=moduleApi("reply-detector");
 const reply={matches:s=>s.includes("button"),getAttribute:n=>n==="data-testid"?"reply":null,innerText:"翻译后的标签"};
 const translatedChild={closest:()=>reply};
 const outer={closest:()=>null};
 assert.equal(replyDetector.findReplyControl(outer,{composedPath:()=>[translatedChild,reply,outer]}),reply);
 assert.equal(replyDetector.findReplyControl(outer,{composedPath:()=>[outer]}),null);
 const like={matches:s=>s.includes("button"),getAttribute:n=>n==="data-testid"?"like":null,innerText:"点赞"};
 assert.equal(replyDetector.findReplyControl(outer,{composedPath:()=>[{closest:()=>like}]}),null);
});
test("bilingual Immersive Translate additions are omitted while keeping original post and ID",()=>{
 const {postExtractor}=moduleApi("post-extractor");
 const article={matches:s=>s==="article",contains:()=>false,querySelectorAll:s=>
   s==="time"?[time]:s.includes('a[href*="/status/"]')?[anchor]:s.includes('[data-testid="tweetText"]')?[body]:[]};
 const anchor={href:"https://x.com/test/status/123",closest:s=>s==="article"?article:null};
 const time={closest:s=>s==="article"?article:s.includes("a[href")?anchor:null};
 const body={innerText:"Shipped it!\n终于上线了",textContent:"Shipped it!终于上线了",
   closest:s=>s==="article"?article:null,
   querySelector:s=>s.includes("immersive-translate")?{}:null,
   cloneNode:()=>({textContent:"Shipped it!",querySelectorAll:()=>[{remove(){}}]})};
 const post=postExtractor.extractPost(article);
 assert.equal(post.ok,true);assert.equal(post.statusId,"123");
 assert.equal(post.sourceText,"Shipped it!");
});
test("translation only changes one input attempt, not all subsequent posts",()=>{
 const source=readFileSync(new URL("../content/content-script.js",import.meta.url),"utf8");
 const widget=readFileSync(new URL("../content/inline-assistant.js",import.meta.url),"utf8");
 assert.ok(!source.includes("nativeInputHealthy"));
 assert.ok(source.includes("event.target?.closest?.('[contenteditable"));
 assert.ok(source.includes("api.replyDetector.findReplyControl(event.target,event)"));
 assert.ok(widget.includes('host.setAttribute("translate","no")'));
 assert.ok(!widget.includes('host.classList.add("notranslate")'));
 assert.ok(!source.includes("Google Translate"));
 assert.ok(!source.includes("chrome.i18n.detectLanguage"));
});
