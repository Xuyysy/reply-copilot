import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadContent(name, context = {}) {
  const source = await readFile(new URL(`../content/${name}.js`, import.meta.url), "utf8");
  const sandbox = { globalThis: {}, URL, ...context };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.ZaneReplyCopilotContent;
}

test("reply detector accepts a user-facing Reply control and rejects unrelated buttons", async () => {
  const { replyDetector } = await loadContent("reply-detector");
  const reply = { matches: (selector) => selector.includes("button"), getAttribute: (name) => name === "aria-label" ? "Reply" : "", textContent: "" };
  const like = { ...reply, getAttribute: (name) => name === "aria-label" ? "Like" : "" };
  assert.equal(replyDetector.isReplyControl(reply), true);
  assert.equal(replyDetector.isReplyControl(like), false);
});

test("post extractor fails closed without exact post text and URL", async () => {
  const { postExtractor } = await loadContent("post-extractor", { location: { href: "https://x.com/home" } });
  assert.equal(postExtractor.extractPost(null).reason, "no-post");
  const article = { matches: () => true, querySelectorAll: () => [] };
  assert.equal(postExtractor.extractPost(article).ok, false);
});

test("composer adapter locates X editor and avoids direct DOM text writes", async () => {
  const editor = { isConnected: true, innerText: "existing user draft", closest: () => null };
  const { composerAdapter } = await loadContent("composer-adapter", { document: { querySelector: () => null } });
  const article = { querySelectorAll: () => [editor] };
  assert.equal(composerAdapter.findComposer(article), editor);
  assert.equal(composerAdapter.readText(editor), "existing user draft");
  for (const method of ["fillIfSafe", "replaceOnExplicitClick", "replaceExactDoubleInsertion"]) assert.equal(composerAdapter[method], undefined); assert.equal(typeof composerAdapter.insertOnce, "function");
  const source = await readFile(new URL("../content/composer-adapter.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /execCommand|replaceChildren|insertNode|innerHTML\s*=(?!=)|innerText\s*=(?!=)|textContent\s*=(?!=)/);
});

test("composer adapter focuses an empty editor and places the caret without inserting text", async () => {
  const editor = { isConnected: true, innerText: "", contains: (node) => node === editor };
  const selection = { anchorNode: null, removeAllRanges() {}, addRange() { this.anchorNode = editor; } };
  const document = { activeElement: null, createRange: () => ({ selectNodeContents() {}, collapse() {} }) };
  editor.focus = () => { document.activeElement = editor; };
  const { composerAdapter } = await loadContent("composer-adapter", { document, window: { getSelection: () => selection } });
  assert.equal(composerAdapter.focusEmpty(editor), true);
  assert.equal(editor.innerText, "");
  editor.innerText = "user draft";
  assert.equal(composerAdapter.focusEmpty(editor), false);
  assert.equal(editor.innerText, "user draft");
});

test("inline assistant cycles its cached candidates without regenerating", async () => {
  const { inlineAssistant } = await loadContent("inline-assistant", { chrome: { runtime: { getURL: (path) => path } } });
  assert.equal(inlineAssistant.nextCandidateIndex(0, 3), 1);
  assert.equal(inlineAssistant.nextCandidateIndex(2, 3), 0);
  assert.equal(inlineAssistant.nextCandidateIndex(0, 0), 0);
});

test("inline assistant exposes copy and no composer mutation actions", async () => {
  const source = await readFile(new URL("../content/inline-assistant.js", import.meta.url), "utf8");
  const content = await readFile(new URL("../content/content-script.js", import.meta.url), "utf8");
  assert.match(source, /data-action="copy"/);
  assert.doesNotMatch(source, /data-action="(?:fill|replace)"/);
  assert.doesNotMatch(content, /composerAdapter\.(?:fillIfSafe|replaceOnExplicitClick)|action === "(?:fill|replace)"/);
});

test("controlled editor fixture models input state and a later rerender", async () => {
  const fixture = await readFile(new URL("./fixtures/controlled-composer.html", import.meta.url), "utf8");
  assert.match(fixture, /contenteditable="true"/);
  assert.match(fixture, /editor\.addEventListener\("input"/);
  assert.match(fixture, /模拟框架重渲染/);
  assert.match(fixture, /model = editor\.innerText/);
});

test("persona keeps the earlier posts as references while allowing simple natural replies", async () => {
  const { ZANE_PERSONA } = await import("../prompts/persona.js");
  assert.equal(ZANE_PERSONA.postStyleExamples.length >= 3, true);
  assert.match(ZANE_PERSONA.postStyleGuidance, /references only/i);
  assert.match(ZANE_PERSONA.humor, /empathy comes first/i);
});

function richPostFixture({id="111",text="Caption",quoteId=null,quoteText="Quoted text",timestamp=true}={}) {
  let body=text;
  const article={isConnected:true,matches:sel=>sel==="article",contains:()=>false,getClientRects:()=>[{}],
    closest:sel=>sel==='[aria-hidden="true"], [hidden]'?null:null,
    querySelectorAll(selector) {
      if(selector==="time")return timestamp?[time]:[];
      if(selector.includes('a[href*="/status/"]'))return quoteId?[quoteAnchor,mainAnchor]:[mainAnchor];
      if(selector.includes('[data-testid="tweetText"]'))return [mainText,...(quoteId?[quoteTextNode]:[])];
      if(selector.includes('a[href*="/photo/"]'))return [];
      return [];
    }
  };
  const mainAnchor={href:"https://x.com/poster/status/"+id,closest:sel=>sel==="article"?article:null};
  const quoteAnchor={href:"https://x.com/quoted/status/"+quoteId,closest:sel=>sel==="article"?article:null};
  const time={closest:sel=>sel==="article"?article:sel.includes('a[href*="/status/"]')?mainAnchor:null};
  const mainText={get innerText(){return body},get textContent(){return body},closest:sel=>sel==="article"?article:null};
  const quoteTextNode={innerText:quoteText,textContent:quoteText,closest:sel=>sel==="article"?article:null};
  return {article,setText:text=>{body=text},mainAnchor,quoteAnchor};
}
async function richPostApis() {
  const sandbox={URL,location:{href:"https://x.com/home"},performance:{now:()=>10},getComputedStyle:()=>({visibility:"visible"})};
  sandbox.globalThis=sandbox;
  for(const file of ["post-extractor","composer-association"]){
    vm.runInNewContext(await readFile(new URL("../content/"+file+".js",import.meta.url),"utf8"),sandbox);
  }
  sandbox.ZaneReplyCopilotContent.composerAdapter={hasContent:()=>false};
  return sandbox.ZaneReplyCopilotContent;
}
function snapshotRichDialog(api,post,articles) {
  const editor={isConnected:true,getClientRects:()=>[{}],closest:selector=>selector==='[role="dialog"]'?dialog:null};
  const dialog={isConnected:true,getClientRects:()=>[{}],closest:()=>null,
    querySelectorAll:selector=>selector==="article"?articles:selector.includes('contenteditable')?[editor]:[]};
  const doc={activeElement:editor,querySelectorAll:selector=>selector==='[role="dialog"]'?[dialog]:[]};
  const facts=api.composerAssociation.snapshot(doc,post,"https://x.com/home","https://x.com/home",10);
  const assoc=api.composerAssociation.create({trusted:true,statusId:post.statusId,requestId:"test",now:0,
    baselineModalCount:0,baselineEditors:[]});
  return {facts,result:assoc.evaluate(facts)};
}
test("rich X posts identify the clicked outer tweet by its timestamp, not nested quote links",async()=>{
  const api=await richPostApis();
  const {article}=richPostFixture({id:"111",text:"本日の出来事",quoteId:"222",quoteText:"unrelated quoted text"});
  const post=api.postExtractor.extractPost(article);
  assert.equal(post.ok,true);
  assert.equal(post.statusId,"111");
  assert.equal(post.sourceUrl,"https://x.com/poster/status/111");
  assert.equal(post.sourceText,"本日の出来事");
});
test("a quote/media-rich reply modal binds to the one matching post, not the first nested article",async()=>{
  const api=await richPostApis();
  const {article}=richPostFixture({id:"111",text:"Caption on a video and multiple images",quoteId:"222"});
  const post=api.composerAssociation.capturePost(api.postExtractor.extractPost(article));
  const quoted=richPostFixture({id:"222",text:"Quoted unrelated item"}).article;
  const copy=richPostFixture({id:"111",text:"Caption on a video and multiple images",quoteId:"222"}).article;
  const match=snapshotRichDialog(api,post,[quoted,copy]);
  assert.equal(match.facts.editors[0].contextStatusId,"111");
  assert.equal(match.facts.editors[0].contextArticleCount,2);
  assert.equal(match.facts.editors[0].contextMatches,true);
  assert.equal(match.result.state,"bound");
});
test("translation or media reflow on same verified post ID does not hide reply assistant",async()=>{
  const api=await richPostApis();
  const source=richPostFixture({id:"111",text:"これは覚えておいてほしいのですが"});
  const post=api.composerAssociation.capturePost(api.postExtractor.extractPost(source.article));
  source.setText("Please remember this");
  const modal=richPostFixture({id:"111",text:"Please remember this"}).article;
  const match=snapshotRichDialog(api,post,[modal]);
  assert.equal(match.facts.sourceUnchanged,true);
  assert.equal(match.facts.editors[0].contextMatches,true);
  assert.equal(match.result.state,"bound");
});
test("rich post association still rejects a different post and ambiguous identities",async()=>{
  const api=await richPostApis();
  const source=richPostFixture({id:"111",text:"The correct post"});
  const post=api.composerAssociation.capturePost(api.postExtractor.extractPost(source.article));
  const wrong=richPostFixture({id:"333",text:"The same words are not an identity"}).article;
  const match=snapshotRichDialog(api,post,[wrong]);
  assert.equal(match.facts.editors[0].contextMatches,false);
  assert.equal(match.result.state,"rejected");
  const ambiguous=richPostFixture({id:"111",text:"outer",quoteId:"222",timestamp:false}).article;
  assert.equal(api.postExtractor.extractPost(ambiguous).ok,false);
  const noCaption=richPostFixture({id:"111",text:""}).article;
  assert.equal(api.postExtractor.extractPost(noCaption).ok,false);
});
test("reply activation keeps canonical ID across translation without relaxing target verification",async()=>{
  const source=await readFile(new URL("../content/content-script.js",import.meta.url),"utf8");
  assert.match(source,/live.statusId!==activation.post.statusId/);
  assert.doesNotMatch(source,/live.sourceText!==activation.post.sourceText/);
});
