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
  chrome = spawn(browser, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--window-size=520,900", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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

  const target = (await call("Target.createTarget", {url:"about:blank"})).result.targetId;
  const session = (await call("Target.attachToTarget",{targetId:target,flatten:true})).result.sessionId;
  await call("Page.enable",{},session);
  await call("Fetch.enable",{patterns:[{urlPattern:"https://x.com/*"}]},session);
  const html=`<!doctype html><meta charset="utf-8"><article><a href="/fixture/status/123">post</a><div data-testid="tweetText">A synthetic post for checking side panel activation.</div><button id="reply" data-testid="reply">Reply</button></article><script>
  document.querySelector('#reply').onclick=()=>{const modal=document.createElement('section');modal.setAttribute('role','dialog');modal.innerHTML='<article><a href="/fixture/status/123">post</a><div data-testid="tweetText">A synthetic post for checking side panel activation.</div></article><div role="textbox" contenteditable="true" style="min-height:35px;width:220px;border:1px solid"></div>';document.body.append(modal);modal.querySelector('[role=textbox]').focus()};
  </script>`;
  onEvent=e=>{
    if(e.method==='Fetch.requestPaused')void call("Fetch.fulfillRequest",{requestId:e.params.requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"text/html"}],body:Buffer.from(html).toString('base64')},e.sessionId);
  };
  await call("Page.navigate",{url:"https://x.com/fixture/status/123"},session);
  await until(()=>evalIn(session,'!!document.querySelector("#reply") && !!document.querySelector("[data-zane-reply-copilot]")'));
  const entry=process.env.RC_PANEL_ENTRY||"footer";
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
