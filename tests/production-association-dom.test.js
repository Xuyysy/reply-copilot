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
  const code=['content/post-extractor.js','content/composer-adapter.js','content/composer-association.js'].map(p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')).join('\n');
  const html=`<!doctype html><html><body><main id="feed"></main><section id="modals"></section><output id="result"></output><script>${code}</script><script>
  const api=ZaneReplyCopilotContent,results=[];
  function source(id){const a=document.createElement('article');a.innerHTML='<a href="https://x.com/example/status/'+id+'">time</a><div data-testid="tweetText">same text</div>';document.querySelector('#feed').append(a);return a;}
  function modal(id){const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<div role="dialog"><article>'+(id?'<a href="https://x.com/example/status/'+id+'">time</a>':'')+'<div data-testid="tweetText">same text</div></article><div role="textbox" contenteditable="true"></div></div>';document.querySelector('#modals').append(d);return d.querySelector('[contenteditable]');}
  const home=document.createElement('div');home.contentEditable='true';home.setAttribute('role','textbox');document.querySelector('#feed').append(home);
  const original=source('101');source('102');const post=api.postExtractor.extractPost(original),initial='https://x.com/home';
  const b=api.composerAssociation.baseline(document),s=api.composerAssociation.create({trusted:true,statusId:post.statusId,requestId:'one',now:0,...b});
  results.push({name:'home_composer_is_not_reply_ui',ok:b.visibleEditorCount===1&&b.visibleReplyEditorCount===0&&b.baselineModalCount===0&&b.baselineEditors.includes(home)});
  original.remove();const editor=modal();editor.focus();
  let f=api.composerAssociation.snapshot(document,post,initial,'https://x.com/compose/post',10),r=s.evaluate(f);
  const modalBaseline=api.composerAssociation.baseline(document);results.push({name:'reply_editor_count_excludes_home_composer',ok:modalBaseline.visibleEditorCount===2&&modalBaseline.visibleReplyEditorCount===1});
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
  document.querySelector('#modals').replaceChildren();const shell=document.createElement('div');shell.setAttribute('role','dialog');shell.innerHTML='<div role="textbox" contenteditable="true"></div>';document.querySelector('#modals').append(shell);
  const emptyShell=api.composerAssociation.snapshot(document,wrongPost,initial,initial,10);results.push({name:'modal_shell_waits_for_source_article',ok:emptyShell.editors.length===1&&emptyShell.editors[0].contextMatches===null&&emptyShell.editors[0].contextStatusId===null});
  // The X quote preview is often a nested [data-testid=quoteTweet]
  // WITHOUT its own article. Its different /status/ is not the parent.
  document.querySelector('#modals').replaceChildren();
  const quotedSource=source('107');
  quotedSource.insertAdjacentHTML('beforeend','<div data-testid="quoteTweet"><a href="https://x.com/other/status/991">quoted</a><div data-testid="tweetText">different quote text</div></div>');
  const quotedPost=api.composerAssociation.capturePost(api.postExtractor.extractPost(quotedSource));
  const quotedEditor=modal();quotedEditor.focus();
  quotedEditor.closest('[role="dialog"]').querySelector('article').insertAdjacentHTML('beforeend','<div data-testid="quoteTweet"><a href="https://x.com/other/status/991">quoted</a><div data-testid="tweetText">different quote text</div></div>');
  const quotedFacts=api.composerAssociation.snapshot(document,quotedPost,initial,initial,10);
  results.push({name:'quoted_card_status_link_is_not_parent',ok:quotedPost.statusId==='107'&&quotedPost.sourceText==='same text'&&quotedFacts.editors[0].contextStatusId===null&&quotedFacts.editors[0].contextMatches===true});
  document.querySelector('#modals').replaceChildren();
  const nestedEditor=modal();nestedEditor.focus();
  nestedEditor.closest('[role="dialog"]').querySelector('article').insertAdjacentHTML('beforeend','<article data-testid="quoteTweet"><a href="https://x.com/other/status/992">quote</a><div data-testid="tweetText">quoted inner article</div></article>');
  const nestedFacts=api.composerAssociation.snapshot(document,quotedPost,initial,initial,10);
  results.push({name:'nested_quote_article_ignored',ok:nestedFacts.editors[0].contextArticleCount===1&&nestedFacts.editors[0].contextMatches===true});
  document.querySelector('#modals').replaceChildren();
  const videoSource=source('108');videoSource.insertAdjacentHTML('beforeend','<div data-testid="videoPlayer">media</div>');
  const videoPost=api.composerAssociation.capturePost(api.postExtractor.extractPost(videoSource));
  const videoEditor=modal();videoEditor.focus();
  videoEditor.closest('[role="dialog"]').querySelector('[data-testid="tweetText"]').textContent='same text pic.x.com/Abcd';
  const videoFacts=api.composerAssociation.snapshot(document,videoPost,initial,initial,10);
  results.push({name:'text_with_video_media_suffix',ok:videoPost.hasCapturedMedia===true&&videoFacts.editors[0].contextMatches===true});
  document.querySelector('#modals').replaceChildren();
  const photosSource=source('109');photosSource.insertAdjacentHTML('beforeend','<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/mock.jpg"></div>');
  const photosPost=api.composerAssociation.capturePost(api.postExtractor.extractPost(photosSource));
  const photosEditor=modal();photosEditor.focus();
  photosEditor.closest('[role="dialog"]').querySelector('[data-testid="tweetText"]').textContent='same text pic.x.com/Abcd pic.x.com/EFgh';
  const photosFacts=api.composerAssociation.snapshot(document,photosPost,initial,initial,10);
  results.push({name:'multiple_photo_media_suffixes',ok:photosPost.hasCapturedMedia===true&&photosFacts.editors[0].contextMatches===true});
  document.querySelector('#modals').replaceChildren();
  const wrongEditor=modal('991');wrongEditor.focus();
  const wrongFacts=api.composerAssociation.snapshot(document,quotedPost,initial,initial,10);
  results.push({name:'explicit_other_post_identity_still_rejected',ok:wrongFacts.editors[0].contextStatusId==='991'&&wrongFacts.editors[0].contextMatches===false});
  // X can present a quote as a generic role=link card with its OWN
  // timestamp; it must not override the parent without an explicit testid.
  document.querySelector('#modals').replaceChildren();
  const roleQuote='<div role="link" tabindex="0"><div data-testid="User-Name"><span>@quoted</span></div><a href="https://x.com/other/status/993"><time>Nov 11</time></a><div data-testid="tweetText">a different quote</div></div>';
  const roleSource=source('110');roleSource.insertAdjacentHTML('beforeend',roleQuote);
  const rolePost=api.composerAssociation.capturePost(api.postExtractor.extractPost(roleSource));
  const roleEditor=modal();roleEditor.focus();
  roleEditor.closest('[role="dialog"]').querySelector('article').insertAdjacentHTML('beforeend',roleQuote);
  const roleFacts=api.composerAssociation.snapshot(document,rolePost,initial,initial,10);
  results.push({name:'role_link_quote_with_timestamp_excluded',ok:rolePost.statusId==='110'&&rolePost.sourceText==='same text'&&roleFacts.editors[0].contextStatusId===null&&roleFacts.editors[0].contextMatches===true});
  document.querySelector('#result').textContent=JSON.stringify(results);
  </script></body></html>`;
  const file=path.join(dir,'fixture.html');writeFileSync(file,html);
  const chrome=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const result=spawnSync(chrome,['--headless=new','--disable-gpu',`--user-data-dir=${path.join(dir,'profile')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,`${result.stderr} ${result.error?.message||''} ${result.signal||''}`);
  const output=result.stdout.match(/<output id="result">([^<]+)<\/output>/)?.[1];assert.ok(output,'fixture must finish');
  const results=JSON.parse(output);assert.equal(results.length,20);for(const r of results)assert.equal(r.ok,true,r.name);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
