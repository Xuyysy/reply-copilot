import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Characterization only: record current accepted 0.3.22 decisions.
// A known gap is not marked as a successful reply. Synthetic DOM, no X
// or provider request; quote waiting is not proof of eventual failure.
test('timeline coverage audit: current legacy source and modal decisions',{timeout:60000},()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'xrh-timeline-audit-'));
  try{
    const source=['post-extractor','reply-detector','composer-adapter','composer-association'].map(n=>
      readFileSync(new URL('../content/'+n+'.js',import.meta.url),'utf8')).join('\n');
    const run=()=>{
      const {postExtractor:p,composerAssociation:a}=globalThis.ZaneReplyCopilotContent;
      const home='https://x.com/home',compose='https://x.com/compose/post',url='https://x.com/example/status/101';
      const header='<div data-testid="User-Name"><a href="https://x.com/example">@example</a></div>';
      const permalink='<a href="'+url+'"><time datetime="2026-11-25T03:51:00.000Z">Nov 25</time></a>';
      const text=s=>'<div data-testid="tweetText">'+s+'</div>';
      const caption='A long synthetic source caption that is sufficiently distinct to verify the same native post preview when abbreviated.';
      const full=caption+' Additional details that are only shown in the full original article.';
      const photo='<a href="'+url+'/photo/1"><div data-testid="tweetPhoto">Image</div></a>';
      const video='<a href="'+url+'/video/1"><video></video></a>';
      const markedVideo='<div data-testid="videoPlayer">'+video+'</div>';
      const more='<button data-testid="tweet-text-show-more-link">Show more</button>';
      const quote='<div data-testid="quoteTweet"><div data-testid="User-Name"><a href="https://x.com/quoted">@quoted</a></div><a href="https://x.com/quoted/status/202"><time>Nov 25</time></a>'+text('Independent quoted caption')+'</div>';
      const repost='<div data-testid="socialContext">Someone reposted</div>';
      const wrong='<a href="https://x.com/other/status/999"><time>Now</time></a>';
      const specs=[
        {name:'plain',source:header+permalink+text(caption),modal:header+permalink+text(caption)},
        {name:'long_verified_modal_id',source:header+permalink+text(full)+photo,modal:header+permalink+text(caption)+more},
        {name:'long_linkless_truncated',source:header+permalink+text(full)+photo,modal:header+text(caption)+more},
        {name:'long_linkless_native_expand_id',source:header+permalink+text(full)+photo,modal:header+text(caption)+'<a data-testid="tweet-text-show-more-link" href="'+url+'">Show more</a>'},
        {name:'link_projection',source:header+permalink+text(caption+' <a href="https://t.co/Abc123">example.test/full</a>')+photo,modal:header+text(caption+' <a href="https://t.co/Abc123">example.test/…</a>')},
        {name:'photo_pic_x_suffix',source:header+permalink+text(caption)+photo,modal:header+text(caption+' pic.x.com/Abc123')},
        {name:'photo_pic_twitter_suffix',source:header+permalink+text(caption)+photo,modal:header+text(caption+' pic.twitter.com/Abc123')},
        {name:'marked_video',source:header+permalink+text(caption)+markedVideo,modal:header+text(caption+' pic.x.com/Abc123')},
        {name:'native_video_only_marker',source:header+permalink+text(caption)+video,modal:header+text(caption+' pic.x.com/Abc123')},
        {name:'repost_original_id',source:repost+header+permalink+text(caption),modal:header+permalink+text(caption)},
        {name:'repost_edited_history_only',source:repost+header+'<a href="'+url+'/history"><time>Edited</time></a>'+text(caption)+photo,modal:header+permalink+text(caption)},
        {name:'captioned_quote_verified_id',source:header+permalink+text(full)+quote,modal:header+permalink+text(caption)+more+quote},
        {name:'captioned_quote_linkless_truncated',source:header+permalink+text(full)+quote,modal:header+text(caption)+more+quote},
        {name:'quote_only_verified_id',source:header+permalink+quote,modal:header+permalink+quote},
        {name:'quote_only_linkless_outer',source:header+permalink+quote,modal:header+quote},
        {name:'wrong_parent',source:header+permalink+text(caption),modal:header+wrong+text(caption)},
        {name:'textless_video',source:header+permalink+video,modal:header+permalink+video}
      ];
      const results=[];
      for(const item of specs){
        document.body.innerHTML='<main><article data-testid="tweet">'+item.source+'</article></main>';
        const article=document.querySelector('article');
        const post=p.extractPost(article,home);
        if(!post.ok){results.push({name:item.name,stage:'capture',state:'failed',reason:post.reason});continue;}
        const captured=a.capturePost(post,home),baseline=a.baseline(document,captured);
        const dialog=document.createElement('div');
        dialog.setAttribute('role','dialog');
        dialog.innerHTML='<div role="dialog" aria-modal="true"><article data-testid="tweet">'+item.modal+'</article><div role="textbox" data-testid="tweetTextarea_0" contenteditable="true" style="min-height:20px"></div></div>';
        document.body.append(dialog);
        const editor=dialog.querySelector('[contenteditable]');editor.focus();
        const facts=a.snapshot(document,captured,home,compose,20,[],true);
        const result=a.create({trusted:true,statusId:captured.statusId,requestId:'audit',now:0,...baseline}).evaluate(facts);
        results.push({name:item.name,stage:'association',state:result.state,reason:result.reason,context:facts.editors[0]?.contextDetail||null});
      }
      document.body.innerHTML='<output id="result"></output>';
      document.getElementById('result').textContent=JSON.stringify(results);
    };
    const file=path.join(dir,'fixture.html');
    writeFileSync(file,'<!doctype html><html><body><script>'+source+'</script><script>try{('+run.toString()+')()}catch(e){document.body.innerHTML="<output id=result></output>";document.getElementById("result").textContent=JSON.stringify({error:String(e)});}</script></body></html>');
    const browser=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const result=spawnSync(browser,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--user-data-dir='+path.join(dir,'profile'),'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:35000,maxBuffer:2*1024*1024});
    assert.equal(result.status,0,result.stderr);
    const match=result.stdout.match(/<output id="result">([^<]+)<\/output>/);
    assert.ok(match,result.stdout.slice(-1200));
    const rows=JSON.parse(match[1]);
    console.log('Timeline coverage audit '+JSON.stringify(rows));
    assert.ok(Array.isArray(rows),JSON.stringify(rows));
    const actual=Object.fromEntries(rows.map(r=>[r.name,r.state]));
    assert.deepEqual(actual,{
      plain:'bound',long_verified_modal_id:'bound',long_linkless_truncated:'rejected',
      long_linkless_native_expand_id:'bound',link_projection:'rejected',
      photo_pic_x_suffix:'bound',photo_pic_twitter_suffix:'rejected',
      marked_video:'bound',native_video_only_marker:'rejected',
      repost_original_id:'bound',repost_edited_history_only:'failed',
      captioned_quote_verified_id:'bound',captioned_quote_linkless_truncated:'waiting',
      quote_only_verified_id:'bound',quote_only_linkless_outer:'waiting',
      wrong_parent:'rejected',textless_video:'failed'
    });
  }finally{rmSync(dir,{recursive:true,force:true});}
});
