import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function flow(){
 let click, next=0, commandCount=0, generationCount=0; const pending=[];
 const document={visibilityState:'visible',activeElement:null,hasFocus:()=>true,addEventListener:(name,handler)=>{if(name==='click')click=handler},removeEventListener(){},querySelector:()=>null,execCommand(_command,_ui,text){commandCount++;this.activeElement.innerText=text;this.activeElement.input?.();return true;}};
 const selection={get isCollapsed(){return true},get anchorNode(){return document.activeElement},get focusNode(){return document.activeElement}};
 const chrome={runtime:{id:'test',onMessage:{addListener(){},removeListener(){}},sendMessage(message){
   if(message.type==='REPLY_COPILOT_GET_BEHAVIOR')return Promise.resolve({ok:true,preferences:{autoGenerateOnReply:true,showFloatingWindow:true}});
   if(message.type==='REPLY_COPILOT_ACCOUNT_STATE')return Promise.resolve({ok:true,status:'credits_available'});
   if(message.type==='REPLY_COPILOT_GENERATE'){generationCount++;return new Promise(resolve=>pending.push(resolve));}
   return Promise.resolve({ok:true});
 }}};
 const assistant=()=>({host:{isConnected:true,remove(){}},showLoading(){},showResult(){},setAccountLabel(){},showApplied(){},showAccount(){},setStatus(){},showReady(){},close(){}});
 const ctx={document,window:{getSelection:()=>selection},location:{href:'https://x.com/home'},URL,chrome,crypto:{randomUUID:()=>`request-${++next}`},setTimeout,clearTimeout,setInterval,clearInterval,Symbol,MutationObserver:class{},globalThis:null};ctx.globalThis=ctx;
 vm.runInNewContext(readFileSync(new URL('../experiments/staging-no-debugger/content/composer-adapter.js',import.meta.url),'utf8'),ctx);
 Object.assign(ctx.ZaneReplyCopilotContent,{replyDetector:{findReplyControl:target=>target},postExtractor:{extractPost:article=>article.post},inlineAssistant:{mount:assistant}});
 vm.runInNewContext(readFileSync(new URL('../experiments/staging-no-debugger/content/content-script.js',import.meta.url),'utf8'),ctx);
 function post(id){const editor={isConnected:true,innerText:'',parentElement:{isConnected:true},closest:()=>null,contains(node){return node===this},focus(){document.activeElement=this},addEventListener(_n,cb){this.input=cb},removeEventListener(){}}; const article={isConnected:true,querySelectorAll:()=>[editor]};article.post={ok:true,article,statusId:id,sourceText:'post',sourceUrl:`https://x.com/test/status/${id}`};return {editor,article,control:{closest:selector=>selector==='article'?article:null}};}
 const reply={ok:true,result:{recommendation:'reply',defaultStyle:'natural',replies:{natural:'中文 English 😀\nline'}}};
 return {post,click:p=>{document.activeElement=p.editor;click({isTrusted:true,target:p.control})},resolve:i=>pending[i](reply),pending,commands:()=>commandCount,generations:()=>generationCount};
}
test('repeated clicks on one post generate and insert once',async()=>{
 const f=flow(),p=f.post('101');f.click(p);await sleep(0);f.click(p);await sleep(0);assert.equal(f.generations(),1);f.resolve(0);await sleep(110);assert.equal(f.commands(),1);assert.equal(p.editor.innerText,'中文 English 😀\nline');
});
test('switching posts or closing the composer during generation prevents stale insertion',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);await sleep(0);f.click(b);await sleep(0);f.resolve(0);await sleep(0);b.editor.isConnected=false;f.resolve(1);await sleep(110);assert.equal(f.commands(),0);assert.equal(a.editor.innerText,'');assert.equal(b.editor.innerText,'');
});
