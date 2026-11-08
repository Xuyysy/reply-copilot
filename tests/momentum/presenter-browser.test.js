import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {withMomentumBrowser} from '../helpers/momentum-browser.js';

const files = ['content/momentum-presenter.js', 'content/inline-assistant.js'];
const source = paths => paths.map(path => readFileSync(path, 'utf8')).join('\n');
const css = source(['content/inline-assistant.css', 'content/momentum.css']);
const before = path => execFileSync('git', ['show', 'd50a34b:' + path], {encoding: 'utf8'});
const fixture = scripts => `<html lang="en"><body><textarea id="editor" aria-label="Editor"></textarea><div id="side"></div><script>window.chrome={runtime:{getURL:()=>''}};</script><script>${scripts};window.momentumReady=true;</script></body></html>`;
const setup = styles => `window.actions=[];window.assistant=ZaneReplyCopilotContent.inlineAssistant.mount(document.querySelector("#editor"),(a,v)=>actions.push({a,v}),{preferences:{autoGenerateOnReply:true}});window.shadow=assistant.host.shadowRoot;const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};shadow.append(style);assistant.showResult({natural:'这个例子一下就说明白了。',light_humor:'终于有人把这个坑填了。',thoughtful:'这个区别在实际使用时很重要。'});assistant.setMomentum({status:"free",available:true,eligible:false,policy:{enabled:true}});`;
const screenshots = '/private/tmp/xrh-momentum-pro';
async function capture(call, file) {
  mkdirSync(screenshots, {recursive: true});
  const shot = await call('Page.captureScreenshot', {format: 'png'});
  writeFileSync(screenshots + '/' + file, Buffer.from(shot.result.data, 'base64'));
}

test('floating UI defaults to Chinese on English X and keeps only compact controls', {timeout: 30000}, async () => {
  await withMomentumBrowser(fixture(files.map(before).join('\n')), async ({evaluate, call}) => {
    await evaluate(setup(before('content/inline-assistant.css')));
    await capture(call, 'before-light.png');
  });
  await withMomentumBrowser(fixture(source(files)), async ({evaluate, call}) => {
    await evaluate(setup(css));
    assert.equal(await evaluate('shadow.querySelector(".momentum-pro").textContent'), 'PRO');
    assert.match(await evaluate('shadow.querySelector(".momentum").textContent'), /互动势能临界值/);
    assert.equal(await evaluate('shadow.querySelector(".momentum input").disabled'), true);
    assert.equal(await evaluate('shadow.querySelector("#auto-generate-toggle").checked'), true);
    assert.equal(await evaluate('shadow.querySelector(".momentum details").open'), false);
    await capture(call, 'after-light.png');
    await call('Emulation.setDeviceMetricsOverride', {width: 375, height: 850, deviceScaleFactor: 1, mobile: true});
    await evaluate('assistant.host.dataset.theme="dark";shadow.querySelector(".momentum summary").focus()');
    await call('Input.dispatchKeyEvent', {type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32});
    await call('Input.dispatchKeyEvent', {type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32});
    assert.equal(await evaluate('shadow.querySelector(".momentum details").open'), true);
    await evaluate('new Promise(resolve=>setTimeout(resolve,50))');
    assert.match(await evaluate('shadow.querySelector(".momentum-intro").textContent'), /查看完整介绍/);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth && assistant.host.getBoundingClientRect().right<=innerWidth'), true);
    await capture(call, 'after-dark-375.png');
    await evaluate('assistant.setMomentum({status:"paid",enabled:true,policy:{enabled:true},reminder:{id:"today:3",stage:3}})');
    assert.equal(await evaluate('Boolean(shadow.querySelector(".momentum-reminder"))'), true);
    await evaluate('shadow.querySelector(".momentum-close").click();assistant.setMomentum({status:"paid",enabled:true,policy:{enabled:true},reminder:{id:"today:3",stage:3}})');
    assert.equal(await evaluate('Boolean(shadow.querySelector(".momentum-reminder"))'), true,
      'an untrusted synthetic click must not acknowledge and consume a real reminder');
    await evaluate('assistant.setMomentum({status:"paid",enabled:true,policy:{enabled:true},reminder:{id:"today:2",stage:2}});[...shadow.querySelectorAll(".momentum-reminder button")].find(b=>b.textContent==="今日不再提醒").click()');
    assert.equal(await evaluate('actions.at(-1).a'), 'momentum_dnd');
  });
});

