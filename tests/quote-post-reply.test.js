import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
async function buildApi() {
  const sandbox={URL,location:{href:"https://x.com/home"},performance:{now:()=>10},getComputedStyle:()=>({visibility:"visible"})};
  sandbox.globalThis=sandbox;
  for(const name of ["post-extractor","composer-association"])
    vm.runInNewContext(readFileSync(new URL("../content/"+name+".js",import.meta.url),"utf8"),sandbox);
  sandbox.ZaneReplyCopilotContent.composerAdapter={hasContent:()=>false};
  return sandbox.ZaneReplyCopilotContent;
}
function articleFixture({id="101",caption="",quoteId="202",quote="Original quote",quotedCard=true}={}) {
  const outer={isConnected:true,matches:s=>s==="article",contains:n=>n===quoteRoot||n===outer||n===quoteNode,getClientRects:()=>[{}],
    closest:()=>null,
    querySelector(selector){return selector==='[data-testid="quoteTweet"]'&&quotedCard?quoteRoot:null},
    querySelectorAll(selector){
      if(selector==="time")return [quotedTime,outerTime];
      if(selector.includes('a[href*="/status/"]'))return [quotedLink,outerLink];
      if(selector.includes('[data-testid="tweetText"]'))return caption?[mainNode,quoteNode]:[quoteNode];
      return [];
    }
  };
  const quoteRoot={querySelector:s=>s==='[data-testid="tweetText"]'?quoteNode:null};
  const quotedLink={href:"https://x.com/quoted/status/"+quoteId,closest:s=>s==="article"?outer:null};
  const outerLink={href:"https://x.com/outer/status/"+id,closest:s=>s==="article"?outer:null};
  const quotedTime={closest:s=>s==="article"?outer:s.includes('quoteTweet')?quoteRoot:s.includes('a[href*="/status/"]')?quotedLink:null};
  const outerTime={closest:s=>s==="article"?outer:s.includes('quoteTweet')?null:s.includes('a[href*="/status/"]')?outerLink:null};
  const mainNode={innerText:caption,textContent:caption,closest:s=>s==="article"?outer:null};
  const quoteNode={innerText:quote,textContent:quote,closest:s=>s==="article"?outer:s.includes('quoteTweet')?quoteRoot:null};
  return {outer,quoteRoot,quoteNode};
}
function modalSnapshot(api,post,{sameQuote=true,parentId="101",includeQuote=true}={}){
  const parent={isConnected:true,matches:s=>s==="article",getClientRects:()=>[{}],closest:s=>s.includes("quoteTweet")?null:null,contains:()=>false,
    querySelectorAll:s=>s==="time"?[outerTime]:s.includes('a[href*="/status/"]')?[outerLink]:s.includes('[data-testid="tweetText"]')?[]:[]};
  const outerLink={href:"https://x.com/outer/status/"+parentId,closest:s=>s==="article"?parent:null};
  const outerTime={closest:s=>s==="article"?parent:s.includes('a[href*="/status/"]')?outerLink:null};
  const preview={innerText:sameQuote?"Original quote":"A different embedded quote",textContent:sameQuote?"Original quote":"A different embedded quote"};
  const editor={isConnected:true,getClientRects:()=>[{}],closest:s=>s==='[role="dialog"]'?dialog:null};
  const dialog={isConnected:true,getClientRects:()=>[{}],closest:()=>null,
    querySelectorAll:s=>s==="article"?[parent]:s.includes('quoteTweet')?includeQuote?[preview]:[]:s.includes('contenteditable')?[editor]:[]};
  const doc={activeElement:editor,querySelectorAll:s=>s==='[role="dialog"]'?[dialog]:[]};
  const facts=api.composerAssociation.snapshot(doc,post,"https://x.com/home","https://x.com/home",10);
  const assoc=api.composerAssociation.create({trusted:true,statusId:post.statusId,requestId:"case",now:0,baselineModalCount:0,baselineEditors:[]});
  return {facts,matched:assoc.evaluate(facts)};
}
test("quote-only outer post extracts source context while retaining OUTER post id",async()=>{
  const api=await buildApi();
  const post=api.postExtractor.extractPost(articleFixture().outer);
  assert.equal(post.ok,true);
  assert.equal(post.statusId,"101");
  assert.equal(post.sourceUrl,"https://x.com/outer/status/101");
  assert.equal(post.sourceText,"Original quote");
  assert.equal(post.quoteOnly,true);
  assert.equal(post.quotedText,"Original quote");
});
test("captioned quote stays fast: unchanged outer caption, no duplicated quoted input",async()=>{
  const api=await buildApi();
  const post=api.postExtractor.extractPost(articleFixture({caption:"This is worth a look"}).outer);
  assert.equal(post.ok,true);
  assert.equal(post.sourceText,"This is worth a look");
  assert.equal(post.quoteOnly,false);
  assert.equal(post.quotedText,null);
});
test("only quote text without a genuine quoteTweet card must not be treated as an outer post",async()=>{
  const api=await buildApi();
  const post=api.postExtractor.extractPost(articleFixture({quotedCard:false}).outer);
  // Without a card marker, a text node is not reliable evidence of the quote.
  assert.equal(post.ok,false);
  assert.equal(post.reason,"post-context-incomplete");
});
test("quote-only reply binds when original parent ID and exact quote card agree",async()=>{
  const api=await buildApi();
  const post=api.composerAssociation.capturePost(api.postExtractor.extractPost(articleFixture().outer));
  const s=modalSnapshot(api,post);
  assert.equal(s.facts.editors[0].contextStatusId,"101");
  assert.equal(s.facts.editors[0].contextMatches,true);
  assert.equal(s.matched.state,"bound");
});
test("quote-only reply rejects wrong outer parent ID and explicitly wrong quote preview",async()=>{
  const api=await buildApi();
  const post=api.composerAssociation.capturePost(api.postExtractor.extractPost(articleFixture().outer));
  for(const change of [{parentId:"999"},{sameQuote:false}]){
    const s=modalSnapshot(api,post,change);
    assert.notEqual(s.matched.state,"bound");
  }
  const noPreview=modalSnapshot(api,post,{includeQuote:false});
  assert.equal(noPreview.facts.editors[0].contextStatusId,"101");
  assert.equal(noPreview.matched.state,"bound");
});
test("quote recovery is local-only and does not add provider calls or scans for normal posts",()=>{
  const source=readFileSync(new URL("../content/post-extractor.js",import.meta.url),"utf8");
  const assoc=readFileSync(new URL("../content/composer-association.js",import.meta.url),"utf8");
  assert.match(source,/const quotedText = ownText \? "" : quoteText\(article\)/);
  assert.match(source,/article\?\.querySelector\?\.\('\[data-testid="quoteTweet"\]'\)/);
  assert.match(assoc,/post\.quoteOnly && post\.quotedText/);
  assert.doesNotMatch(source+assoc,/\bfetch\s*\(|\bXMLHttpRequest\b|requestConfiguredModel/);
});
