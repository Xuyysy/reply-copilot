import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function extractor() {
 const source=await readFile(new URL('../experiments/staging-no-debugger/content/post-extractor.js',import.meta.url),'utf8');
 const sandbox={URL,location:{href:'https://x.com/home'}};sandbox.globalThis=sandbox;vm.runInNewContext(source,sandbox);
 return sandbox.ZaneReplyCopilotContent.postExtractor;
}
function post({id='123',urlHost='x.com',urlPath,user='user',text='post body',longform=false,photo=false,video=false,poll=false,quote=false,nestedQuoteText='quoted text'}={}) {
 const nestedArticle={matches:s=>s==='article'};
 const article={matches:s=>s==='article',querySelectorAll(selector){
  if(selector==='article')return quote?[nestedArticle]:[];
  if(selector.includes('a[href*="/status/"]'))return [...(id||urlPath?[{href:`https://${urlHost}${urlPath||`/${user}/status/${id}`}`,closest:()=>article}]:[]),...(quote?[{href:'https://x.com/quoted/status/999',closest:()=>nestedArticle}]:[])];
  if(selector==='[data-testid="tweetText"]')return [...(text?[{innerText:text,textContent:text,closest:()=>article}]:[]),...(quote?[{innerText:nestedQuoteText,textContent:nestedQuoteText,closest:()=>nestedArticle}]:[])];
  if(selector==='[data-testid="longformRichText"]')return longform?[{innerText:text,textContent:text,closest:()=>article}]:[];
  if(selector.includes('/photo/'))return photo?[{closest:()=>article}]:[];
  if(selector.includes('videoPlayer'))return video?[{closest:()=>article}]:[];
  if(selector.includes('[data-testid="poll"]'))return poll?[{closest:()=>article}]:[];
  if(selector.includes('longform'))return longform?[{closest:()=>article}]:[];
  return [];
 }};
 return article;
}

test('Staging extractor classifies common post variants without changing status identity',async()=>{
 const {extractPost}=await extractor();
 for(const kind of ['text','photo','video','poll','quote','longform']){
  const article=post({id:'456',text:'root post',photo:kind==='photo',video:kind==='video',poll:kind==='poll',quote:kind==='quote',longform:kind==='longform'});
  const result=extractPost(article);assert.equal(result.ok,true,kind);assert.equal(result.statusId,'456',kind);assert.equal(result.sourceText,'root post',kind);assert.ok(result.postKinds.includes(kind),kind);
 }
});

test('quoted nested post text and status never replace the clicked outer post',async()=>{
 const {extractPost}=await extractor();const result=extractPost(post({id:'100',text:'outer body',quote:true,nestedQuoteText:'quoted body'}));
 assert.equal(result.statusId,'100');assert.equal(result.sourceText,'outer body');assert.equal(result.evidence.statusLinkCount,1);
});

test('Staging extractor accepts X web status permalink but rejects unknown identity or text',async()=>{
 const {extractPost}=await extractor();
 assert.equal(extractPost(post({id:'',urlPath:'/i/web/status/707',text:'body'})).statusId,'707');
 assert.equal(extractPost(post({id:'',text:'body'})).reason,'status_id_unavailable');
 assert.equal(extractPost(post({id:'808',text:'',video:true})).reason,'post_text_unavailable');
 assert.equal(extractPost(null).reason,'no_post');
});
