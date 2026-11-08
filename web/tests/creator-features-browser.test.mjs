import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readdirSync,readFileSync} from 'node:fs';
import {withMomentumBrowser} from '../../tests/helpers/momentum-browser.js';

const {buildSync}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const fixture=[
 "import React from 'react';",
 "import {createRoot} from 'react-dom/client';",
 "import Panel from './src/components/admin/CreatorFeaturesPanel.tsx';",
 "import {DEFAULT_MOMENTUM_CONFIG} from '../domain/creator-momentum.js';",
 "window.calls=[];",
 "window.current={...DEFAULT_MOMENTUM_CONFIG};",
 "const root=createRoot(document.getElementById('root'));",
 "const read=async path=>{window.calls.push(['GET',path]);return {config:window.current,paidOnly:true,simulationAvailable:true,versions:[{id:'default-v1',createdAt:1}]}};",
 "const write=async(path,body)=>{window.calls.push(['POST',path,body]);if(path.endsWith('/restore'))window.current={...DEFAULT_MOMENTUM_CONFIG,version:'restored'};else window.current={...body.config,version:'saved-version'};return {ok:true,config:window.current};};",
 "window.render=(language='zh')=>root.render(<Panel language={language} active={true} busy={false} read={read} write={write} confirm={(title,description,action)=>window.confirmation={title,description,action}}/>);",
 "window.render();window.momentumReady=true;"
].join('\n');
const js=buildSync({stdin:{contents:fixture,loader:'tsx',resolveDir:new URL('..',import.meta.url).pathname},jsx:'automatic',bundle:true,format:'iife',write:false}).outputFiles[0].text;
const assets=new URL('../dist/_astro/',import.meta.url);
const css=readdirSync(assets).filter(f=>f.endsWith('.css')).map(f=>readFileSync(new URL(f,assets),'utf8')).join('\n');
test('creator Momentum admin console: low trigger draft, explicit confirm, copy preview, history and responsive layout',{timeout:40000},async()=>{
 await withMomentumBrowser('<html><style>'+css+'</style><div id="root"></div><script>'+js+'</script></html>',async({evaluate,call})=>{
  const wait=async expr=>{for(let i=0;i<150;i++){if(await evaluate(expr))return;await new Promise(r=>setTimeout(r,10));}throw Error('Admin condition timeout: '+expr);};
  const clickTab=async label=>{
   const point=await evaluate(`(()=>{const tab=[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()===${JSON.stringify(label)});const r=tab.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
   await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  };
  await wait('document.body.textContent.includes("default-v1")');
  assert.match(await evaluate('document.body.textContent'),/互动势能运营控制台/);
  assert.match(await evaluate('document.body.textContent'),/已购买用户（固定）/);
  assert.equal(await evaluate('document.querySelectorAll("input[type=number]").length'),7);
  assert.doesNotMatch(await evaluate('[...document.querySelectorAll("label")].filter(label=>label.querySelector("input[type=number]")).map(label=>label.textContent).join(" ")'),/冷却分钟|cooldown minutes/i);
  await evaluate('document.querySelector("[data-testid=momentum-low-preset]").click()');
  await wait('document.body.textContent.includes("低阈值风险")');
  assert.equal(await evaluate('calls.filter(c=>c[0]==="POST").length'),0,'low preset must not auto-publish');
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("input[type=number]")).map(el=>Number(el.value))'),[1,2,3,4,5,6,3]);
  await evaluate('document.querySelector("input[type=checkbox]").click();[...document.querySelectorAll("button")].find(b=>b.textContent==="保存并确认发布").click()');
  await wait('Boolean(window.confirmation)');
  assert.match(await evaluate('confirmation.description'),/全局配置/);
  assert.equal(await evaluate('calls.filter(c=>c[0]==="POST").length'),0,'save must require explicit parent confirmation');
  await evaluate('confirmation.action()');
  await wait('document.body.textContent.includes("saved-version")');
  const published=await evaluate('calls.find(c=>c[0]==="POST")[2]');
  assert.equal(published.config.enabled,true);
  assert.deepEqual(published.config.ranges,[[1,2],[3,4],[5,6]]);
  assert.equal(published.expectedVersion,'default-v1');
  await clickTab('文案管理');
  await wait('Boolean(document.querySelector("textarea"))');
  assert.equal(await evaluate('document.querySelectorAll("textarea").length'),4,'content is organized by one language at a time');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="English").click()');
  assert.match(await evaluate('document.querySelector("textarea").value'),/Creator Momentum Threshold/);
  await clickTab('效果预览');
  await wait('Boolean(document.querySelector("[data-testid=momentum-draft-preview]"))');
  const callsBefore=await evaluate('calls.length');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="阶段 3").click()');
  assert.match(await evaluate('document.querySelector("[data-testid=momentum-draft-preview]").textContent'),/互动势能临界值已触发|Creator Momentum Threshold Reached/);
  assert.equal(await evaluate('calls.length'),callsBefore,'admin draft preview must not call AI or simulator');
  assert.equal(await evaluate('document.body.textContent.includes("模拟阶段")'),false);
  await clickTab('版本记录');
  await wait('[...document.querySelectorAll("button")].some(b=>b.textContent==="恢复此版本")');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="恢复此版本").click()');
  assert.match(await evaluate('confirmation.description'),/审计版本/);
  await evaluate('confirmation.action()');
  await wait('document.body.textContent.includes("restored")');
  assert.equal(await evaluate('calls.at(-2)[1]'),'/v1/admin/creator-momentum/restore');
  await evaluate('window.render("en")');
  await wait('document.body.textContent.includes("Interaction Momentum Console")');
  assert.match(await evaluate('document.body.textContent'),/Purchased PRO only/);
  await call('Emulation.setDeviceMetricsOverride',{width:375,height:850,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'the console should not overflow at 375px');
 });
});