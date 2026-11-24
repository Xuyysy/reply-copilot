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
    const checks=JSON.parse(match[1]);assert.equal(Object.keys(checks).length,24);
    assert.deepEqual(Object.entries(checks).filter(([,v])=>!v),[]);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
