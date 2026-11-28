import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// The exact accepted staging candidate, not a moving branch or a mocked
// association implementation. Same browser, DOM, fixture and alternating order.
const BASE='b27650ba1e224f7e6b186b163399912c54ecbacf';
test('real Chromium detail scan A/B: identical association results with fewer DOM queries',{timeout:90000},()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'xrh-detail-scan-ab-'));
  try{
    const files=['post-extractor','reply-detector','composer-adapter','composer-association'];
    const before=files.map(n=>execFileSync('git',['show',BASE+':content/'+n+'.js'],{encoding:'utf8'})).join('\n');
    const after=files.map(n=>readFileSync(new URL('../content/'+n+'.js',import.meta.url),'utf8')).join('\n');
    const run=(before,after)=>{
      const init=source=>{delete globalThis.ZaneReplyCopilotContent;new Function(source)();return globalThis.ZaneReplyCopilotContent;};
      const apis={before:init(before),after:init(after)};
      const url='https://x.com/example/status/101',compose='https://x.com/compose/post',home='https://x.com/home';
      const header='<div data-testid="User-Name"><a href="https://x.com/example">@example</a></div>';
      const caption='This synthetic long caption has enough text to reproduce a shortened native modal preview with a media presentation link.';
      const full=caption+' Additional details at the end of the original article.';
      const text=v=>'<div data-testid="tweetText">'+v+'</div>';
      const photo='<a href="'+url+'/photo/1"><div data-testid="tweetPhoto">Image</div></a>';
      const video='<a href="'+url+'/video/1"><video></video></a>';
      const actions='<div role="group"><button data-testid="reply">Reply</button><a href="'+url+'/analytics">Views</a></div>';
      const permalink='<a href="'+url+'"><time datetime="2026-11-25T03:51:00.000Z">Nov 25</time></a>';
      const quote='<div data-testid="quoteTweet"><div data-testid="User-Name"><a href="https://x.com/quoted">@quoted</a></div><a href="https://x.com/quoted/status/202"><time>Nov 25</time></a>'+text('Quoted synthetic context')+'</div>';
      const more='<button data-testid="tweet-text-show-more-link">Show more</button>';
      const cases=[
        {name:'timeline',route:home,source:header+permalink+text(caption),modal:header+permalink+text(caption)},
        {name:'detail_verified',route:url,source:header+permalink+text(caption)+photo,modal:header+permalink+text(caption)},
        {name:'detail_long',route:url,source:header+text(full)+photo+actions,modal:header+text(caption+' pic.x.com/ABC123')+more},
        {name:'detail_video',route:url,source:header+text(caption)+video+actions,modal:header+text(caption+' pic.x.com/Video123')},
        {name:'detail_quote',route:url,source:header+text(full)+quote+actions,modal:header+text(caption)+more+quote},
        {name:'detail_quote_only',route:url,source:header+quote+actions,modal:header+quote}
      ];
      let queries=0,reads=0;
      const originals=[Element.prototype.querySelectorAll,Document.prototype.querySelectorAll,Element.prototype.getClientRects];
      Element.prototype.querySelectorAll=function(...args){queries++;return originals[0].apply(this,args)};
      Document.prototype.querySelectorAll=function(...args){queries++;return originals[1].apply(this,args)};
      Element.prototype.getClientRects=function(...args){reads++;return originals[2].apply(this,args)};
      const results=[];
      const summary=rows=>{
        const q=(k,p)=>rows.map(r=>r[k]).sort((a,b)=>a-b)[Math.ceil(rows.length*p)-1];
        return {samples:rows.length,captureP50:q('capture',.5),captureP95:q('capture',.95),
          scanP50:q('scan',.5),scanP95:q('scan',.95),queriesP50:q('queries',.5),layoutReadsP50:q('reads',.5)};
      };
      for(const item of cases){
        document.body.innerHTML='<main><article data-testid="tweet">'+item.source+'</article></main><div role="dialog"><div role="dialog" aria-modal="true"><article data-testid="tweet">'+item.modal+'</article><div role="textbox" data-testid="tweetTextarea_0" contenteditable="true" style="min-height:20px"></div></div></div>';
        const source=document.querySelector('main article'),editor=document.querySelector('[contenteditable]');
        editor.focus();
        const rows={before:[],after:[]};
        const use=kind=>{globalThis.ZaneReplyCopilotContent=apis[kind];return apis[kind];};
        const capture=kind=>{const api=use(kind);return api.composerAssociation.capturePost(api.postExtractor.extractPost(source,item.route),item.route);};
        const snapshot=(kind,post,diagnostics=false)=>{
          const api=use(kind);return api.composerAssociation.snapshot(document,post,item.route,compose,20,[],diagnostics);
        };
        const project=f=>({routeAllowed:f.routeAllowed,sourceUnchanged:f.sourceUnchanged,visibleDialogCount:f.visibleDialogCount,
          editors:f.editors.map(e=>({modal:e.modal,focused:e.focused,empty:e.empty,contextStatusId:e.contextStatusId,
            contextMatches:e.contextMatches,contextDetail:e.contextDetail,contextTextPresent:e.contextTextPresent,
            contextTextMatches:e.contextTextMatches,quarantinedContextMatch:e.quarantinedContextMatch}))});
        const beforePost=capture('before'),afterPost=capture('after');
        if(!beforePost.ok||!afterPost.ok)throw Error('fixture source not verified: '+item.name);
        const reference=snapshot('before',beforePost,true),enabled=snapshot('after',afterPost,true),disabled=snapshot('after',afterPost);
        const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
        if(!equal(project(reference),project(enabled))||!equal(project(reference),project(disabled)))throw Error('association mismatch: '+item.name);
        if(reference.editors[0]?.contextMatches!==true)throw Error('fixture must actually bind: '+item.name);
        if(!equal(reference.editors[0].compactEvidence,enabled.editors[0].compactEvidence)||disabled.editors[0].compactEvidence!==null)
          throw Error('diagnostic parity or opt-in failure: '+item.name);
        for(let i=0;i<110;i++)for(const kind of i%2?['after','before']:['before','after']){
          const start=performance.now(),post=capture(kind),captured=performance.now();
          queries=0;reads=0;
          // Multiple calls per sample mitigate browser timer quantization;
          // no inter-scan cache and no async scheduling in this measurement.
          let f;
          for(let n=0;n<5;n++)f=snapshot(kind,post);
          const elapsed=(performance.now()-captured)/5;
          if(f.editors[0]?.contextMatches!==true)throw Error('timed association failed: '+item.name);
          if(i>=10)rows[kind].push({capture:captured-start,scan:elapsed,queries:queries/5,reads:reads/5});
        }
        // A mutation of the same DOM node between snapshots must be seen.
        // Compare the entire decision with baseline, not just the happy path.
        const modal=document.querySelector('[aria-modal] article');
        modal.insertAdjacentHTML('afterbegin','<a href="https://x.com/other/status/999"><time>Wrong parent</time></a>');
        const oldMutation=snapshot('before',beforePost),newMutation=snapshot('after',afterPost);
        if(!equal(project(oldMutation),project(newMutation))||newMutation.editors[0]?.contextMatches===true)
          throw Error('stale cache or changed conflict decision: '+item.name);
        results.push({name:item.name,before:summary(rows.before),after:summary(rows.after)});
      }
      Element.prototype.querySelectorAll=originals[0];Document.prototype.querySelectorAll=originals[1];Element.prototype.getClientRects=originals[2];
      document.body.innerHTML='<output id="result"></output>';document.getElementById('result').textContent=JSON.stringify(results);
    };
    const escape=s=>JSON.stringify(s).replace(/</g,'\\u003c');
    const file=path.join(dir,'ab.html');
    writeFileSync(file,'<!doctype html><html><body><script>try{('+run.toString()+')('+escape(before)+','+escape(after)+')}catch(e){document.body.innerHTML="<output id=result></output>";document.getElementById("result").textContent=JSON.stringify({error:String(e)});}</script></body></html>');
    const browser=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const result=spawnSync(browser,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--user-data-dir='+path.join(dir,'profile'),'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:65000,maxBuffer:2*1024*1024});
    assert.equal(result.status,0,result.stderr);
    const match=result.stdout.match(/<output id="result">([^<]+)<\/output>/);
    assert.ok(match,result.stdout.slice(-1200));
    const rows=JSON.parse(match[1]);assert.ok(Array.isArray(rows),JSON.stringify(rows));
    console.log('Detail scan A/B '+JSON.stringify({baseline:BASE,environment:'Chromium synthetic DOM, actual association source, no network',rows}));
    assert.equal(rows.length,6);
    for(const r of rows){
      assert.equal(r.after.samples,100);
      assert.ok(r.after.queriesP50<=r.before.queriesP50,r.name+' extra DOM queries');
      assert.ok(r.after.scanP95-r.before.scanP95<(r.name==='timeline'?2:10),r.name+' material scan regression');
      assert.ok(r.after.captureP95-r.before.captureP95<2,r.name+' material capture regression');
      if(r.name.startsWith('detail_'))assert.ok(r.after.queriesP50<r.before.queriesP50,r.name+' no query reduction');
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
