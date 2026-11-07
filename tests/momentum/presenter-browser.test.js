import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {withMomentumBrowser} from '../helpers/momentum-browser.js';

const files = ['content/momentum-presenter.js', 'content/inline-assistant.js'];
const source = paths => paths.map(path => readFileSync(path, 'utf8')).join('\n');
const css = source(['content/inline-assistant.css', 'content/momentum.css']);
const before = path => execFileSync('git', ['show', 'cac9e0e:' + path], {encoding: 'utf8'});
const fixture = scripts => `<html lang="en"><body><textarea id="editor" aria-label="Editor"></textarea><div id="side"></div><script>window.chrome={runtime:{getURL:()=>''}};</script><script>${scripts};window.momentumReady=true;</script></body></html>`;
const setup = styles => `window.actions=[];window.assistant=ZaneReplyCopilotContent.inlineAssistant.mount(document.querySelector("#editor"),(a,v)=>actions.push({a,v}),{preferences:{autoGenerateOnReply:true}});window.shadow=assistant.host.shadowRoot;const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};shadow.append(style);assistant.showResult({natural:'这个例子一下就说明白了。',light_humor:'终于有人把这个坑填了。',thoughtful:'这个区别在实际使用时很重要。'});assistant.setMomentum({status:"free",available:true,eligible:false,policy:{enabled:true}});`;
const screenshots = '/private/tmp/xrh-momentum-acceptance';
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
    assert.equal(await evaluate('Boolean(shadow.querySelector(".momentum-reminder"))'), false);
    await evaluate('assistant.setMomentum({status:"paid",enabled:true,policy:{enabled:true},reminder:{id:"today:2",stage:2}});[...shadow.querySelectorAll(".momentum-reminder button")].find(b=>b.textContent==="今日不再提醒").click()');
    assert.equal(await evaluate('actions.at(-1).a'), 'momentum_dnd');
  });
});

test('side panel and lazy X entry share controls without an initial network request or focus change', {timeout: 30000}, async () => {
  await withMomentumBrowser(fixture(source(files)), async ({evaluate, call}) => {
    await evaluate(`window.sent=[];window.state={status:"free",count:7,policy:{enabled:true,researchZh:"中文榜单研究"}};window.send=async m=>{sent.push(m);if(m.enabled!==undefined) state={...state,enabled:m.enabled};return state;};document.querySelector("#editor").focus();window.entry=ReplyCopilotMomentumPresenter.mountEntry(send);window.root=document.querySelector("[data-zane-reply-copilot]").shadowRoot;`);
    assert.equal(await evaluate('sent.length'), 0);
    assert.equal(await evaluate('document.activeElement.id'), 'editor');
    await evaluate('root.querySelector("summary").click()');
    await evaluate('new Promise(resolve=>setTimeout(resolve,50))');
    assert.equal(await evaluate('sent.length'), 1);
    assert.equal(await evaluate('root.querySelector("input").disabled'), true);
    await evaluate('window.full=ReplyCopilotMomentumPresenter.connect(document.querySelector("#side"),send,()=>{},{mode:"full"});full.refresh()');
    await evaluate('full.expand()');
    assert.match(await evaluate('document.querySelector("#side").textContent'), /本机今日确认生成 · 7.*查看套餐.*中文榜单研究/);
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

test('only a painted visible reminder is acknowledged, and fresh switches keep their status', {timeout: 30000}, async () => {
  await withMomentumBrowser(fixture(source(files)), async ({evaluate}) => {
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
    assert.equal(await evaluate('actions.filter(x=>x.a==="momentum_presented").length'),1);
    await evaluate('shadow.querySelector(".momentum-close").click();assistant.setMomentum({...proof,reminder:{...offer,lease:"replayed"}})');
    assert.equal(await evaluate('shadow.querySelector(".momentum-reminder")===null'),true);
    assert.equal(await evaluate('actions.filter(x=>x.a==="momentum_presented").length'),2);
  });
});
