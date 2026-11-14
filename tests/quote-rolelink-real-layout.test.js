import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

function api() {
  const sandbox={URL,location:{href:"https://x.com/home"},performance:{now:()=>50},
    getComputedStyle:()=>({visibility:"visible"})};
  sandbox.globalThis=sandbox;
  for(const name of ["post-extractor","composer-association"]){
    vm.runInNewContext(readFileSync(new URL("../content/"+name+".js",import.meta.url),"utf8"),sandbox);
  }
  sandbox.ZaneReplyCopilotContent.composerAdapter={hasContent:()=>false};
  return sandbox.ZaneReplyCopilotContent;
}

function roleLinkQuoted({caption="",outerId="101",quoteId="202",roleCard=true,hasAuthor=true,quotedBody="A useful original quoted post",outerTimestamp=true}={}) {
  const tweet={isConnected:true,matches:q=>q==="article",contains:n=>n===card||n===quoted||n===quoteTime||n===outerTime||n===quotedLink||n===outerLink,
    querySelector:q=>q==='[data-testid="quoteTweet"]'?null:null,
    querySelectorAll(q){
      if(q==="time")return outerTimestamp?[quoteTime,outerTime]:[quoteTime];
      if(q.includes('a[href*="/status/"]'))return outerTimestamp?[quotedLink,outerLink]:[quotedLink];
      if(q.includes('[data-testid="tweetText"]'))return caption?[main,quoted]:[quoted];
      if(q==='div[role="link"]')return roleCard?[card]:[];
      return [];
    }};
  const card={contains:n=>n===quoted||n===quoteTime||n===quotedLink,
    querySelector:q=>q==='[data-testid="User-Name"]'?hasAuthor?{}:null:q==='[data-testid="tweetText"]'?quoted:null};
  const quotedLink={href:"https://x.com/quote/status/"+quoteId,closest:q=>q==="article"?tweet:q==='div[role="link"]'?card:null};
  const outerLink={href:"https://x.com/original/status/"+outerId,closest:q=>q==="article"?tweet:null};
  const quoteTime={closest:q=>q==="article"?tweet:q==='div[role="link"]'?card:q.includes('a[href*="/status/"]')?quotedLink:null};
  const outerTime={closest:q=>q==="article"?tweet:q.includes('a[href*="/status/"]')?outerLink:null};
  const quoted={innerText:quotedBody,textContent:quotedBody,
    closest:q=>q==="article"?tweet:q==='div[role="link"]'?card:null,
    querySelector:()=>null};
  const main={innerText:caption,textContent:caption,closest:q=>q==="article"?tweet:null};
  return {tweet,card,quoted,quoteTime,outerTime};
}

function modalOfQuoted(api,post,{parentId="101",quoteText="A useful original quoted post",includeCard=true,includeParent=true}={}) {
  const parent={isConnected:true,matches:q=>q==="article",getClientRects:()=>[{}],closest:()=>null,contains:()=>false,
    querySelectorAll:q=>q==="time"?[parentTime]:q.includes('a[href*="/status/"]')?[parentLink]:[]};
  const parentLink={href:"https://x.com/original/status/"+parentId,closest:q=>q==="article"?parent:null};
  const parentTime={closest:q=>q==="article"?parent:q.includes('a[href*="/status/"]')?parentLink:null};
  const quoted={innerText:quoteText,textContent:quoteText,querySelector:()=>null};
  const card={querySelector:q=>q==='[data-testid="User-Name"]'?{}:q==='[data-testid="tweetText"]'?quoted:null};
  const editor={isConnected:true,getClientRects:()=>[{}],closest:q=>q==='[role="dialog"]'?dialog:null};
  const dialog={isConnected:true,getClientRects:()=>[{}],closest:()=>null,
    querySelectorAll:q=>q==="article"?(includeParent?[parent]:[]):q==='div[role="link"]'?(includeCard?[card]:[]):
      q.includes('contenteditable')?[editor]:[]};
  const document={activeElement:editor,querySelectorAll:q=>q==='[role="dialog"]'?[dialog]:[]};
  const facts=api.composerAssociation.snapshot(document,post,"https://x.com/home","https://x.com/home",50);
  const association=api.composerAssociation.create({trusted:true,statusId:post.statusId,requestId:"r1",now:0,
    baselineModalCount:0,baselineEditors:[]});
  return {facts,result:association.evaluate(facts)};
}

test("role=link quote without quoteTweet marker belongs to nested quote even if parent caption is empty",()=>{
 const a=api(),f=roleLinkQuoted(),p=a.postExtractor.extractPost(f.tweet);
 assert.equal(a.postExtractor.isQuoteContent(f.quoted,f.tweet),true);
 assert.equal(a.postExtractor.isQuoteContent(f.quoteTime,f.tweet),true);
 assert.equal(a.postExtractor.isQuoteContent(f.outerTime,f.tweet),false);
 assert.equal(a.postExtractor.postText(f.tweet),"");
 assert.equal(p.ok,true);
 assert.equal(p.statusId,"101");
 assert.equal(p.sourceUrl,"https://x.com/original/status/101");
 assert.equal(p.sourceText,"A useful original quoted post");
 assert.equal(p.quoteOnly,true);
});
test("role=link quoted card stays excluded when outer tweet has its own caption",()=>{
 const a=api(),f=roleLinkQuoted({caption:"This is my own commentary"}),p=a.postExtractor.extractPost(f.tweet);
 assert.equal(p.ok,true);
 assert.equal(p.statusId,"101");
 assert.equal(p.sourceText,"This is my own commentary");
 assert.equal(p.quoteOnly,false);
});
test("unmarked ambiguous quote without author or independent parent timestamp fails closed",()=>{
 const a=api();
 assert.equal(a.postExtractor.extractPost(roleLinkQuoted({hasAuthor:false}).tweet).ok,false);
 assert.equal(a.postExtractor.extractPost(roleLinkQuoted({outerTimestamp:false}).tweet).ok,false);
});
test("role-link quote-only modal binds to verified outer ID and exact embedded quote text",()=>{
 const a=api(),p=a.composerAssociation.capturePost(a.postExtractor.extractPost(roleLinkQuoted().tweet));
 const good=modalOfQuoted(a,p);
 assert.equal(good.facts.editors[0].contextStatusId,"101");
 assert.equal(good.facts.editors[0].contextMatches,true);
 assert.equal(good.result.state,"bound");
 for(const invalid of [{parentId:"999"},{quoteText:"Wrong quoted content"},{includeCard:false},{includeParent:false}]){
  assert.notEqual(modalOfQuoted(a,p,invalid).result.state,"bound",JSON.stringify(invalid));
 }
});
test("source only includes role-link fallback and no new request path or extra AI generation",()=>{
 const src=readFileSync(new URL("../content/post-extractor.js",import.meta.url),"utf8");
 const assoc=readFileSync(new URL("../content/composer-association.js",import.meta.url),"utf8");
 const capture=readFileSync(new URL("../content/content-script.js",import.meta.url),"utf8");
 assert.match(src,/function roleLinkQuoteCard\(/);
 assert.match(src,/const card=quoteCard\(article\)/);
 assert.match(assoc,/quotedPreviewMatches/);
 assert.match(capture,/traceAssociation\("capture_failed",/);
 assert.doesNotMatch(src+assoc,/fetch\s*\(|XMLHttpRequest|requestConfiguredModel/);
});
