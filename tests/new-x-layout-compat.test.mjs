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
      // A legacy article on a mixed page must still use its original
      // testid/label behavior, not the modern ancestor/route rules.
      const legacyAction=document.createElement('div');legacyAction.setAttribute('data-engagement-action','like');
      legacyAction.innerHTML='<button aria-label="Reply">legacy localized label</button><a data-engagement-action="reply" href="/old-compose">legacy own action</a><button data-testid="reply">legacy testid</button><a href="/compose/post?in_reply_to=101">unmarked legacy anchor</a>';
      legacy.append(legacyAction);
      checks.legacyMixedLabel=r.isReplyControl(legacyAction.children[0]);
      checks.legacyOwnAction=r.isReplyControl(legacyAction.children[1]);
      checks.legacyTestIdWins=r.isReplyControl(legacyAction.children[2]);
      checks.legacyNoAncestorInference=!r.isReplyControl(legacyAction.children[3]);
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
      // Actual captioned quote report: the modal has one plain article
      // for the embedded content, and one bare outer caption. No frame.
      portal.remove();
      const qWrap=document.createElement('div');qWrap.setAttribute('role','link');qWrap.setAttribute('data-href','/outer/status/818');
      qWrap.innerHTML='<article><div dir="auto" class="whitespace-pre-wrap">Outer caption</div><div role="link" data-slot="embedded-tweet-frame" data-href="/quoted/status/919"><a aria-hidden="true" href="/quoted/status/919"></a><article><div dir="auto" class="whitespace-pre-wrap">Quoted body</div></article></div><div data-engagement-action="reply"><a href="/compose/post?in_reply_to=818">Reply</a></div></article>';
      document.body.append(qWrap);
      const qp=a.capturePost({...p.extractPost(qWrap.querySelector('article')),replyRouteVerified:true});
      const qb=a.baseline(document,qp),qd=document.createElement('div');qd.setAttribute('role','dialog');
      qd.innerHTML='<form><div dir="auto" class="whitespace-pre-wrap">Outer caption</div><article><div dir="auto" class="whitespace-pre-wrap">Quoted body</div></article><textarea aria-label="Reply"></textarea></form>';
      document.body.append(qd);const qe=qd.querySelector('textarea'),qa=qd.querySelector('article'),qc=qd.querySelector('form > div'),qt=qa.firstElementChild;
      qe.focus();
      const qr='https://x.com/compose/post?in_reply_to=818';
      const qs=(post=qp,url=qr,quarantine=[])=>a.snapshot(document,post,start,url,20,quarantine);
      const qnew=()=>a.create({trusted:true,statusId:'818',requestId:'quote',now:0,...qb});
      checks.quoteCaptured=qp.modernCaptionQuote?.id==='919'&&qp.modernCaptionQuote?.text==='Quoted body'&&qp.sourceText==='Outer caption';
      checks.unmarkedQuote=qnew().evaluate(qs()).editor===qe;
      checks.quoteOuterId=qs().editors[0].contextStatusId==='818'&&qs().editors[0].contextDetail==='verified_route_preview';
      checks.quoteWrongRoute=qnew().evaluate(qs(qp,'https://x.com/compose/post?in_reply_to=919')).state==='rejected';
      checks.quoteNoTrustedLink=qnew().evaluate(qs({...qp,replyRouteVerified:false})).state==='rejected';
      qt.textContent='Unrelated quote';checks.quoteWrongText=qnew().evaluate(qs()).state==='rejected';qt.textContent='Quoted body';
      qc.textContent='Unrelated caption';checks.quoteWrongCaption=qnew().evaluate(qs()).state==='rejected';qc.textContent='Outer caption';
      const qaLink=document.createElement('a');qaLink.setAttribute('aria-hidden','true');qaLink.href='/other/status/999';qa.prepend(qaLink);
      checks.quoteWrongId=qnew().evaluate(qs()).state==='rejected';qaLink.href='/quoted/status/919';
      checks.quoteMatchingId=qnew().evaluate(qs()).editor===qe;qaLink.remove();
      qa.before(qa.cloneNode(true));checks.quoteExtraArticle=qnew().evaluate(qs()).state==='rejected';qd.querySelector('article').remove();
      qe.before(qc);checks.quoteReversedOrder=qnew().evaluate(qs()).state==='rejected';qa.before(qc);
      checks.quoteQuarantined=qnew().evaluate(qs(qp,qr,[{statusId:'999',sourceText:'Outer caption'}])).state==='rejected';
      qe.value='draft';checks.quoteDraft=qnew().evaluate(qs()).reason==='existing_draft';qe.value='';
      checks.quoteWithoutCapturedEvidence=qnew().evaluate(qs({...qp,modernCaptionQuote:null})).state==='rejected';
      const qBound=qnew();qBound.evaluate(qs());qt.textContent='Changed quote';checks.quoteChangedAfterBind=qBound.evaluate(qs()).state==='rejected';qt.textContent='Quoted body';
      qc.remove();const hydrating=qnew();qa.prepend(qaLink);qaLink.href='/quoted/status/919';
      checks.quoteHydrating=hydrating.evaluate(qs()).state==='waiting';
      qa.before(qc);checks.quoteHydrated=hydrating.evaluate(qs()).editor===qe;qaLink.remove();
      // A translator can change the feed's display text after capture.
      // Retain the original identity and frozen matching modal evidence.
      const feedCaption=qWrap.querySelector('article > div[dir="auto"]');
      feedCaption.textContent='Translated feed caption';checks.quoteSourceIdentityStable=qnew().evaluate(qs()).editor===qe;feedCaption.textContent='Outer caption';
      qWrap.setAttribute('data-href','/other/status/999');checks.quoteSourceRecycled=qnew().evaluate(qs()).reason==='source_changed';qWrap.setAttribute('data-href','/outer/status/818');
      qd.remove();
      // Independently rolled-out native editor on a legacy post. Strong
      // structure + trusted route required; old paths remain identical.
      const mixedAnchor=document.createElement('div');mixedAnchor.setAttribute('data-engagement-action','reply');
      mixedAnchor.innerHTML='<a href="/compose/post?in_reply_to=101">Reply</a>';legacy.append(mixedAnchor);
      checks.hybridReply=r.isReplyControl(mixedAnchor.firstElementChild)&&r.replyTargetId(mixedAnchor.firstElementChild)==='101';
      const mixedPost=a.capturePost({...p.extractPost(legacy),replyRouteVerified:true});
      const mixedBase=a.baseline(document,mixedPost);
      const md=document.createElement('div');md.setAttribute('role','dialog');md.setAttribute('data-slot','xds-modal-surface');
      md.innerHTML='<div data-testid="tweetText">Legacy body</div><div data-media-upload-dropzone><form><textarea aria-label="Reply"></textarea></form></div>';
      document.body.append(md);const me=md.querySelector('textarea');me.focus();
      const ms=(post=mixedPost,url='https://x.com/compose/post?in_reply_to=101')=>a.snapshot(document,post,start,url,20);
      const mn=()=>a.create({trusted:true,statusId:'101',requestId:'mixed',now:0,...mixedBase});
      checks.hybridNative=mn().evaluate(ms()).editor===me;
      checks.hybridNoTrustedRoute=ms({...mixedPost,replyRouteVerified:false}).editors.length===0;
      checks.hybridWrongRoute=mn().evaluate(ms(mixedPost,'https://x.com/compose/post?in_reply_to=999')).state==='rejected';
      md.removeAttribute('data-slot');checks.hybridNoComposerProof=ms().editors.length===0;md.setAttribute('data-slot','xds-modal-surface');
      me.value='draft';checks.hybridDraft=mn().evaluate(ms()).reason==='existing_draft';me.value='';
      const mb=md.querySelector('[data-testid="tweetText"]');mb.textContent='Other post';checks.hybridStale=mn().evaluate(ms()).state==='waiting';mb.textContent='Legacy body';
      md.remove();
      // Quote-only feed has a separate outer ID, but modal can omit its
      // marked frame and display only the unlinked embedded article.
      qWrap.querySelector('article > div[dir="auto"]').remove();
      const only=a.capturePost({...p.extractPost(qWrap.querySelector('article')),replyRouteVerified:true});
      const ob=a.baseline(document,only);
      const od=document.createElement('div');od.setAttribute('role','dialog');
      od.innerHTML='<article><div dir="auto" class="whitespace-pre-wrap">Quoted body</div></article><textarea aria-label="Reply"></textarea>';
      document.body.append(od);const oe=od.querySelector('textarea'),oa=od.querySelector('article'),ot=oa.firstElementChild;oe.focus();
      const os=(post=only,url=qr,quarantine=[])=>a.snapshot(document,post,start,url,20,quarantine);
      const on=()=>a.create({trusted:true,statusId:'818',requestId:'only',now:0,...ob});
      checks.onlyCaptured=only.quoteOnly&&only.modernQuoteOnly?.id==='919';
      checks.onlyUnmarked=on().evaluate(os()).editor===oe&&os().editors[0].contextStatusId==='818';
      checks.onlyWrongRoute=on().evaluate(os(only,'https://x.com/compose/post?in_reply_to=919')).state==='rejected';
      checks.onlyNoCapture=on().evaluate(os({...only,modernQuoteOnly:null})).editor===null;
      ot.textContent='Wrong quote';checks.onlyWrongBody=on().evaluate(os()).editor===null;ot.textContent='Quoted body';
      const ol=document.createElement('a');ol.setAttribute('aria-hidden','true');ol.href='/other/status/999';oa.prepend(ol);
      checks.onlyWrongId=on().evaluate(os()).state==='rejected';ol.href='/quoted/status/919';
      checks.onlyMatchingId=on().evaluate(os()).editor===oe;ol.remove();
      checks.onlyQuarantined=on().evaluate(os(only,qr,[{statusId:'999',sourceText:'Quoted body'}])).editor===null;
      oa.before(oa.cloneNode(true));checks.onlyExtraArticle=on().evaluate(os()).state==='rejected';od.querySelector('article').remove();
      oe.value='draft';checks.onlyDraft=on().evaluate(os()).reason==='existing_draft';oe.value='';
      oe.before(oa);oe.after(oa);checks.onlyAfterEditor=on().evaluate(os()).editor===null;oe.before(oa);
      // Focal detail posts may expose their owned timestamp instead of a
      // hidden permalink. Do not infer identity from the document URL.
      const timed=document.createElement('article');timed.innerHTML='<a href="/focal/status/727"><time>now</time></a><div dir="auto" class="whitespace-pre-wrap">Focal body</div>';
      document.body.append(timed);checks.focalOwnedTime=p.extractPost(timed).statusId==='727';
      timed.insertAdjacentHTML('beforeend','<div data-testid="quoteTweet"><a href="/quoted/status/919"><time>quoted</time></a><div dir="auto" class="whitespace-pre-wrap">Foreign quote</div></div>');
      checks.focalQuoteOwnership=p.extractPost(timed).statusId==='727'&&p.extractPost(timed).sourceText==='Focal body';
      timed.insertAdjacentHTML('beforeend','<a href="/wrong/status/999"><time>wrong</time></a>');
      checks.focalTimeConflict=!p.extractPost(timed).ok;timed.lastElementChild.remove();
      const nativeQuery=timed.querySelectorAll;let bodyQueries=0;
      timed.querySelectorAll=function(selector){if(selector==='div[dir="auto"].whitespace-pre-wrap')bodyQueries++;return nativeQuery.call(this,selector);};
      checks.modernSingleBodyScan=p.extractPost(timed).ok&&bodyQueries===1;
      // Focal timestamp without <time>, plus a class-renamed body. This
      // is a synthetic structural variant, not a live capture.
      const detail=document.createElement('article');
      detail.innerHTML='<div data-anchor-to-hovered-child><div dir="auto" lang="en">Author name</div></div><div dir="auto" lang="en">Detail body</div><a data-status="active" href="/focal/status/929">8:58 PM</a><div role="group"><div data-engagement-action="reply"><a href="/compose/post?in_reply_to=929">Reply</a></div></div>';
      document.body.append(detail);
      const dl=detail.querySelector('a[data-status]'),dr=detail.querySelector('[data-engagement-action] a'),db=detail.querySelector('article > div[lang]');
      const de=()=>p.extractPost(detail);
      checks.activeFocal=de().ok&&de().statusId==='929'&&de().sourceText==='Detail body';
      dr.href='/compose/post?in_reply_to=999';checks.activeFocalConflict=!de().ok;dr.href='/compose/post?in_reply_to=929';
      dl.href='https://example.com/focal/status/929';checks.activeFocalExternal=!de().ok;dl.href='/focal/status/929';
      const group=dr.closest('[role="group"]');group.remove();checks.activeFocalNoRoute=!de().ok;detail.append(group);
      detail.append(dl.cloneNode(true));checks.activeFocalDuplicate=!de().ok;detail.lastElementChild.remove();
      db.after(db.cloneNode(true));checks.renamedBodyAmbiguous=!de().ok;db.nextElementSibling.remove();
      db.hidden=true;checks.renamedBodyHidden=!de().ok;db.hidden=false;
      db.className='whitespace-pre-wrap';const irrelevant=document.createElement('div');irrelevant.setAttribute('dir','auto');irrelevant.setAttribute('lang','en');irrelevant.textContent='unrelated';db.after(irrelevant);
      checks.primaryBodyWins=de().ok&&de().sourceText==='Detail body';irrelevant.remove();db.className='';
      const nested=document.createElement('div');nested.setAttribute('data-slot','embedded-tweet-frame');nested.innerHTML='<article><div dir="auto" lang="en">Quoted words</div><a data-status="active" href="/quote/status/999">now</a><div data-engagement-action="reply"><a href="/compose/post?in_reply_to=999">Reply</a></div></article>';db.after(nested);
      checks.focalIgnoresNestedQuote=de().ok&&de().statusId==='929'&&de().sourceText==='Detail body';nested.remove();
      const inline=document.createElement('form');inline.innerHTML='<textarea aria-label="Post your reply"></textarea>';detail.append(inline);inline.querySelector('textarea').focus();
      od.remove();checks.noInlineReplyAssociation=a.snapshot(document,de(),start,start,20).editors.length===0;
      // Count actual DOM operations, not noisy wall-clock time on CI.
      // Normal legacy extraction must not inspect modern body/quote
      // selectors or repeat the layout classification.
      const legacyQuery=legacy.querySelectorAll,legacyMatch=legacy.matches;
      let modernQueries=0,legacyClassifications=0;
      legacy.querySelectorAll=function(selector){
        if(selector.includes('whitespace-pre-wrap')||selector.includes('data-engagement-action')||selector.includes('embedded-tweet-frame')||selector.includes('dir="auto"'))modernQueries++;
        return legacyQuery.call(this,selector);
      };
      legacy.matches=function(selector){if(selector==='[data-testid="tweet"]')legacyClassifications++;return legacyMatch.call(this,selector);};
      checks.legacyFastPath=p.extractPost(legacy).ok&&modernQueries===0&&legacyClassifications===1;
      legacy.querySelectorAll=legacyQuery;legacy.matches=legacyMatch;
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
    const checks=JSON.parse(match[1]);assert.equal(Object.keys(checks).length,102);
    assert.deepEqual(Object.entries(checks).filter(([,v])=>!v),[]);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
