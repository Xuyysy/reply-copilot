import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Synthetic DOM, no live X or provider calls. Preserve previous coverage
// and add independent quote ownership / media presentation regressions.
test('timeline compatibility: verified legacy media, history and strictly corroborated preview',{timeout:60000},()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'xrh-timeline-compat-'));
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
      const exactTime='<time datetime="2026-11-25T03:51:00.000Z">Nov 25</time>';
      const wrongTime='<time datetime="2026-11-25T03:51:01.000Z">Nov 25</time>';
      const wrongAuthor='<div data-testid="User-Name"><a href="https://x.com/other">@other</a></div>';
      const wrongQuote=quote.replace('/status/202','/status/203');
      const quoteUrl='https://x.com/quoted/status/202';
      const quoteLink='<a href="'+quoteUrl+'">x.com/quoted/status/20…</a>';
      const otherLink='<a href="https://x.com/other/status/203">x.com/quoted/status/20…</a>';
      const mediaQuote=quote.replace('</div></div>','</div><a href="'+quoteUrl+'/photo/1"><div data-testid="tweetPhoto">Quoted image</div></a></div>');
      const projectedQuote=quote.replace('Independent quoted caption','Independent quoted caption pic.x.com/Quote123');
      const projectedVideo=quote.replace('Independent quoted caption','Independent quoted caption pic.twitter.com/Quote123');
      const videoQuote=quote.replace('</div></div>','</div><video></video></div>');
      const timedMediaQuote=mediaQuote.replace('<time>Nov 25</time>','<time datetime="2026-11-25T01:51:00.000Z">Nov 25</time>');
      const linklessProjectedQuote=projectedQuote.replace('<a href="https://x.com/quoted/status/202"><time>Nov 25</time></a>','<time datetime="2026-11-25T01:51:00.000Z">Nov 25</time>');
      const expandedQuoteLink='<a href="https://t.co/QuoteToken" title="https://x.com/quoted/status/202">x.com/quoted/status/20…</a>';
      const zhCaption='又叒叒叒一位同学通过了！！！<br><br>让我们恭喜他！！！<br><br>希望各位也能早日上岸！！！';
      const zhQuote='不懂就问<br><br>多久能审核通过呀？';
      const mediaOnlyQuote='<div role="link"><div data-testid="User-Name"><a href="https://x.com/quoted">@quoted</a></div><time>4h</time>'+text(zhQuote)+'<a href="'+quoteUrl+'/photo/1"><div data-testid="tweetPhoto"><img alt="Image"></div></a></div>';
      const compactZhQuote='<div role="link"><div data-testid="User-Name"><span>@quoted</span></div><time>4h</time>'+text(zhQuote+' <a href="https://t.co/PicToken">pic.x.com/Quote123</a>')+'</div>';
      const zhSource=header+permalink+text(zhCaption)+mediaOnlyQuote;
      const zhModal=header+exactTime+text(zhCaption+' '+expandedQuoteLink)+compactZhQuote;
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
        {name:'textless_video',source:header+permalink+video,modal:header+permalink+video},
        {name:'long_timestamp_verified',source:header+permalink+text(full)+photo,modal:header+exactTime+text(caption)+more},
        {name:'long_wrong_timestamp',source:header+permalink+text(full)+photo,modal:header+wrongTime+text(caption)+more},
        {name:'long_wrong_author',source:header+permalink+text(full)+photo,modal:wrongAuthor+exactTime+text(caption)+more},
        {name:'long_wrong_route',source:header+permalink+text(full)+photo,modal:header+exactTime+text(caption)+more,route:compose+'?in_reply_to=999'},
        {name:'long_duplicate_route',source:header+permalink+text(full)+photo,modal:header+exactTime+text(caption)+more,route:compose+'?in_reply_to=101&in_reply_to=999'},
        {name:'long_exact_route',source:header+permalink+text(full)+photo,modal:header+text(caption)+more,route:compose+'?in_reply_to=101'},
        {name:'long_quarantined_prefix',source:header+permalink+text(full)+photo,modal:header+exactTime+text(caption)+more,quarantine:[{statusId:'999',sourceText:caption+' Another original post.'}]},
        {name:'long_source_changed',source:header+permalink+text(full)+photo,modal:header+exactTime+text(caption)+more,mutate:true},
        {name:'same_tco_timestamp',source:header+permalink+text(caption+' <a href="https://t.co/Abc123">example.test/full</a>')+photo,modal:header+exactTime+text(caption+' <a href="https://t.co/Abc123">example.test/…</a>')},
        {name:'different_tco_timestamp',source:header+permalink+text(caption+' <a href="https://t.co/Abc123">example.test/full</a>')+photo,modal:header+exactTime+text(caption+' <a href="https://t.co/Different">example.test/…</a>')},
        {name:'captioned_quote_timestamp',source:header+permalink+text(full)+quote,modal:header+exactTime+text(caption)+more+quote},
        {name:'captioned_quote_conflict',source:header+permalink+text(full)+quote,modal:header+exactTime+text(caption)+more+wrongQuote},
        {name:'quote_only_timestamp',source:header+permalink+quote,modal:header+exactTime+quote},
        {name:'quote_only_wrong_quoted_id',source:header+permalink+quote,modal:header+exactTime+wrongQuote},
        {name:'history_conflicting_timestamps',source:header+'<a href="'+url+'/history"><time>Edited</time></a>'+wrong+text(caption),modal:header+permalink+text(caption)},
        {name:'arbitrary_history_link',source:header+text(caption)+'<a href="'+url+'/history">History</a>',modal:header+permalink+text(caption)},
        {name:'body_link_never_identity',source:header+text(caption+' '+quoteLink)+quote,modal:header+permalink+text(caption)+quote},
        {name:'quote_media_projection',source:header+permalink+text(caption)+mediaQuote,modal:header+exactTime+text(caption+' '+quoteLink)+projectedQuote},
        {name:'quote_media_projection_rolelink',source:header+permalink+text(caption)+mediaQuote.replace('data-testid="quoteTweet"','role="link"'),modal:header+exactTime+text(caption+' '+quoteLink)+projectedQuote.replace('data-testid="quoteTweet"','role="link"')},
        {name:'quote_video_projection',source:header+permalink+text(caption)+videoQuote,modal:header+exactTime+text(caption+' '+quoteLink)+projectedVideo},
        {name:'quote_projection_wrong_link',source:header+permalink+text(caption)+mediaQuote,modal:header+exactTime+text(caption+' '+otherLink)+projectedQuote},
        {name:'quote_projection_wrong_inner_id',source:header+permalink+text(caption)+mediaQuote,modal:header+exactTime+text(caption+' '+quoteLink)+projectedQuote.replace('/status/202','/status/203')},
        {name:'quote_projection_without_media',source:header+permalink+text(caption)+quote,modal:header+exactTime+text(caption+' '+quoteLink)+projectedQuote},
        {name:'quote_projection_changed_inner_text',source:header+permalink+text(caption)+mediaQuote,modal:header+exactTime+text(caption+' '+quoteLink)+projectedQuote.replace('Independent quoted caption','Different quoted caption')},
        {name:'quote_projection_wrong_parent',source:header+permalink+text(caption)+mediaQuote,modal:header+wrong+text(caption+' '+quoteLink)+projectedQuote},
        {name:'quote_only_media_verified_outer',source:header+permalink+mediaQuote,modal:header+permalink+projectedQuote},
        {name:'quote_only_media_linkless_outer',source:header+permalink+mediaQuote,modal:header+exactTime+projectedQuote},
        {name:'quote_projection_unverified_time',source:header+permalink+text(caption)+mediaQuote,modal:header+text(caption+' '+quoteLink)+projectedQuote},
        {name:'quote_projection_wrong_body_destination',source:header+permalink+text(caption+' <a href="https://example.com/one">same</a>')+mediaQuote,modal:header+exactTime+text(caption+' <a href="https://example.com/two">same</a> '+quoteLink)+projectedQuote},
        {name:'quote_projection_second_card',source:header+permalink+text(caption)+mediaQuote,modal:header+exactTime+text(caption+' '+quoteLink)+projectedQuote+wrongQuote},
        {name:'tco_expanded_quote',source:header+permalink+text(caption)+mediaQuote,modal:header+exactTime+text(caption+' '+expandedQuoteLink)+projectedQuote},
        {name:'tco_unlinked_inner_timestamp',source:header+permalink+text(caption)+timedMediaQuote,modal:header+exactTime+text(caption+' '+expandedQuoteLink)+linklessProjectedQuote},
        {name:'tco_wrong_expanded_id',source:header+permalink+text(caption)+mediaQuote,modal:header+exactTime+text(caption+' '+expandedQuoteLink.replace('status/202','status/203'))+projectedQuote},
        {name:'tco_missing_expanded_metadata',source:header+permalink+text(caption)+mediaQuote,modal:header+exactTime+text(caption+' '+expandedQuoteLink.replace(' title="https://x.com/quoted/status/202"',''))+projectedQuote},
        {name:'tco_wrong_inner_time',source:header+permalink+text(caption)+timedMediaQuote,modal:header+exactTime+text(caption+' '+expandedQuoteLink)+linklessProjectedQuote.replace('01:51:00','01:51:01')},
        {name:'tco_wrong_inner_author',source:header+permalink+text(caption)+timedMediaQuote,modal:header+exactTime+text(caption+' '+expandedQuoteLink)+linklessProjectedQuote.replace('https://x.com/quoted','https://x.com/other')},
        {name:'tco_no_outer_time',source:header+permalink+text(caption)+timedMediaQuote,modal:header+text(caption+' '+expandedQuoteLink)+linklessProjectedQuote},
        {name:'zh_owned_quote_media_id',source:zhSource,modal:zhModal},
        {name:'zh_owned_quote_media_id_wrong_owner',source:zhSource.replace('/quoted/status/202/photo','/other/status/202/photo'),modal:zhModal},
        {name:'zh_owned_quote_media_id_wrong_link',source:zhSource,modal:zhModal.replace('title="https://x.com/quoted/status/202"','title="https://x.com/quoted/status/203"')},
        {name:'zh_owned_quote_media_id_no_outer_proof',source:zhSource,modal:zhModal.replace(exactTime,'<time>1h</time>')},
        {name:'zh_owned_quote_media_id_wrong_inner_text',source:zhSource,modal:zhModal.replace('多久能审核通过呀？','完全不同的正文')},
        {name:'zh_owned_quote_media_id_wrong_inner_author',source:zhSource,modal:zhModal.replace('@quoted','@other')},
        {name:'zh_owned_quote_media_id_wrong_outer_time',source:zhSource,modal:zhModal.replace(exactTime,wrongTime)},
        {name:'zh_owned_quote_media_id_wrong_outer_route',source:zhSource,modal:zhModal,route:compose+'?in_reply_to=999'},
        {name:'zh_owned_quote_media_id_quarantined',source:zhSource,modal:zhModal,quarantine:[{statusId:'999',sourceText:'又叒叒叒一位同学通过了！！！ 让我们恭喜他！！！ 希望各位也能早日上岸！！！'}]},
        {name:'zh_body_link_not_quote_media_evidence',source:zhSource.replace('<a href="'+quoteUrl+'/photo/1"><div data-testid="tweetPhoto"><img alt="Image"></div></a>','<div data-testid="tweetPhoto"><img alt="Image"></div>'),modal:zhModal}
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
        if(item.mutate)article.querySelector('[data-testid="tweetText"]').textContent=full+' Changed after click.';
        const facts=a.snapshot(document,captured,home,item.route||compose,20,item.quarantine||[],true);
        const result=a.create({trusted:true,statusId:captured.statusId,requestId:'audit',now:0,...baseline}).evaluate(facts);
        results.push({name:item.name,stage:'association',state:result.state,reason:result.reason,context:facts.editors[0]?.contextDetail||null});
      }
      document.body.innerHTML='<output id="result"></output>';
      document.getElementById('result').textContent=JSON.stringify(results);
    };
    const browser=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    function execute(code,name){
      const file=path.join(dir,name+'.html');
      writeFileSync(file,'<!doctype html><html><body><script>'+code+'</script><script>try{('+run.toString()+')()}catch(e){document.body.innerHTML="<output id=result></output>";document.getElementById("result").textContent=JSON.stringify({error:String(e)});}</script></body></html>');
      const result=spawnSync(browser,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--user-data-dir='+path.join(dir,'profile-'+name),'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:25000,maxBuffer:2*1024*1024});
      assert.equal(result.status,0,result.stderr);
      const match=result.stdout.match(/<output id="result">([^<]+)<\/output>/);
      assert.ok(match,result.stdout.slice(-1200));
      const rows=JSON.parse(match[1]);assert.ok(Array.isArray(rows),JSON.stringify(rows));return rows;
    }
    const previous=['post-extractor','reply-detector','composer-adapter','composer-association'].map(n=>
      execFileSync('git',['show','f06075212b78bda12454bf487ec343116b122554:content/'+n+'.js'],{encoding:'utf8'})).join('\n');
    const before=execute(previous,'before');
    const old=before.find(r=>r.name==='zh_owned_quote_media_id');
    assert.equal(old?.state,'rejected',JSON.stringify(old));
    const rows=execute(source,'after');
    console.log('Timeline compatibility '+JSON.stringify(rows));
    assert.ok(Array.isArray(rows),JSON.stringify(rows));
    const actual=Object.fromEntries(rows.map(r=>[r.name,r.state]));
    assert.deepEqual(actual,{
      plain:'bound',long_verified_modal_id:'bound',long_linkless_truncated:'rejected',
      long_linkless_native_expand_id:'bound',link_projection:'rejected',
      photo_pic_x_suffix:'bound',photo_pic_twitter_suffix:'bound',
      marked_video:'bound',native_video_only_marker:'bound',
      repost_original_id:'bound',repost_edited_history_only:'bound',
      captioned_quote_verified_id:'bound',captioned_quote_linkless_truncated:'waiting',
      quote_only_verified_id:'bound',quote_only_linkless_outer:'waiting',
      wrong_parent:'rejected',textless_video:'failed',
      long_timestamp_verified:'bound',long_wrong_timestamp:'rejected',long_wrong_author:'rejected',
      long_wrong_route:'rejected',long_duplicate_route:'rejected',long_exact_route:'bound',
      long_quarantined_prefix:'rejected',long_source_changed:'rejected',same_tco_timestamp:'bound',
      different_tco_timestamp:'rejected',captioned_quote_timestamp:'bound',captioned_quote_conflict:'rejected',
      quote_only_timestamp:'bound',quote_only_wrong_quoted_id:'rejected',
      history_conflicting_timestamps:'failed',arbitrary_history_link:'failed',
      body_link_never_identity:'failed',quote_media_projection:'bound',quote_media_projection_rolelink:'bound',
      quote_video_projection:'bound',quote_projection_wrong_link:'rejected',quote_projection_wrong_inner_id:'rejected',
      quote_projection_without_media:'rejected',quote_projection_changed_inner_text:'rejected',quote_projection_wrong_parent:'rejected',
      quote_only_media_verified_outer:'bound',quote_only_media_linkless_outer:'bound',quote_projection_unverified_time:'waiting',
      quote_projection_wrong_body_destination:'rejected',quote_projection_second_card:'rejected',
      tco_expanded_quote:'bound',tco_unlinked_inner_timestamp:'bound',tco_wrong_expanded_id:'rejected',
      tco_missing_expanded_metadata:'rejected',tco_wrong_inner_time:'rejected',tco_wrong_inner_author:'rejected',tco_no_outer_time:'waiting',
      zh_owned_quote_media_id:'bound',zh_owned_quote_media_id_wrong_owner:'rejected',
      zh_owned_quote_media_id_wrong_link:'rejected',zh_owned_quote_media_id_no_outer_proof:'rejected',
      zh_owned_quote_media_id_wrong_inner_text:'rejected',zh_owned_quote_media_id_wrong_inner_author:'rejected',
      zh_owned_quote_media_id_wrong_outer_time:'rejected',zh_owned_quote_media_id_wrong_outer_route:'rejected',
      zh_owned_quote_media_id_quarantined:'rejected',zh_body_link_not_quote_media_evidence:'rejected'
    });
  }finally{rmSync(dir,{recursive:true,force:true});}
});
