import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Reconstructed from the affected Production V3 report: wrapper anchor,
// native SPA reply route, Base UI portal, linkless original-post preview.
// Controlled textarea and visual mirror emulate public XDS evidence.
// No actual X network, credentials, backend, debit or submit.
test('real Chromium trusted click through content script, portal, generation and controlled textarea', {timeout:90000}, async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'xrh-modern-flow-'));
  const browser=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const code=['utils/generation-performance.js','content/post-extractor.js','content/reply-detector.js','content/composer-adapter.js','content/composer-association.js','content/inline-assistant.js','content/content-script.js'].map(read).join('\n');
  const setup=()=>{
    const mode=new URL(location.href).searchParams.get('case');
    const source='Synthetic modern original';
    const answer='Controlled response 中文 😀\nsecond line';
    const f=window.fixture={mode,source,answer,model:'',inputs:0,submits:0,requests:[],pending:[],events:[]};
    const css=window.fixtureCss;
    const runtime={id:'fixture',getURL:()=>css,onMessage:{addListener(){},removeListener(){}},sendMessage:async m=>{
      f.requests.push(m);
      if(m.type==='REPLY_COPILOT_GET_BEHAVIOR')return {ok:true,preferences:{showFloatingWindow:true,autoGenerateOnReply:true}};
      if(m.type==='REPLY_COPILOT_ACCOUNT_STATE')return {ok:true,status:'credits_available',quota:{totalRemaining:5}};
      if(m.type==='REPLY_COPILOT_GENERATE')return new Promise(resolve=>f.pending.push(resolve));
      return {ok:true};
    }};
    Object.defineProperty(window,'chrome',{configurable:true,value:{runtime,storage:{local:{get:async()=>({})},onChanged:{addListener(){},removeListener(){}}}}});
    f.resolve=()=>f.pending.shift()?.({ok:true,result:{recommendation:'reply',defaultStyle:'natural',replies:{natural:answer}}});
    const link=document.querySelector('#reply');
    if(mode==='wrong-link')link.href='/compose/post?in_reply_to=999';
    link.addEventListener('click',event=>{
      event.preventDefault();f.events.push(event.isTrusted);
      const route=mode==='wrong-route'?'/compose/post?in_reply_to=999':
        mode==='duplicate-route'?'/compose/post?in_reply_to=202&in_reply_to=202':
        mode==='missing-route'?'/compose/post':'/compose/post?in_reply_to=202';
      history.pushState({},'',route);
      setTimeout(()=>{
        const portal=document.createElement('div');portal.setAttribute('data-base-ui-portal','');
        portal.innerHTML='<div role="dialog" data-slot="xds-modal-surface" style="background:white;position:fixed;top:90px;left:100px;width:560px;padding:20px;z-index:100"><div id="preview" dir="auto" class="whitespace-pre-wrap">'+(mode==='stale-preview'?'Previous recipient':source)+'</div><div data-media-upload-dropzone><form><div style="position:relative"><div id="mirror" aria-hidden="true" dir="auto" class="whitespace-pre-wrap" style="white-space:pre-wrap"></div><textarea aria-label="Post your reply" style="color:transparent;width:100%;height:90px"></textarea></div><div id="uploads"></div><button type="submit" disabled>Reply</button></form></div></div>';
        document.body.append(portal);
        const editor=portal.querySelector('textarea'),mirror=portal.querySelector('#mirror'),button=portal.querySelector('button');
        const native=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
        let tracked=editor.value;
        // Simulate a framework value tracker: ordinary JS assignment
        // updates the tracker; native setter plus input exposes a change.
        Object.defineProperty(editor,'value',{configurable:true,get(){return native.get.call(this)},set(value){tracked=String(value);native.set.call(this,value)}});
        editor.addEventListener('input',()=>{
          f.inputs++;
          if(editor.value===tracked)return;
          if(mode==='mirror-reject')return;
          tracked=editor.value;f.model=editor.value;
          mirror.textContent=f.model;button.disabled=!f.model;
          queueMicrotask(()=>native.set.call(editor,f.model));
        });
        portal.querySelector('form').addEventListener('submit',event=>{event.preventDefault();f.submits++});
        f.editor=editor;
        f.addMedia=()=>{const image=document.createElement('img');image.src=URL.createObjectURL(new Blob(['fixture'],{type:'image/png'}));portal.querySelector('#uploads').append(image);};
        if(mode==='draft')editor.value='user draft';
        if(mode==='attachment')f.addMedia();
        editor.focus();
      },30);
    });
    f.result=()=>({value:f.editor?.value??null,model:f.model,mirror:document.querySelector('#mirror')?.textContent??null,
      inputs:f.inputs,submits:f.submits,generated:f.requests.filter(m=>m.type==='REPLY_COPILOT_GENERATE').length,
      sourceMatches:f.requests.filter(m=>m.type==='REPLY_COPILOT_GENERATE').every(m=>m.sourceText===source&&m.sourceUrl==='https://x.com/fixture/status/202'),
      applied:f.requests.filter(m=>m.type==='REPLY_COPILOT_HISTORY'&&m.event==='applied').length,
      host:!!document.querySelector('[data-zane-reply-copilot]'),
      status:document.querySelector('[data-zane-reply-copilot]')?.shadowRoot?.querySelector('.status')?.textContent||'',
      trusted:f.events.every(Boolean)&&f.events.length===1,
      trace:window.replyCopilotAssociationReport?.()});
  };
  const html='<!doctype html><html data-app-version="fixture"><head><meta charset="utf-8"></head><body style="font:16px sans-serif"><main><div role="link" data-href="/fixture/status/202"><a aria-hidden="true" href="/fixture/status/202" style="display:none"></a><article><div dir="auto" class="whitespace-pre-wrap">Synthetic modern original</div><div data-engagement-action="reply"><a id="reply" href="/compose/post?in_reply_to=202" aria-label="0 Replies. Reply" style="display:inline-block;padding:16px"><span id="icon">Reply</span></a></div></article></div></main><script>window.fixtureCss='+JSON.stringify('data:text/css,'+encodeURIComponent(read('content/inline-assistant.css')))+';('+setup.toString()+')();</script><script>'+code+'</script></body></html>';
  const child=spawn(browser,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--disable-background-networking','--window-size=1200,900','--remote-debugging-pipe','--user-data-dir='+path.join(dir,'profile'),'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  let id=0,buffer='',sessionId;
  const pending=new Map(),errors=[];
  const call=(method,params={},session=sessionId)=>new Promise((resolve,reject)=>{
    const i=++id,timer=setTimeout(()=>{pending.delete(i);reject(new Error('CDP timeout '+method))},10000);
    pending.set(i,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id:i,method,params,...(session?{sessionId:session}:{})})+'\0');
  });
  child.stdio[4].on('data',chunk=>{
    buffer+=chunk.toString();let end;
    while((end=buffer.indexOf('\0'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      let m;try{m=JSON.parse(line)}catch{continue}
      const p=pending.get(m.id);
      if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
      if(m.method==='Fetch.requestPaused'){
        const u=new URL(m.params.request.url);
        if(u.origin==='https://x.com'&&u.pathname==='/home')
          void call('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],body:Buffer.from(html).toString('base64')},m.sessionId).catch(e=>errors.push(e.message));
        else void call('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId).catch(e=>errors.push(e.message));
      }
      if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    }
  });
  const evalIn=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
  const until=async(fn,label)=>{const end=Date.now()+5000;while(Date.now()<end){if(await fn())return;await wait(50);}throw Error(label+': '+JSON.stringify(await evalIn('window.fixture?.result()')))};
  try{
    const t=await call('Target.createTarget',{url:'about:blank'},null);
    sessionId=(await call('Target.attachToTarget',{targetId:t.targetId,flatten:true},null)).sessionId;
    await call('Page.enable');await call('Runtime.enable');
    await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});await call('Target.activateTarget',{targetId:t.targetId},null);
    async function open(mode,shouldGenerate){
      await call('Page.navigate',{url:'https://x.com/home?case='+mode});
      await until(()=>evalIn('document.readyState==="complete"&&window.fixture?.mode==='+JSON.stringify(mode)+'&&typeof replyCopilotAssociationReport==="function"'),'load '+mode);
      const pt=await evalIn('(()=>{const r=document.querySelector("#icon").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
      await call('Input.dispatchMouseEvent',{type:'mousePressed',...pt,button:'left',clickCount:1});
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',...pt,button:'left',clickCount:1});
      await until(()=>evalIn('!!fixture.editor'),'modal '+mode);
      if(shouldGenerate)await until(()=>evalIn('fixture.pending.length===1'),'generate '+mode);
      else await wait(220);
      const state=await evalIn('fixture.result()');
      assert.equal(state.trusted,true,mode);
      assert.equal(state.generated,shouldGenerate?1:0,mode+JSON.stringify(state));
      return state;
    }
    for(const mode of ['good','wrong-link','wrong-route','duplicate-route','missing-route','stale-preview','draft','attachment','late-draft','late-media','late-route','mirror-reject']){
      const shouldGenerate=['good','late-draft','late-media','late-route','mirror-reject'].includes(mode);
      const before=await open(mode,shouldGenerate);
      if(shouldGenerate){
        assert.equal(before.host,true,mode);
        if(mode==='late-draft')await evalIn("fixture.editor.value='user draft';fixture.editor.dispatchEvent(new InputEvent('input',{bubbles:true}))");
        if(mode==='late-media')await evalIn('fixture.addMedia()');
        if(mode==='late-route')await evalIn("history.pushState({},'', '/compose/post?in_reply_to=999');window.dispatchEvent(new PopStateEvent('popstate'))");
        await evalIn('fixture.resolve()');await wait(240);
      }
      const state=await evalIn('fixture.result()');
      assert.equal(state.submits,0,mode);assert.equal(state.generated,shouldGenerate?1:0,mode);if(mode!=='good')assert.equal(state.applied,0,mode);
      assert.equal(state.sourceMatches,true,mode);
      if(mode==='good'){
        const answer=await evalIn('fixture.answer');
        assert.equal(state.inputs,1,JSON.stringify(state));assert.equal(state.value,answer);
        assert.equal(state.model,answer);assert.equal(state.mirror,answer);assert.equal(state.applied,1);assert.match(state.status,/已填入/);
      }else if(mode==='mirror-reject'){
        assert.equal(state.inputs,1,mode);assert.equal(state.model,'',mode);assert.doesNotMatch(state.status,/已填入/);
      }else{
        assert.equal(state.value,['draft','late-draft'].includes(mode)?'user draft':'',JSON.stringify({mode,state}));
        assert.equal(state.inputs,mode==='late-draft'?1:0,mode);
      }
    }
    assert.deepEqual(errors,[]);
  }finally{
    try{await call('Browser.close',{},null)}catch{}child.kill();await wait(120);rmSync(dir,{recursive:true,force:true});
  }
});