test('side panel and lazy X entry share controls without an initial network request or focus change', {timeout: 30000}, async () => {
  await withMomentumBrowser(fixture(source(files)), async ({evaluate, call}) => {
    await evaluate(`window.sent=[];window.state={status:"free",count:7,policy:{enabled:true,researchZh:"中文榜单研究"}};window.send=async m=>{sent.push(m);if(m.enabled!==undefined) state={...state,enabled:m.enabled};return {...state,saved:m.enabled!==undefined};};document.querySelector("#editor").focus();window.entry=ReplyCopilotMomentumPresenter.mountEntry(send);window.root=document.querySelector("[data-zane-reply-copilot]").shadowRoot;`);
    assert.equal(await evaluate('sent.length'), 0);
    assert.equal(await evaluate('document.activeElement.id'), 'editor');
    await evaluate('root.querySelector("summary").click()');
    await evaluate('new Promise(resolve=>setTimeout(resolve,50))');
    assert.equal(await evaluate('sent.length'), 1);
    assert.equal(await evaluate('root.querySelector("input").disabled'), true);
    await evaluate('window.full=ReplyCopilotMomentumPresenter.connect(document.querySelector("#side"),send,()=>{},{mode:"full"});full.refresh()');
    await evaluate('full.expand()');
    assert.doesNotMatch(await evaluate('document.querySelector("#side").textContent'), /本机今日确认生成|· 7/);
    assert.match(await evaluate('document.querySelector("#side").textContent'), /查看套餐.*中文榜单研究/);
    await evaluate('state={...state,status:"paid",enabled:false};Promise.all([full.refresh(),entry.sync()])');
    await evaluate('document.querySelector("#side input").click()');
    await evaluate('entry.sync();new Promise(resolve=>setTimeout(resolve,30))');
    assert.equal(await evaluate('root.querySelector("input").checked'), true);
    const init = await evaluate(`(() => {const elapsed=[];for(let i=0;i<30;i++){const start=performance.now();for(let n=0;n<25;n++){const chip=ReplyCopilotMomentumPresenter.mountEntry(send);chip.remove();}elapsed.push((performance.now()-start)/25);}return elapsed.sort((a,b)=>a-b);})()`);
    console.log('Collapsed independent entry init P50/P90 (ms):', init[14], init[26]);
    await call('Emulation.setDeviceMetricsOverride', {width: 375, height: 850, deviceScaleFactor: 1, mobile: true});
    assert.equal(await evaluate('root.querySelector(".momentum-entry").getBoundingClientRect().right<=innerWidth'), true);
  });
});

