import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const editor = { isConnected:true, innerText:'', contains(node) { return node === this; }, focus() { document.activeElement=this; } };
  const selection = { anchorNode:editor, focusNode:editor, isCollapsed:true, removeAllRanges(){}, addRange(){} };
  let calls=0, pasteCalls=0, commandCalls=0;
  const document = { activeElement:editor, execCommand(command,ui,text) { commandCalls++; assert.equal(command,'insertText'); assert.equal(ui,false); calls++; editor.innerText=text; return true; } };
  editor.dispatchEvent=event=>{pasteCalls++;event.preventDefault();editor.innerText=event.clipboardData.getData('text/plain');calls++;return false;};
  class DataTransfer {setData(type,text){this[type]=text;}getData(type){return this[type]||'';}}
  class ClipboardEvent extends Event {constructor(type,options){super(type,options);this.clipboardData=options.clipboardData;}}
  const ctx={DataTransfer,ClipboardEvent,document,window:{getSelection:()=>selection},globalThis:null}; ctx.globalThis=ctx;
  vm.runInNewContext(readFileSync(new URL('../experiments/staging-no-debugger/content/composer-adapter.js',import.meta.url),'utf8'),ctx);
  return {editor,selection,document,adapter:ctx.ZaneReplyCopilotContent.composerAdapter,calls:()=>calls,pasteCalls:()=>pasteCalls,commandCalls:()=>commandCalls};
}
test('staging input asks the controlled editor to paste once',()=>{
 const f=fixture(); const text='中文 English 😀\nsecond line';
 assert.equal(f.adapter.insertOnce(f.editor,'request-1',text,()=>true),true);
 assert.equal(f.editor.innerText,text); assert.equal(f.calls(),1);
 assert.equal(f.adapter.insertOnce(f.editor,'request-1',text,()=>true),false); assert.equal(f.calls(),1);
});
test('staging input rejects existing drafts, stale requests, detached editors and unsafe selections',()=>{
 for(const setup of [f=>f.editor.innerText='my draft',f=>f.editor.innerText=' ',f=>f.editor.isConnected=false,f=>f.selection.anchorNode={},f=>f.selection.focusNode={},f=>f.selection.isCollapsed=false,f=>f.document.activeElement={}]) {
  const f=fixture(); setup(f); assert.equal(f.adapter.insertOnce(f.editor,'request-2','hello',()=>true),false); assert.equal(f.calls(),0);
 }
 const f=fixture(); assert.equal(f.adapter.insertOnce(f.editor,'request-2','hello',()=>false),false); assert.equal(f.calls(),0);
});
test('unhandled paste is never retried or followed by a native insertion',()=>{
 const f=fixture(); let calls=0; f.editor.dispatchEvent=()=>{calls++;return true;};
 assert.equal(f.adapter.insertOnce(f.editor,'request-3','hello',()=>true),false);
 assert.equal(f.adapter.insertOnce(f.editor,'request-3','hello',()=>true),false); assert.equal(calls,1); assert.equal(f.commandCalls(),0);
});
test('X structural single BR is empty, but user whitespace, extra breaks and attachments stay protected',()=>{
 const f=fixture();Object.assign(f.editor,{innerText:'\n',textContent:'',querySelector:()=>null,querySelectorAll:()=>[{}]});
 assert.equal(f.adapter.hasContent(f.editor),false);
 for(const update of [{textContent:' '},{textContent:'',innerText:'\n\n',querySelectorAll:()=>[{},{}]},{innerText:'\n',textContent:'',querySelector:()=>({})}]){
  Object.assign(f.editor,update);assert.equal(f.adapter.hasContent(f.editor),true);
 }
});

test('X input sends one plain-text paste to the page handler without native command insertion',()=>{const f=fixture();assert.equal(f.adapter.insertOnce(f.editor,'paste-only','hello',()=>true),true);assert.equal(f.pasteCalls(),1);assert.equal(f.commandCalls(),0);});
