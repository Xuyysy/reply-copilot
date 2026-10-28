import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('real Chrome DOM snapshots handle nested no-link modals, hidden editors, identity conflicts, and removed source',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-association-dom-'));
 try {
  const code=['content/post-extractor.js','experiments/staging-no-debugger/content/composer-adapter.js','experiments/staging-no-debugger/content/composer-association.js'].map(p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')).join('\n');
  const html=`<!doctype html><html><body><main id="feed"></main><section id="modals"></section><output id="result"></output><script>${code}</script><script>
  const api=ZaneReplyCopilotContent,results=[];
  function source(id){const a=document.createElement('article');a.innerHTML='<a href="https://x.com/example/status/'+id+'">time</a><div data-testid="tweetText">same text</div>';document.querySelector('#feed').append(a);return a;}
  function modal(id){const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<div role="dialog"><article>'+(id?'<a href="https://x.com/example/status/'+id+'">time</a>':'')+'<div data-testid="tweetText">same text</div></article><div role="textbox" contenteditable="true"></div></div>';document.querySelector('#modals').append(d);return d.querySelector('[contenteditable]');}
  const original=source('101');source('102');const post=api.postExtractor.extractPost(original),initial='https://x.com/home';
  const b=api.composerAssociation.baseline(document),s=api.composerAssociation.create({trusted:true,statusId:post.statusId,requestId:'one',now:0,...b});
  original.remove();const editor=modal();editor.focus();
  let f=api.composerAssociation.snapshot(document,post,initial,'https://x.com/compose/post',10),r=s.evaluate(f);
  results.push({name:'nested_detached_no_link',ok:r.state==='bound'&&r.editor===editor&&f.editors.length===1&&s.statusId==='101'});
  const hidden=modal();hidden.closest('[role="dialog"]').hidden=true;
  f=api.composerAssociation.snapshot(document,post,initial,'https://x.com/compose/post',20);results.push({name:'hidden_ignored',ok:f.editors.length===1});
  editor.closest('[role="dialog"]').querySelector('article').insertAdjacentHTML('afterbegin','<a href="https://x.com/example/status/102">wrong</a>');
  r=s.evaluate(api.composerAssociation.snapshot(document,post,initial,'https://x.com/compose/post',30));results.push({name:'identity_conflict',ok:r.reason==='context_identity_conflict'});
  document.querySelector('#modals').replaceChildren();const p2=api.postExtractor.extractPost(source('103'));
  const s2=api.composerAssociation.create({trusted:true,statusId:'103',requestId:'two',now:0,...api.composerAssociation.baseline(document)});
  const draft=modal();draft.textContent='user text';draft.focus();r=s2.evaluate(api.composerAssociation.snapshot(document,p2,initial,initial,10));results.push({name:'draft_protected',ok:r.reason==='existing_draft'&&draft.textContent==='user text'});
  const old=api.composerAssociation.create({trusted:true,statusId:'103',requestId:'three',now:0,...api.composerAssociation.baseline(document)});results.push({name:'preexisting_modal',ok:old.evaluate(api.composerAssociation.snapshot(document,p2,initial,initial,10)).reason==='preexisting_modal'});
  document.querySelector('#modals').replaceChildren();
  const mediaOriginal=source('104');mediaOriginal.insertAdjacentHTML('beforeend','<a href="https://x.com/example/status/104/photo/1">photo</a>');
  const mediaPost=api.composerAssociation.capturePost?.(api.postExtractor.extractPost(mediaOriginal))||api.postExtractor.extractPost(mediaOriginal);
  mediaOriginal.remove();
  for(const [name,suffix,expected] of [['photo_rendered_url',' https:// pic.x.com/Ab123',true],['photo_plain_url',' pic.x.com/Ab123',true],['arbitrary_url',' https://evil.example/Ab123',false],['extra_words',' changed pic.x.com/Ab123',false]]){
   document.querySelector('#modals').replaceChildren();const e=modal();e.closest('[role="dialog"]').querySelector('[data-testid="tweetText"]').textContent='same text'+suffix;e.focus();
   const facts=api.composerAssociation.snapshot(document,mediaPost,initial,initial,10);results.push({name,ok:facts.editors[0].contextMatches===expected});
  }
  document.querySelector('#modals').replaceChildren();const nonMedia=api.postExtractor.extractPost(source('105')),e=modal();e.closest('[role="dialog"]').querySelector('[data-testid="tweetText"]').textContent='same text https:// pic.x.com/Ab123';e.focus();
  results.push({name:'no_captured_photo_rejects_suffix',ok:api.composerAssociation.snapshot(document,nonMedia,initial,initial,10).editors[0].contextMatches===false});
  const wrongPhoto=source('106');wrongPhoto.insertAdjacentHTML('beforeend','<a href="https://x.com/example/status/999/photo/1">photo</a>');
  const wrongPost=api.composerAssociation.capturePost?.(api.postExtractor.extractPost(wrongPhoto))||api.postExtractor.extractPost(wrongPhoto);
  results.push({name:'another_status_photo_is_not_evidence',ok:api.composerAssociation.snapshot(document,wrongPost,initial,initial,10).editors[0].contextMatches===false});
  document.querySelector('#result').textContent=JSON.stringify(results);
  </script></body></html>`;
  const file=path.join(dir,'fixture.html');writeFileSync(file,html);
  const chrome=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const result=spawnSync(chrome,['--headless=new','--disable-gpu',`--user-data-dir=${path.join(dir,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
  const output=result.stdout.match(/<output id="result">([^<]+)<\/output>/)?.[1];assert.ok(output,'fixture must finish');
  const results=JSON.parse(output);assert.equal(results.length,11);for(const r of results)assert.equal(r.ok,true,r.name);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
