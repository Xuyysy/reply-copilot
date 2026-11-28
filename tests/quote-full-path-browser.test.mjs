import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withMomentumBrowser} from './helpers/momentum-browser.js';

const origin='https://x.com/home';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
// Local intercepted HTTPS page; no X, provider, account, or DB network.
// Real trusted Chromium pointer events and real content scripts.
// Only runtime messages and the website's paste/render handler are synthetic.
function fixture(){
  const replies={natural:'恭喜，祝大家早日上岸！',light_humor:'上岸队伍又壮大了！',thoughtful:'保持耐心，期待更多好消息。'};
  window.fixture={generations:[],history:[],pastes:0,sends:0,mode:'success',pending:null,replies};
  const f=window.fixture;
  const prefs={showFloatingWindow:true,autoGenerateOnReply:true,defaultReplyMode:'natural',showMomentumEntry:false};
  const event=()=>({addListener(){},removeListener(){}});
  window.chrome={runtime:{id:'fixture-only',onMessage:event(),getURL:()=> 'data:text/css,',sendMessage:async m=>{
    switch(m.type){
      case 'REPLY_COPILOT_GET_BEHAVIOR':return {ok:true,preferences:prefs};
      case 'REPLY_COPILOT_ACCOUNT_STATE':return {ok:true,status:'credits_available',quota:{totalRemaining:100}};
      case 'REPLY_COPILOT_PERFORMANCE_STATE':return {ok:true,enabled:false};
      case 'REPLY_COPILOT_GENERATE':
        f.generations.push({sourceText:m.sourceText,sourceUrl:m.sourceUrl,requestId:m.requestId});
        return await new Promise(resolve=>{f.pending=()=>resolve({ok:true,result:{recommendation:'reply',defaultStyle:'natural',replies},accountLabel:'Synthetic'});});
      case 'REPLY_COPILOT_HISTORY':f.history.push(m.event);return {ok:true};
      default:return {ok:true};
    }
  }},storage:{onChanged:event(),local:{get:async()=>({behaviorPreferences:prefs})}}};
  const id='https://x.com/example/status/101',quoteUrl='https://x.com/quoted/status/202';
  const header='<div data-testid="User-Name"><a href="https://x.com/example">@example</a></div>';
  const timestamp='<time datetime="2026-11-25T03:51:00.000Z">Nov 25</time>';
  const caption='又叒叒叒一位同学通过了！！！<br><br>让我们恭喜他！！！<br><br>希望各位也能早日上岸！！！';
  const quoted='不懂就问<br><br>多久能审核通过呀？';
  const text=s=>'<div data-testid="tweetText">'+s+'</div>';
  const card='<div role="link"><div data-testid="User-Name"><a href="https://x.com/quoted">@quoted</a></div><time>4h</time>'+text(quoted)+'<a href="'+quoteUrl+'/photo/1"><div data-testid="tweetPhoto"><img alt="Image"></div></a></div>';
  const projected='<div role="link"><div data-testid="User-Name"><span>@quoted</span></div><time>4h</time>'+text(quoted+' <a href="https://t.co/PicToken">pic.x.com/Quote123</a>')+'</div>';
  const link='<a href="https://t.co/QuoteToken" title="'+quoteUrl+'">x.com/quoted/status/20…</a>';
  document.body.innerHTML='<article data-testid="tweet" id="source">'+header+'<a href="'+id+'">'+timestamp+'</a>'+text(caption)+card+'<div role="group"><button id="open" data-testid="reply">Reply</button></div></article>';
  document.getElementById('open').addEventListener('click',()=>{
    history.pushState({},'','/compose/post');
    const d=document.createElement('div');d.id='modal';d.setAttribute('role','dialog');
    const compact=f.mode.startsWith('compact');
    const inner=f.mode==='wrong_quote'||f.mode==='compact_wrong_quote'?projected.replace('多久能审核通过呀？','完全不同的正文'):projected;
    const time=compact?'<time>1h</time>':f.mode==='wrong_time'?timestamp.replace('03:51:00','03:51:01'):timestamp;
    const outer=f.mode==='compact_wrong_caption'?caption.replace('让我们恭喜他','完全不同的正文'):caption;
    const tail=f.mode==='compact_wrong_link'?link.replace('/status/202','/status/203'):link;
    d.innerHTML='<div role="dialog" aria-modal="true"><article data-testid="tweet">'+header+time+text(outer+(f.mode==='compact_adjacent'?'':' ')+tail)+inner+'</article><div id="editor" role="textbox" aria-label="Reply draft" data-testid="tweetTextarea_0" contenteditable="true" style="min-height:40px;border:1px solid"></div><button id="send" data-testid="tweetButton">Reply</button></div>';
    document.body.append(d);const editor=d.querySelector('#editor');
    editor.addEventListener('paste',e=>{e.preventDefault();f.pastes++;editor.textContent=e.clipboardData.getData('text/plain');editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));});
    d.querySelector('#send').addEventListener('click',()=>f.sends++);
    editor.focus();
  });
  window.momentumReady=true;
}
const scripts=['utils/generation-performance.js','content/post-extractor.js','content/reply-detector.js','content/composer-adapter.js','content/composer-association.js','content/inline-assistant.js','content/layout-diagnostics.js','content/content-script.js'].map(read).join('\n');
const html='<!doctype html><html><body><script>('+fixture.toString()+')();</script><script>'+scripts.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Chromium trusted click through actual quote capture, three candidates and single safe draft',{timeout:90000},async()=>{
  await withMomentumBrowser(html,async({evaluate,call})=>{
    const until=async(expr,timeout=5000)=>{
      const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expr))return;await sleep(40);}
      throw Error('Fixture condition not met: '+expr+'; '+JSON.stringify(await evaluate('({trace:window.replyCopilotAssociationReport?.(),fixture:window.fixture,editor:document.querySelector("#editor")?.innerText})')));
    };
    const click=async()=>{
      const p=await evaluate('(()=>{const r=document.querySelector("#open").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
      await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
    };
    const reset=async mode=>{
      await call('Page.navigate',{url:origin});
      await until('document.readyState==="complete"&&location.pathname==="/home"&&Boolean(window.replyCopilotAssociationReport)&&Boolean(window.fixture)');
      await evaluate('fixture.mode='+JSON.stringify(mode));
      await click();
    };
    const state=()=>evaluate('({generations:fixture.generations,pastes:fixture.pastes,sends:fixture.sends,editor:document.querySelector("#editor")?.innerText??null,styles:[...(document.querySelector("[data-zane-reply-copilot]")?.shadowRoot?.querySelectorAll("button[data-style]")||[])].map(b=>b.dataset.style),trace:replyCopilotAssociationReport()})');
    const rows=[];
    await reset('success');await until('fixture.generations.length===1&&Boolean(fixture.pending)');
    await evaluate('fixture.pending()');await until('fixture.pastes===1&&document.querySelector("#editor").innerText===fixture.replies.natural');
    await until('document.querySelector("[data-zane-reply-copilot]")?.shadowRoot?.querySelector(".status")?.textContent.includes("已填入")');
    let s=await state();assert.equal(s.generations.length,1);assert.equal(s.generations[0].sourceUrl,'https://x.com/example/status/101');assert.match(s.generations[0].sourceText,/早日上岸/);
    assert.deepEqual(s.styles,['natural','light_humor','thoughtful']);assert.equal(s.sends,0);
    await sleep(900);s=await state();assert.equal(s.generations.length,1);assert.equal(s.pastes,1);rows.push({name:'success',requests:s.generations.length,pastes:s.pastes,submissions:s.sends});
    for(const mode of ['compact','compact_adjacent']){
      await reset(mode);await until('fixture.generations.length===1&&Boolean(fixture.pending)');
      await evaluate('fixture.pending()');await until('fixture.pastes===1&&document.querySelector("#editor").innerText===fixture.replies.natural');
      await sleep(900);s=await state();assert.equal(s.generations.length,1,mode);assert.equal(s.pastes,1,mode);assert.equal(s.sends,0,mode);
      assert.equal(s.generations[0].sourceUrl,'https://x.com/example/status/101',mode);
      assert.deepEqual(s.styles,['natural','light_humor','thoughtful'],mode);
      rows.push({name:mode,requests:s.generations.length,pastes:s.pastes,submissions:s.sends});
    }
    for(const mode of ['draft','closed','compact_draft','compact_closed']){
      await reset(mode);await until('fixture.generations.length===1&&Boolean(fixture.pending)');
      if(mode.endsWith('draft'))await call('Input.insertText',{text:'我的草稿'});
      else await evaluate('document.querySelector("#modal").remove()');
      await evaluate('fixture.pending()');await sleep(950);s=await state();
      assert.equal(s.generations.length,1,mode);assert.equal(s.pastes,0,mode);assert.equal(s.sends,0,mode);assert.equal(s.editor,mode.endsWith('draft')?'我的草稿':null);
      rows.push({name:mode,requests:s.generations.length,pastes:s.pastes,submissions:s.sends});
    }
    for(const mode of ['wrong_quote','wrong_time','compact_wrong_caption','compact_wrong_quote','compact_wrong_link']){
      await reset(mode);await until('replyCopilotAssociationReport().some(e=>e.stage==="rejected")');
      await sleep(900);s=await state();assert.equal(s.generations.length,0,mode);assert.equal(s.pastes,0,mode);assert.equal(s.sends,0,mode);
      rows.push({name:mode,requests:s.generations.length,pastes:s.pastes,submissions:s.sends});
    }
    console.log('Quote browser full path '+JSON.stringify(rows));
  },{isolatedUrl:origin});
});
