import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const editor = { isConnected:true, innerText:'', contains(node) { return node === this; }, focus() { document.activeElement=this; } };
  const selection = { anchorNode:editor, focusNode:editor, isCollapsed:true, removeAllRanges(){}, addRange(){} };
  let calls=0;
  const document = { activeElement:editor, execCommand(command,ui,text) { assert.equal(command,'insertText'); assert.equal(ui,false); calls++; editor.innerText=text; return true; } };
  const ctx={document,window:{getSelection:()=>selection},globalThis:null}; ctx.globalThis=ctx;
  vm.runInNewContext(readFileSync(new URL('../experiments/staging-no-debugger/content/composer-adapter.js',import.meta.url),'utf8'),ctx);
  return {editor,selection,document,adapter:ctx.ZaneReplyCopilotContent.composerAdapter,calls:()=>calls};
}
test('staging input inserts once through the browser editing command',()=>{
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
test('failed editing command is never retried for the same request',()=>{
 const f=fixture(); let calls=0; f.document.execCommand=()=>{calls++;return false;};
 assert.equal(f.adapter.insertOnce(f.editor,'request-3','hello',()=>true),false);
 assert.equal(f.adapter.insertOnce(f.editor,'request-3','hello',()=>true),false); assert.equal(calls,1);
});
test('X structural single BR is empty, but user whitespace, extra breaks and attachments stay protected',()=>{
 const f=fixture();Object.assign(f.editor,{innerText:'\n',textContent:'',querySelector:()=>null,querySelectorAll:()=>[{}]});
 assert.equal(f.adapter.hasContent(f.editor),false);
 for(const update of [{textContent:' '},{textContent:'',innerText:'\n\n',querySelectorAll:()=>[{},{}]},{innerText:'\n',textContent:'',querySelector:()=>({})}]){
  Object.assign(f.editor,update);assert.equal(f.adapter.hasContent(f.editor),true);
 }
});
