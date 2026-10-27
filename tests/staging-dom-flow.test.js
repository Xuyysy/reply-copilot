import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function flow(){
 let click, next=0, commandCount=0, generationCount=0, observer, timeout, dialogs=[]; const pending=[], logs=[];
 const document={body:{},visibilityState:'visible',activeElement:null,hasFocus:()=>true,addEventListener:(name,handler)=>{if(name==='click')click=handler},removeEventListener(){},querySelector:()=>dialogs[0]||null,querySelectorAll:()=>dialogs,execCommand(_command,_ui,text){commandCount++;this.activeElement.innerText=text;this.activeElement.input?.();return true;}};
 const selection={get isCollapsed(){return true},get anchorNode(){return document.activeElement},get focusNode(){return document.activeElement}};
 const chrome={runtime:{id:'test',onMessage:{addListener(){},removeListener(){}},sendMessage(message){
   if(message.type==='REPLY_COPILOT_GET_BEHAVIOR')return Promise.resolve({ok:true,preferences:{autoGenerateOnReply:true,showFloatingWindow:true}});
   if(message.type==='REPLY_COPILOT_ACCOUNT_STATE')return Promise.resolve({ok:true,status:'credits_available'});
   if(message.type==='REPLY_COPILOT_GENERATE'){generationCount++;return new Promise(resolve=>pending.push(resolve));}
   return Promise.resolve({ok:true});
 }}};
 const assistant=()=>({host:{isConnected:true,remove(){}},showLoading(){},showResult(){},setAccountLabel(){},showApplied(){},showAccount(){},setStatus(){},showReady(){},close(){}});
 const ctx={document,window:{getSelection:()=>selection},location:{href:'https://x.com/home'},URL,chrome,console:{info:(...args)=>logs.push(args)},crypto:{randomUUID:()=>`request-${++next}`},setTimeout:(fn,ms)=>ms===9000?(timeout=fn,0):setTimeout(fn,ms),clearTimeout,setInterval,clearInterval,Symbol,MutationObserver:class{constructor(cb){observer=cb}observe(){}disconnect(){}},globalThis:null};ctx.globalThis=ctx;
 vm.runInNewContext(readFileSync(new URL('../experiments/staging-no-debugger/content/composer-adapter.js',import.meta.url),'utf8'),ctx);
 Object.assign(ctx.ZaneReplyCopilotContent,{replyDetector:{findReplyControl:target=>target},postExtractor:{extractPost:article=>article.post},inlineAssistant:{mount:assistant}});
 vm.runInNewContext(readFileSync(new URL('../experiments/staging-no-debugger/content/content-script.js',import.meta.url),'utf8'),ctx);
 function post(id){const editor={isConnected:true,innerText:'',parentElement:{isConnected:true},closest:()=>null,contains(node){return node===this},focus(){document.activeElement=this},addEventListener(_n,cb){this.input=cb},removeEventListener(){}}; const article={isConnected:true,closest:()=>null,querySelectorAll:()=>[editor]};article.post={ok:true,article,statusId:id,sourceText:'post',sourceUrl:`https://x.com/test/status/${id}`};return {editor,article,control:{closest:selector=>selector==='article'?article:null}};}
 const reply={ok:true,result:{recommendation:'reply',defaultStyle:'natural',replies:{natural:'中文 English 😀\nline'}}};
 return {post,click:p=>{document.activeElement=p.editor;click({isTrusted:true,target:p.control})},resolve:i=>pending[i](reply),pending,commands:()=>commandCount,generations:()=>generationCount,setDialogs:d=>{dialogs=d},mutate:()=>observer?.(),fireTimeout:()=>timeout?.(),logs,document};
}
test('repeated clicks on one post generate and insert once',async()=>{
 const f=flow(),p=f.post('101');f.click(p);await sleep(0);f.click(p);await sleep(0);assert.equal(f.generations(),1);f.resolve(0);await sleep(110);assert.equal(f.commands(),1);assert.equal(p.editor.innerText,'中文 English 😀\nline');
});
test('timeout reports only safe structural facts about dialog matching',()=>{
 const f=flow(),p=f.post('101');p.article.querySelectorAll=()=>[];f.click(p);p.article.isConnected=false;
 const other=f.post('102');f.setDialogs([{isConnected:true,closest:()=>null,querySelectorAll:s=>s==='article'?[other.article]:s.includes('contenteditable')?[other.editor]:[]}]);f.fireTimeout();
 const item=f.logs.find(parts=>parts[1]==='composer_timeout_details');assert.ok(item);
 const detail=JSON.parse(item[2]);assert.equal(detail.originalConnected,false);assert.equal(detail.dialogCount,1);assert.equal(detail.dialogs[0].primaryMatched,false);assert.equal(detail.dialogs[0].eligibleEditors,1);
 const serialized=JSON.stringify(item);assert.doesNotMatch(serialized,/https:|101|102|post|request-/i);
});
test('a matching reply dialog can replace a disconnected original post',async()=>{
 const f=flow(),p=f.post('101');p.article.querySelectorAll=()=>[];f.click(p);p.article.isConnected=false;
 const clone=f.post('101');const dialog={isConnected:true,closest:()=>null,querySelectorAll:s=>s==='article'?[clone.article]:s.includes('contenteditable')?[clone.editor]:[{href:clone.article.post.sourceUrl}]};
 f.setDialogs([dialog]);f.document.activeElement=clone.editor;f.mutate();await sleep(0);assert.equal(f.generations(),1);f.resolve(0);await sleep(110);assert.equal(f.commands(),1);assert.equal(clone.editor.innerText,'中文 English 😀\nline');
});
test('a different or ambiguous dialog never generates or inserts',async()=>{
 const f=flow(),p=f.post('101');p.article.querySelectorAll=()=>[];f.click(p);p.article.isConnected=false;
 const other=f.post('102');const dialog={isConnected:true,closest:()=>null,querySelectorAll:s=>s==='article'?[other.article]:s.includes('contenteditable')?[other.editor]:[{href:other.article.post.sourceUrl}]};
 f.setDialogs([dialog]);f.mutate();await sleep(0);assert.equal(f.generations(),0);assert.equal(f.commands(),0);
});
test('two matching dialogs are ambiguous and must not trigger generation',async()=>{
 const f=flow(),p=f.post('101');p.article.querySelectorAll=()=>[];f.click(p);p.article.isConnected=false;
 const dialog=()=>{const clone=f.post('101');return {isConnected:true,closest:()=>null,querySelectorAll:s=>s==='article'?[clone.article]:s.includes('contenteditable')?[clone.editor]:[]}};
 f.setDialogs([dialog(),dialog()]);f.mutate();await sleep(0);assert.equal(f.generations(),0);assert.equal(f.commands(),0);
});
test('typing or a recycled post while generation runs prevents insertion',async()=>{
 for(const change of [(p)=>{p.editor.innerText='user draft';p.editor.input()},(p)=>{p.article.post={...p.article.post,statusId:'999',sourceUrl:'https://x.com/test/status/999'}}]){
  const f=flow(),p=f.post('101');f.click(p);await sleep(0);change(p);f.resolve(0);await sleep(110);assert.equal(f.commands(),0);
 }
});
test('switching posts or closing the composer during generation prevents stale insertion',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);await sleep(0);f.click(b);await sleep(0);f.resolve(0);await sleep(0);b.editor.isConnected=false;f.resolve(1);await sleep(110);assert.equal(f.commands(),0);assert.equal(a.editor.innerText,'');assert.equal(b.editor.innerText,'');
});
