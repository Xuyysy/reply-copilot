import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = process.env.RC_TEST_EXTENSION || path.join(root, "dist/staging");
const browser = process.env.CHROME_BINARY || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(path.join(os.tmpdir(), "reply-copilot-extension-chrome-"));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map();
let nextId = 0, buffer = "", chrome;
let onEvent = () => {};
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });
}
async function until(check, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const value = await check(); if (value) return value; } catch {} await wait(100); }
  throw new Error("Timed out waiting for extension UI");
}
async function evalIn(session, expression) {
  const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
  if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
  return response.result.result.value;
}
async function click(session, selector) {
  await evalIn(session, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  const point = await evalIn(session, `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, session);
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, session);
}
try {
  assert.ok(existsSync(browser)); assert.ok(existsSync(extension));
  chrome = spawn(browser, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--window-size=1240,900", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  chrome.stdio[4].on("data", chunk => {
    buffer += chunk.toString(); let offset;
    while ((offset = buffer.indexOf("\0")) >= 0) {
      const line = buffer.slice(0, offset); buffer = buffer.slice(offset + 1);
      try { const result = JSON.parse(line); if (result.id && pending.has(result.id)) { const task = pending.get(result.id); pending.delete(result.id); clearTimeout(task.timer); result.error ? task.reject(new Error(result.error.message)) : task.resolve(result); } else if (result.method) onEvent(result); } catch {}
    }
  });
  const installed = await call("Extensions.loadUnpacked", { path: extension });
  const id = installed.result.id;
  assert.match(id, /^[a-p]{32}$/);

  const acceptance = process.env.RC_MOMENTUM_ACCEPTANCE === "1";
  let workerSession;
  const fixtureCalls=[];
  const target = (await call("Target.createTarget", {url:"about:blank"})).result.targetId;
  const session = (await call("Target.attachToTarget",{targetId:target,flatten:true})).result.sessionId;
  await call("Page.enable",{},session);
  await call("Runtime.enable",{},session);
  await call("Target.activateTarget",{targetId:target});
  await call("Fetch.enable",{patterns:[{urlPattern:"https://x.com/*"}]},session);
  const html=`<!doctype html><meta charset="utf-8"><article><a href="/fixture/status/123">post</a><div data-testid="tweetText">A synthetic post for checking side panel activation.</div><button id="reply" data-testid="reply">Reply</button></article><script>
  document.querySelector('#reply').onclick=()=>{const modal=document.createElement('section');modal.setAttribute('role','dialog');modal.innerHTML='<article><a href="/fixture/status/123">post</a><div data-testid="tweetText">A synthetic post for checking side panel activation.</div></article><div role="textbox" contenteditable="true" style="min-height:35px;width:220px;border:1px solid"></div>';document.body.append(modal);modal.querySelector('[role=textbox]').focus()};
  </script>`;
  onEvent=e=>{
    if(e.method==='Runtime.exceptionThrown'){console.error(e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text);return;}
    if(e.method!=='Fetch.requestPaused')return;
    const url=new URL(e.params.request.url);
    if(url.hostname==='x.com'){
      void call("Fetch.fulfillRequest",{requestId:e.params.requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"text/html"}],body:Buffer.from(html).toString('base64')},e.sessionId);
      return;
    }
    fixtureCalls.push(url.pathname);
    const quota={totalRemaining:10,freeRemaining:0,paidRemaining:10};
    const data=url.search ? {features:{interactionMomentum:{ownerId:'fixture',eligible:true,policy:{version:'fixture',enabled:true,ranges:[[500,650],[850,1100],[1350,1700]],maxReminders:3,cooldownMinutes:90,overviewZh:'介绍',overviewEn:'Overview',researchZh:'研究',researchEn:'Research',titleZh:'后台保存的测试标题',titleEn:'Title',bodyZh:'后台保存的测试正文',bodyEn:'Body'}}}} :
      url.pathname==='/v1/me' ? {user:{userId:'fixture',username:'fixture'}} : {status:'credits_available',quota};
    void call("Fetch.fulfillRequest",{requestId:e.params.requestId,responseCode:url.pathname.includes('/ai/')?500:200,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(data)).toString('base64')},e.sessionId);
  };
  await call("Page.navigate",{url:"https://x.com/fixture/status/123"},session);
  try {await until(()=>evalIn(session,'!!document.querySelector("#reply")'));}
  catch(error){console.error(await evalIn(session,'[location.href,document.body?.innerText?.slice(0,100),document.querySelectorAll("[data-zane-reply-copilot]").length]'));throw error;}
  const entry=process.env.RC_PANEL_ENTRY||(acceptance?'details':'footer');
  await until(()=>evalIn(session,'!!document.querySelector("[data-zane-reply-copilot]")'));
  if(entry!=="independent")await click(session,"#reply");
  const button=entry==="footer" ? '[data-action="sidepanel"]' : '.momentum-intro button';
  if(entry!=="footer"){
    const surface=entry==="independent"?".momentum-entry":".panel";
    await until(()=>evalIn(session,`[...document.querySelectorAll("[data-zane-reply-copilot]")].some(host=>host.shadowRoot?.querySelector(${JSON.stringify(surface)}))`));
    await evalIn(session,`(() => {
      const hosts=[...document.querySelectorAll('[data-zane-reply-copilot]')];
      const root=hosts.find(host=>host.shadowRoot?.querySelector(${JSON.stringify(entry==="independent"?".momentum-entry":".panel")})).shadowRoot;
      if(${JSON.stringify(entry)}==="independent"){
        root.querySelector(".momentum-entry").open=true;
        setTimeout(()=>{root.querySelector(".momentum-details").open=true;},100);
      } else root.querySelector(".momentum-details").open=true;
    })()`);
  }
  const position=await until(()=>evalIn(session,`(()=>{for(const host of document.querySelectorAll('[data-zane-reply-copilot]')){const button=host.shadowRoot?.querySelector(${JSON.stringify(button)});if(!button)continue;const r=button.getBoundingClientRect();if(!r.width||!r.height)continue;return{x:r.x+r.width/2,y:r.y+r.height/2};}return null;})()`));
  assert.equal((await call("Target.getTargets")).result.targetInfos.some(t=>t.url===`chrome-extension://${id}/sidepanel/sidepanel.html`),false);
  await call("Input.dispatchMouseEvent",{type:"mousePressed",...position,button:"left",clickCount:1},session);
  await call("Input.dispatchMouseEvent",{type:"mouseReleased",...position,button:"left",clickCount:1},session);
  const panel=await until(async()=> (await call("Target.getTargets")).result.targetInfos.find(t=>t.url===`chrome-extension://${id}/sidepanel/sidepanel.html`),5000);
  const panelSession=(await call("Target.attachToTarget",{targetId:panel.targetId,flatten:true})).result.sessionId;
  await until(()=>evalIn(panelSession,'document.querySelector("header h1")?.textContent==="x-Reply-Helper"'));
  if(entry!=="footer")await until(()=>evalIn(panelSession,'document.querySelector("#momentum-control details")?.open===true'));
  console.log(JSON.stringify({entry,result:"native side panel target opened by trusted X fixture click",targetType:panel.type,syntheticX:true}));
  if (acceptance) {
    const worker = await until(async()=> (await call("Target.getTargets")).result.targetInfos.find(t=>t.type==="service_worker"&&t.url.startsWith(`chrome-extension://${id}/`)));
    workerSession = (await call("Target.attachToTarget",{targetId:worker.targetId,flatten:true})).result.sessionId;
    await call("Runtime.enable",{},workerSession);
    await until(()=>evalIn(workerSession,'typeof chrome!=="undefined" && !!chrome.storage?.local'));
    await call("Fetch.enable",{patterns:[{urlPattern:"https://api-staging.x-reply-helper.top/*"}]},workerSession);
    await evalIn(panelSession,'chrome.storage.local.set({replyCopilotAccountToken:"isolated-fixture",behaviorPreferences:{autoGenerateOnReply:true}})');

  }
  if(acceptance){
    await call("Page.enable",{},panelSession);
    const out=process.env.RC_MOMENTUM_ARTIFACTS;
    await until(()=>evalIn(panelSession,'!!document.querySelector("#momentum-control .momentum-tools button")'));
    await click(panelSession,'#momentum-control .momentum-tools button');
    await until(()=>evalIn(panelSession,'!!document.querySelector("select[aria-label=预览阶段]") && !document.querySelector("#momentum-control input").disabled'));
    const storageBefore=await evalIn(panelSession,"chrome.storage.local.get(null)");
    const state=()=>evalIn(panelSession,`(async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('xrh-creator-momentum-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try {
        const tx=db.transaction(['days','prefs','seen'],'readonly');
        const read=store=>new Promise((resolve,reject)=>{const r=tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        return await Promise.all(['days','prefs','seen'].map(read));
      } finally {db.close();}
    })()`);
    const before=await state();
    const popup='[...document.querySelectorAll("[data-zane-reply-copilot]")].find(h=>h.shadowRoot?.querySelector(".panel"))?.shadowRoot';
    await evalIn(session,'document.querySelectorAll("section[role=dialog]").forEach(node=>node.remove())');
    await new Promise(resolve=>setTimeout(resolve,100));
    await call("Target.activateTarget",{targetId:target});
    await evalIn(panelSession,'document.querySelector("select[aria-label=预览阶段]").value="2"');
    await click(panelSession,'#momentum-control + section .dashboard-actions button:nth-child(2)');
    const armStatus=await until(()=>evalIn(panelSession,'document.querySelector("#momentum-control + section [role=status]").textContent||null'));
    assert.match(armStatus,/已设置/,`Staging next-reply simulation could not be armed: ${armStatus}`);
    await click(session,"#reply");
    await until(()=>evalIn(session,`${popup}?.querySelector(".momentum-gate:not(.hidden)")`));
    assert.equal(fixtureCalls.filter(path=>path.includes("/ai/")).length,0,"armed Staging simulation must not call AI before dismissal");
    if(out){
      await evalIn(session,"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const shot=await call("Page.captureScreenshot",{format:"png"},session);
      writeFileSync(path.join(out,"native-reply-before-generation-gate.png"),Buffer.from(shot.result.data,"base64"));
    }
    const closePoint=await evalIn(session,`(()=>{const r=${popup}.querySelector(".momentum-gate-primary").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await call("Input.dispatchMouseEvent",{type:"mousePressed",...closePoint,button:"left",clickCount:1},session);
    await call("Input.dispatchMouseEvent",{type:"mouseReleased",...closePoint,button:"left",clickCount:1},session);
    await until(()=>evalIn(session,`${popup}?.querySelector(".momentum-gate.hidden")`));
    assert.equal(fixtureCalls.filter(path=>path.includes("/ai/")).length,0,"Staging simulation must suppress AI even when auto-generation is on");
    assert.deepEqual(await state(),before,"Staging simulated reply gate must leave daily counts, preferences and acknowledgements unchanged");
    console.log(JSON.stringify({armedNextReply:true,replyComposerOpened:true,gateShownBeforeGeneration:true,dismissed:true,autoGenerateSetting:true,aiRequests:0,simulationStateUnchanged:true}));
    const startupTabs=(await call("Target.getTargets")).result.targetInfos.filter(t=>t.url.startsWith(`chrome-extension://${id}/onboarding/`));
    for(const tab of startupTabs) await call("Target.closeTarget",{targetId:tab.targetId});
    await call("Target.activateTarget",{targetId:target});
    const otherWindow=(await call("Target.createTarget",{url:"about:blank",newWindow:true})).result.targetId;
    const ownWindow=(await call("Browser.getWindowForTarget",{targetId:target})).result.windowId;
    const alternateWindow=(await call("Browser.getWindowForTarget",{targetId:otherWindow})).result.windowId;
    assert.notEqual(ownWindow,alternateWindow);
    await call("Target.activateTarget",{targetId:target});
    console.log(JSON.stringify({twoChromeWindows:true,activeTabExposesUrl:await evalIn(panelSession,'chrome.windows.getCurrent().then(w=>chrome.tabs.query({active:true,windowId:w.id})).then(([tab])=>({id:tab?.id,url:tab?.url,windowId:tab?.windowId}))')}));
    if(process.env.RC_EXPECT_PREVIEW_BLOCKED==='1'){
      await click(panelSession,'#momentum-control + section button');
      const rejection=await until(()=>evalIn(panelSession,'document.querySelector("#momentum-control + section [role=status]").textContent'));
      assert.match(rejection,/请切回当前窗口的 X 标签页/);
      console.log(JSON.stringify({baselineBlocked:true,rejection}));
    } else {
    for(const stage of [1,2,3]){
      await evalIn(panelSession,`document.querySelector("select[aria-label=预览阶段]").value="${stage}"`);
      await click(panelSession,'#momentum-control + section button');
      try { await until(()=>evalIn(session,`${popup}?.querySelector(".momentum-gate:not(.hidden)")?.textContent.includes("阶段 ${stage}")`),4000); }
      catch(error){console.error(await evalIn(panelSession,'document.querySelector("#momentum-control + section [role=status]").textContent'));console.error(await evalIn(session,`[document.visibilityState,!!(${popup}),!!document.querySelector('[role=dialog]')]`));throw error;}
      assert.match(await evalIn(session,`${popup}.querySelector(".momentum-gate:not(.hidden)").textContent`),/后台保存的测试标题.*后台保存的测试正文/);
      await until(()=>evalIn(panelSession,'document.querySelector("#momentum-control + section [role=status]").textContent.includes("已在 X 回复浮窗显示")'));
      if(out){
        await evalIn(session,"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        const shot=await call("Page.captureScreenshot",{format:"png"},session);
        writeFileSync(path.join(out,`native-preview-${stage}.png`),Buffer.from(shot.result.data,"base64"));
      }
      await evalIn(session,`[...${popup}.querySelectorAll(".momentum-gate:not(.hidden) button")].find(b=>b.textContent==="今日不再提醒").click()`);
    }
    await evalIn(session,`${popup}.querySelector('[data-action=minimize]').click()`);
    await click(panelSession,'#momentum-control + section button');
    await until(()=>evalIn(panelSession,'document.querySelector("#momentum-control + section [role=status]").textContent.includes("不可见")'));
    await evalIn(session,`${popup}.querySelector('[data-action=minimize]').click()`);
    assert.deepEqual(await state(),before);
    assert.deepEqual(await evalIn(panelSession,"chrome.storage.local.get(null)"),storageBefore);
    for(const [name,sessionId,control] of [
      ['sidepanel',panelSession,'document.querySelector("#momentum-control input")'],
      ['floating',session,`${popup}.querySelector(".momentum input")`],
      ['independent',session,'[...document.querySelectorAll("[data-zane-reply-copilot]")].find(h=>h.shadowRoot?.querySelector(".momentum-entry"))?.shadowRoot.querySelector(".momentum input")']
    ]){
      if(name==='independent'){
        await evalIn(session,'document.querySelector("[role=dialog]").remove();[...document.querySelectorAll("[data-zane-reply-copilot]")].map(h=>h.shadowRoot?.querySelector(".momentum-entry")).find(Boolean).open=true');
      }
      for(let i=0;i<20;i++){
        const next=i%2===0;
        await until(()=>evalIn(sessionId,`!!(${control})&&!((${control}).disabled)`));
        await evalIn(sessionId,`(${control}).focus()`);
        await call("Input.dispatchKeyEvent",{type:"keyDown",key:" ",code:"Space",windowsVirtualKeyCode:32},sessionId);
        await call("Input.dispatchKeyEvent",{type:"keyUp",key:" ",code:"Space",windowsVirtualKeyCode:32},sessionId);
        await until(()=>evalIn(sessionId,`!(${control}).disabled&&(${control}).checked===${next}`));
        await until(async()=> (await state())[1][0]?.enabled===next);
        assert.equal((await state())[1][0].enabled,next);
      }
      console.log(JSON.stringify({entry:name,successfulToggles:20}));
    }
    assert.equal(fixtureCalls.filter(path=>path.includes("/ai/")).length,0);
    console.log(JSON.stringify({previewStages:[1,2,3],previewStorageUnchanged:true,aiRequests:0}));
    }
  }
  if(process.env.RC_EXTENSION_SCREENSHOT){
    await call("Page.enable",{},panelSession);
    const screenshot=await call("Page.captureScreenshot",{format:"png"},panelSession);
    writeFileSync(process.env.RC_EXTENSION_SCREENSHOT,Buffer.from(screenshot.result.data,"base64"));
  }
} finally {
  if(chrome && chrome.exitCode===null){
    const exited=new Promise(r=>chrome.once('exit',r));
    void call('Browser.close').catch(()=>{});
    const timer=setTimeout(()=>chrome.kill(),1500);await exited;clearTimeout(timer);
  }
  rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
