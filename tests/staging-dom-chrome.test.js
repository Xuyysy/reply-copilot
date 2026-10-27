import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('Chrome editing events preserve controlled state and undo in an isolated local fixture',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'reply-composer-'));
 try {
  const adapter=readFileSync(new URL('../experiments/staging-no-debugger/content/composer-adapter.js',import.meta.url),'utf8');
  const html=`<!doctype html><html><body><div id="editor" contenteditable="true" role="textbox"></div><output id="result">pending</output><script>${adapter}</script><script>
  const editor=document.querySelector('#editor'),output=document.querySelector('#result');let state='',events=0;
  editor.addEventListener('input',()=>{state=editor.innerText;events++});editor.focus();
  const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  const text='中文 English 😀\\nsecond line';
  const ok=ZaneReplyCopilotContent.composerAdapter.insertOnce(editor,'fixture-request',text,()=>true);
  const accepted=ok && editor.innerText===text && state===text && events>0;
  const edited=document.execCommand('insertText',false,'!') && state.endsWith('!');
  const undo=document.execCommand('undo') && !editor.innerText.endsWith('!') && state===editor.innerText;
  output.textContent=JSON.stringify({accepted,edited,undo});</script></body></html>`;
  const file=path.join(dir,'fixture.html');writeFileSync(file,html);
  const chrome=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const result=spawnSync(chrome,['--headless=new','--disable-gpu',`--user-data-dir=${path.join(dir,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/\{"accepted":true,"edited":true,"undo":true\}/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
