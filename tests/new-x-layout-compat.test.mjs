import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('real Chrome: legacy and rebuilt X coexist; modern replies require exact parent and preserve drafts',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'xrh-dual-layout-'));
  try{
    const code=['post-extractor','reply-detector','composer-adapter','composer-association'].map(n=>
      readFileSync(new URL('../content/'+n+'.js',import.meta.url),'utf8')).join('\n');
    const run=()=>{
      const {postExtractor:p,replyDetector:r,composerAssociation:a,composerAdapter:c}=ZaneReplyCopilotContent;
      const $=id=>document.getElementById(id);
      const checks={};
      const legacy=$('legacy'),modern=$('modern');
      const old=p.extractPost(legacy),post=p.extractPost(modern);
      checks.legacy=old.ok&&old.statusId==='101'&&old.sourceText==='Legacy body'&&!old.modernLayout&&r.isReplyControl($('oldreply'));
      const hybrid=p.extractPost($('hybrid'));
      checks.hybridLegacy=hybrid.ok&&hybrid.statusId==='102'&&!hybrid.modernLayout&&hybrid.sourceText==='Hybrid legacy';
      checks.modern=post.ok&&post.statusId==='202'&&post.sourceText==='New body'&&post.modernLayout===true&&r.isReplyControl($('newreply'));
      checks.otherAction=!r.isReplyControl($('like'));
      checks.quoteNotSource=!p.extractPost($('quoted')).ok;
      checks.focal=p.extractPost($('focal')).statusId==='303';
      checks.conflict=!p.extractPost($('conflict')).ok;
      checks.siblingConflict=!p.extractPost($('siblingConflict')).ok;
      checks.untrustedLink=!p.extractPost($('bad')).ok;
      checks.ambiguousText=!p.extractPost($('ambiguous')).ok;
      const base=a.baseline(document,post);
      const dlg=document.createElement('div');dlg.setAttribute('role','dialog');document.body.append(dlg);
      dlg.innerHTML='<article><a aria-hidden="true" href="https://x.com/new/status/202"></a><div dir="auto" class="whitespace-pre-wrap">New body</div></article><textarea aria-label="Reply"></textarea>';
      const ed=dlg.querySelector('textarea');ed.focus();
      const facts=()=>a.snapshot(document,post,'https://x.com/home','https://x.com/compose/post',20);
      const newAssoc=()=>a.create({trusted:true,statusId:'202',requestId:'r',now:0,...base});
      checks.baseline=base.baselineModalCount===0;
      checks.bound=newAssoc().evaluate(facts()).editor===ed;
      checks.legacyNotTextarea=a.snapshot(document,old,'https://x.com/home','https://x.com/compose/post',20).editors.length===0;
      const link=dlg.querySelector('a');link.href='https://x.com/other/status/999';
      checks.differentParent=newAssoc().evaluate(facts()).state==='rejected';
      link.remove();
      checks.noId=newAssoc().evaluate(facts()).state==='waiting';
      dlg.querySelector('article').prepend(link);link.href='https://x.com/new/status/202';
      const extra=document.createElement('textarea');extra.setAttribute('aria-label','Other');dlg.append(extra);
      checks.multiple=newAssoc().evaluate(facts()).reason==='multiple_editors';extra.remove();
      ed.value=' ';checks.draft=newAssoc().evaluate(facts()).reason==='existing_draft';
      ed.value='';ed.readOnly=true;checks.readonly=newAssoc().evaluate(facts()).state==='rejected';ed.readOnly=false;
      const other=document.createElement('input');dlg.append(other);other.focus();
      checks.noFocus=newAssoc().evaluate(facts()).reason==='awaiting_editor_focus';other.remove();ed.focus();
      const assoc=newAssoc();checks.verified=assoc.evaluate(facts()).editor===ed;
      let inputs=0;ed.addEventListener('input',()=>inputs++);
      const valid=()=>assoc.evaluate(facts()).editor===ed&&!c.hasContent(ed);
      checks.insert=c.focusEmpty(ed)&&c.insertOnce(ed,'once','new draft',valid)&&ed.value==='new draft'&&inputs===1&&c.readText(ed)==='new draft';
      ed.value='';checks.once=!c.insertOnce(ed,'once','duplicate',valid);
      ed.value='existing';checks.preserve=!c.focusEmpty(ed)&&!c.insertOnce(ed,'other','overwrite',()=>true)&&ed.value==='existing';
      ed.value='';checks.stale=!c.insertOnce(ed,'stale','wrong',()=>false)&&ed.value==='';
      dlg.remove();
      const wrapper=document.createElement('div');wrapper.setAttribute('role','link');wrapper.setAttribute('data-href','/real/status/808');
      wrapper.innerHTML='<article><div dir="auto" class="whitespace-pre-wrap">Actual modern body</div><div data-engagement-action="reply"><a href="/compose/post?in_reply_to=808" aria-label="0 Replies. Reply"><span id="replyIcon">icon</span></a></div></article>';
      document.body.append(wrapper);
      const action=wrapper.querySelector('a'),outer=wrapper.querySelector('article'),source=p.extractPost(outer);
      checks.realNestedLink=r.findReplyControl(wrapper.querySelector('#replyIcon'))===action&&r.replyTargetId(action)===source.statusId;
      action.href='https://example.com/compose/post?in_reply_to=808';checks.externalAction=!r.isReplyControl(action);
      action.href='/compose/post?in_reply_to=808&in_reply_to=808';checks.duplicateAction=!r.isReplyControl(action);
      action.href='/compose/post?in_reply_to=808&quote=999';checks.quoteAction=!r.isReplyControl(action);
      action.href='/compose/post?in_reply_to=808';
      const routePost=a.capturePost({...source,replyRouteVerified:true});
      const routeBase=a.baseline(document,routePost);
      const portal=document.createElement('div');portal.setAttribute('data-base-ui-portal','');
      portal.innerHTML='<div role="dialog" data-slot="xds-modal-surface"><div dir="auto" class="whitespace-pre-wrap">Actual modern body</div><div data-media-upload-dropzone><form><div><div class="whitespace-pre-wrap" aria-hidden="true" style="white-space:pre-wrap"></div><textarea aria-label="Post your reply" style="color:transparent"></textarea></div><button type="button">Reply</button></form></div></div>';
      document.body.append(portal);
      const e=portal.querySelector('textarea'),preview=portal.querySelector('[role="dialog"] > div'),mirror=e.previousElementSibling;
      e.focus();
      const start='https://x.com/home',route='https://x.com/compose/post?in_reply_to=808';
      const assocRoute=()=>a.create({trusted:true,statusId:'808',requestId:'real',now:0,...routeBase});
      const snap=(url=route,post=routePost,quarantine=[])=>a.snapshot(document,post,start,url,20,quarantine);
      checks.linklessRoute=assocRoute().evaluate(snap()).editor===e&&snap().editors[0].contextDetail==='verified_route_preview';
      checks.noRoute=assocRoute().evaluate(snap('https://x.com/compose/post')).state==='waiting';
      checks.noClickLink=assocRoute().evaluate(snap(route,{...routePost,replyRouteVerified:false})).state==='waiting';
      checks.wrongRoute=assocRoute().evaluate(snap('https://x.com/compose/post?in_reply_to=999')).reason==='route_changed';
      checks.duplicateRoute=assocRoute().evaluate(snap(route+'&in_reply_to=808')).reason==='route_changed';
      checks.quoteRoute=assocRoute().evaluate(snap(route+'&quote=999')).reason==='route_changed';
      preview.textContent='stale preview';checks.stalePreview=assocRoute().evaluate(snap()).state==='waiting';preview.textContent='Actual modern body';
      checks.quarantine=assocRoute().evaluate(snap(route,routePost,[{statusId:'999',sourceText:'Actual modern body'}])).state==='rejected';
      const extraPreview=preview.cloneNode(true);preview.after(extraPreview);
      checks.ambiguousPreview=assocRoute().evaluate(snap()).state==='rejected';extraPreview.remove();
      const badLink=document.createElement('a');badLink.setAttribute('aria-hidden','true');badLink.href='/real/status/999';preview.before(badLink);
      checks.conflictingLinklessId=assocRoute().evaluate(snap()).state==='rejected';badLink.remove();
      const originalPhoto=document.createElement('img');originalPhoto.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';preview.append(originalPhoto);
      checks.originalMediaNotDraft=!c.hasContent(e);
      const upload=document.createElement('img');upload.src='blob:https://x.com/fixture';e.closest('form').append(upload);
      checks.attachmentDraft=c.hasContent(e)&&assocRoute().evaluate(snap()).reason==='existing_draft';upload.remove();
      e.setAttribute('aria-readonly','true');checks.ariaReadOnly=assocRoute().evaluate(snap()).state==='rejected';e.removeAttribute('aria-readonly');
      const active=assocRoute();checks.boundRoute=active.evaluate(snap()).editor===e;
      checks.sameEditorDifferentTarget=active.evaluate(snap('https://x.com/compose/post?in_reply_to=999')).state==='rejected';
      let model='',events=0;
      e.addEventListener('input',()=>{events++;model=e.value;mirror.textContent=model;});
      const live=assocRoute();live.evaluate(snap());
      const safe=()=>live.evaluate(snap()).editor===e&&!c.hasContent(e);
      checks.controlledMirror=c.focusEmpty(e)&&c.insertOnce(e,'native-mirror','Hello 中文 😀\nline',safe)&&events===1&&model===e.value&&c.verifyReadback(e,'Hello 中文 😀\nline');
      mirror.textContent='not synchronized';checks.mirrorMismatch=!c.verifyReadback(e,e.value);
      e.value='';mirror.textContent='';checks.noDuplicateNative=!c.insertOnce(e,'native-mirror','again',safe)&&events===1;
      $('result').textContent=JSON.stringify(checks);
    };
    const html='<!doctype html><html data-app-version="fixture"><head><base href="https://x.com/home"></head><body>'+
      '<article id="legacy" data-testid="tweet"><a href="https://x.com/old/status/101"><time>now</time></a><div data-testid="tweetText">Legacy body</div><button id="oldreply" data-testid="reply">Reply</button></article>'+
      '<article id="hybrid"><a href="https://x.com/old/status/102"><time>now</time></a><div data-testid="tweetText">Hybrid legacy</div></article>'+
      '<div role="link" data-href="/new/status/202"><article id="modern"><div dir="auto" class="whitespace-pre-wrap">New body</div><button id="newreply" data-engagement-action="reply">2</button><button id="like" data-engagement-action="like" aria-label="Reply">Like</button><div data-slot="embedded-tweet-frame"><div role="link" data-href="https://x.com/quote/status/909"><article id="quoted"><div dir="auto" class="whitespace-pre-wrap">quoted</div></article></div></div></article></div>'+
      '<article id="focal"><a aria-hidden="true" href="https://x.com/new/status/303"></a><div dir="auto" class="whitespace-pre-wrap">Focal</div></article>'+
      '<div role="link" data-href="https://x.com/new/status/404"><article id="conflict"><a aria-hidden="true" href="https://x.com/new/status/405"></a><div dir="auto" class="whitespace-pre-wrap">Conflict</div></article></div>'+
      '<div role="link" data-href="/new/status/501"><a aria-hidden="true" href="/new/status/502"></a><article id="siblingConflict"><div dir="auto" class="whitespace-pre-wrap">Sibling conflict</div></article></div>'+
      '<div role="link" data-href="https://example.com/new/status/606"><article id="bad"><div dir="auto" class="whitespace-pre-wrap">External</div></article></div>'+
      '<div role="link" data-href="https://x.com/new/status/707"><article id="ambiguous"><div dir="auto" class="whitespace-pre-wrap">A</div><div dir="auto" class="whitespace-pre-wrap">B</div></article></div>'+
      '<output id="result"></output><script>'+code+'</script><script>('+run.toString()+')()</script></body></html>';
    const file=path.join(dir,'fixture.html');writeFileSync(file,html);
    const browser=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const result=spawnSync(browser,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--user-data-dir='+path.join(dir,'profile'),'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:25000,maxBuffer:2*1024*1024});
    assert.equal(result.status,0,result.stderr);
    const match=result.stdout.match(/<output id="result">(\{[^<]+\})<\/output>/);
    assert.ok(match,result.stdout.slice(-1000));
    const checks=JSON.parse(match[1]);assert.equal(Object.keys(checks).length,46);
    assert.deepEqual(Object.entries(checks).filter(([,v])=>!v),[]);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