test('a reminder is not consumed on render, and only a visible trusted close acknowledges it', {timeout: 30000}, async () => {
  await withMomentumBrowser(fixture(source(files)), async ({evaluate,call}) => {
    await evaluate(setup(css));
    await evaluate(`window.proof={status:'paid', enabled:true, proofUntil:Date.now()+60000, policy:{enabled:true}};
      window.offer={id:'test:1',stage:1,lease:'test-lease',expiresAt:Date.now()+10000};
      assistant.setMomentum(proof);
      shadow.querySelector('.momentum input').click();`);
    assert.doesNotMatch(await evaluate('shadow.querySelector(".momentum small").textContent'), /正在验证/);
    await evaluate('assistant.setMomentum({...proof,reminder:offer});assistant.close();new Promise(r=>setTimeout(r,100))');
    assert.equal(await evaluate('actions.filter(x=>x.a==="momentum_presented").length'),0);
    await evaluate('{'+setup(css)+'}');
    await evaluate('assistant.setMomentum({...proof,reminder:offer});new Promise(r=>setTimeout(r,120))');
    assert.equal(await evaluate('actions.filter(x=>x.a==="momentum_presented").length'),0,'paint does not acknowledge');
    const point=await evaluate('(()=>{const r=shadow.querySelector(".momentum-close").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
    assert.equal(await evaluate('actions.filter(x=>x.a==="momentum_presented").length'),1,'visible trusted close acknowledges once');
    await evaluate('assistant.setMomentum({...proof,reminder:{...offer,lease:"replayed"}})');
    assert.equal(await evaluate('shadow.querySelector(".momentum-reminder")===null'),true);
    assert.equal(await evaluate('actions.filter(x=>x.a==="momentum_presented").length'),1);
  });
});

test('paid switch gives immediate feedback, rolls back a failed save, and locks while paused',{timeout:30000},async()=>{
 await withMomentumBrowser(fixture(source(files)),async({evaluate,call})=>{
  await evaluate(setup(css));
  await evaluate(`window.switcher=shadow.querySelector('.momentum input');
   window.live={scope:1,status:'paid',enabled:false,proofUntil:Date.now()+10000,policy:{enabled:true}};
   assistant.setMomentum(live);switcher.click();`);
  assert.equal(await evaluate('switcher.checked && !switcher.disabled'),true);
  const firstIntent=await evaluate('actions.at(-1).v.intent');
  await capture(call,'switch-floating-after.png');
  await evaluate('switcher.click()');
  assert.equal(await evaluate('actions.filter(x=>x.a==="momentum_toggle").length'),2);
  await evaluate(`assistant.setMomentum({ok:false},{enabled:true,intent:${firstIntent}})`);
  assert.equal(await evaluate('switcher.checked'),false,'stale failure must not roll back the newer OFF intent');
  const latest=await evaluate('actions.at(-1).v');
  await evaluate(`assistant.setMomentum({ok:false},{enabled:${latest.enabled},intent:${latest.intent}})`);
  assert.equal(await evaluate('switcher.checked'),false);
  assert.match(await evaluate('shadow.querySelector(".momentum small").textContent'),/设置未保存/);
  await evaluate('switcher.click()');
  const success=await evaluate('actions.at(-1).v');
  await evaluate(`assistant.setMomentum({...live,enabled:true,saved:true},{enabled:true,intent:${success.intent}})`);
  assert.equal(await evaluate('switcher.checked && !switcher.disabled'),true);
  await evaluate('assistant.setMomentum({...live,enabled:true,policy:{enabled:false}})');
  assert.equal(await evaluate('switcher.disabled && switcher.checked'),true);
  assert.match(await evaluate('shadow.querySelector(".momentum small").textContent'),/系统暂未开放/);
 });
});

test('30 rapid toggle clicks stay interactive and persist the last user intent', {timeout:30000},async()=>{
 await withMomentumBrowser(fixture(source(files)),async({evaluate})=>{
  await evaluate(`window.calls=[];window.resolveFirst=null;
   window.proof={scope:'account-a',status:'paid',available:true,eligible:true,enabled:false,proofUntil:Date.now()+60000,policy:{enabled:true}};
   window.send=message=>{calls.push(message);if(message.ensure)return Promise.resolve({...proof});if(typeof message.enabled==='boolean'){
    if(!resolveFirst)return new Promise(resolve=>{resolveFirst=()=>resolve({...proof,enabled:message.enabled,saved:message.enabled});});
    return Promise.resolve({...proof,enabled:message.enabled,saved:message.enabled});}
    return Promise.resolve({...proof});};
   window.control=ReplyCopilotMomentumPresenter.connect(document.querySelector('#side'),send,()=>{});
   control.refresh({ensure:true});`);
  await evaluate('new Promise(resolve=>setTimeout(resolve,25))');
  await evaluate(`window.switcher=document.querySelector('#side input');switcher.click();`);
  assert.equal(await evaluate('switcher.checked && !switcher.disabled'),true,'first click updates immediately');
  await evaluate('for(let i=1;i<30;i++)switcher.click()');
  assert.equal(await evaluate('calls.filter(x=>typeof x.enabled==="boolean").length'),1,'queued intermediate clicks are coalesced while the first write is pending');
  assert.equal(await evaluate('switcher.disabled'),false);
  assert.equal(await evaluate('switcher.checked'),false,'30th click is the visible last intent');
  await evaluate('resolveFirst();new Promise(resolve=>setTimeout(resolve,50))');
  const outcome=await evaluate('({writes:calls.filter(x=>typeof x.enabled==="boolean").map(x=>x.enabled),checked:switcher.checked,disabled:switcher.disabled})');
  assert.deepEqual(outcome,{writes:[true,false],checked:false,disabled:false});
 });
});

test('capture before and after for the same paid side panel fixture', {timeout:30000}, async()=>{
 for(const [name,code,styles] of [['before',files.map(before).join('\n'),before('content/momentum.css')],['after',source(files),css]]){
  await withMomentumBrowser(fixture(code),async({evaluate,call})=>{
   await evaluate(`{const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);
   window.events=[];window.panel=ReplyCopilotMomentumPresenter.mount(document.querySelector('#side'),a=>events.push(a),{mode:'full'});
   panel.update({status:'paid',scope:1,enabled:false,count:21,proofUntil:Date.now()+10000,policy:{enabled:true}});}`);
   assert.equal(await evaluate('document.querySelector("#side").textContent.includes("· 21")'),false);
   await capture(call,'count-'+name+'.png');
   await evaluate('document.querySelector("#side input").click()');
   assert.equal(await evaluate('document.querySelector("#side input").checked'),true);
   await capture(call,'switch-'+name+'.png');
  });
 }
});

test('three Staging previews use saved copy and dismiss without sending real actions', {timeout:30000},async()=>{
 await withMomentumBrowser(fixture(source(files)),async({evaluate,call})=>{
  await evaluate(setup(css));
  await evaluate('assistant.setMomentum({status:"paid",enabled:true,policy:{enabled:true}})');
  await capture(call,'pro-active.png');
  for(const [frame,time] of [0,35,70,110,170].entries()){
   await evaluate(`(() => {const a=shadow.querySelector(".momentum-pro").getAnimations()[0];a.pause();a.currentTime=${time};})()`);
   await capture(call,'pro-frame-'+frame+'.png');
  }
  const animation=await evaluate('getComputedStyle(shadow.querySelector(".momentum-pro")).animationName');
  assert.equal(animation,'momentum-pro-activate');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate('getComputedStyle(shadow.querySelector(".momentum-pro")).animationName'),'none');
  for(const stage of [1,2,3]){
   await evaluate(`assistant.previewMomentum({stage:${stage},titleZh:"已保存标题",bodyZh:"已保存正文"});`);
   assert.match(await evaluate('shadow.querySelector(".momentum-gate:not(.hidden)").textContent'),new RegExp('阶段 '+stage+'.*已保存标题.*已保存正文', 's'));
   if(stage===2) await evaluate('assistant.host.dataset.theme="dark"');
   if(stage===3) await call('Emulation.setDeviceMetricsOverride',{width:375,height:850,deviceScaleFactor:1,mobile:true});
   assert.deepEqual(await evaluate('[...shadow.querySelectorAll(".momentum-gate-track i")].map(node=>node.dataset.state)'), [1,2,3].map(node=>node===stage?'current':node<stage?'complete':'upcoming'));
   assert.equal(await evaluate('getComputedStyle(shadow.querySelector(".momentum-gate")).animationName'),'none');
   await capture(call,'preview-stage-'+stage+'.png');
   await evaluate('[...shadow.querySelectorAll(".momentum-gate:not(.hidden) button")].find(b=>b.textContent==="今日不再提醒").click()');
   assert.equal(await evaluate('!!shadow.querySelector(".momentum-gate:not(.hidden)")'),false);
  }
  assert.deepEqual(await evaluate('actions'),[]);
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await evaluate('assistant.previewMomentum({stage:1});');
  assert.equal(await evaluate('getComputedStyle(shadow.querySelector(".momentum-gate")).animationName'),'gate-enter');
  for (const [index, time] of [0, 50, 100, 160, 210, 300, 450, 600, 750].entries()) {
   await evaluate(`shadow.querySelector(".momentum-gate").getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=${time};});`);
   await capture(call,'milestone-frame-'+index+'.png');
  }
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  assert.equal(await evaluate('!!shadow.querySelector(".momentum-gate:not(.hidden)")'),false);
  assert.deepEqual(await evaluate('actions'),[]);
 });
});

test('three switch surfaces keep the toggle responsive through 30 rapid saves and preserve the last intent', {timeout:30000},async()=>{
 await withMomentumBrowser(fixture(source(files)),async({evaluate})=>{
  const result=await evaluate(`(async()=>{
    const {mount,connect,request}=ReplyCopilotMomentumPresenter;
    const proof={scope:'same-account',status:'paid',enabled:false,policy:{enabled:true},proofUntil:Date.now()+60000};
    const results=[];
    for(const surface of ['floating','independent','sidepanel']){
      const container=document.createElement('div');document.body.append(container);
      let saved=false, calls=[], releaseFirst;
      const firstGate=new Promise(resolve=>releaseFirst=resolve);
      const send=async message=>{if(typeof message.enabled==='boolean'){calls.push(message.enabled);if(calls.length===1)await firstGate;saved=message.enabled;}return {...proof,enabled:saved,saved:true};};
      const entry=connect(container,send,()=>{},{mode:surface==='sidepanel'?'full':'compact'});
      await entry.refresh();
      const toggle=container.querySelector('input');
      for(let i=0;i<100&&toggle.disabled;i++)await new Promise(resolve=>setTimeout(resolve,5));
      if(toggle.disabled)throw Error('paid proof did not finish loading before the rapid-click phase');
      for(let i=0;i<30;i++){
        toggle.click();
        if(toggle.checked!==(i%2===0)||toggle.disabled)throw Error('toggle locked or failed to reflect the latest intent immediately: '+JSON.stringify({surface,i,checked:toggle.checked,disabled:toggle.disabled,status:container.textContent}));
      }
      releaseFirst();
      for(let i=0;i<100&&calls.length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));
      if(calls.length!==2||calls[1]!==false||saved!==false||toggle.checked!==false||toggle.disabled)throw Error('last intent was not persisted after coalescing intermediate clicks');
      results.push(calls);container.remove();
    }
    return {results};
  })()`);
  assert.deepEqual(result,{results:[[true,false],[true,false],[true,false]]});
 });
});

test('reply gate is prominent, keyboard dismissible, and emits an explicit confirmation action',{timeout:30000},async()=>{
 await withMomentumBrowser(fixture(source(files)),async({evaluate,call})=>{
  await evaluate(setup(css));
  await evaluate('assistant.showMomentumGate({id:"2026-11-08:2",stage:2,lease:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},{titleZh:"后台提醒标题",bodyZh:"后台提醒正文"})');
  assert.equal(await evaluate('shadow.querySelector("[role=dialog][aria-modal=true]").classList.contains("hidden")'),false);
  assert.match(await evaluate('shadow.querySelector(".momentum-gate").textContent'),/阶段 2.*后台提醒标题.*后台提醒正文/s);
  assert.equal(await evaluate('shadow.activeElement===shadow.querySelector(".momentum-gate")'),true);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await capture(call,'reply-before-generation-gate.png');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await evaluate('actions.at(-1).a'), 'momentum_gate_dismiss');
  assert.equal(await evaluate('actions.at(-1).v.lease'),'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
 });
});
