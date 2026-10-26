import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(root, "dist/staging");
const browser = process.env.CHROME_BINARY || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(path.join(os.tmpdir(), "reply-copilot-extension-chrome-"));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map();
let nextId = 0, buffer = "", chrome;
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
async function attach(url) {
  const target = await call("Target.createTarget", { url });
  const attached = await call("Target.attachToTarget", { targetId: target.result.targetId, flatten: true });
  const session = attached.result.sessionId;
  await call("Runtime.enable", {}, session);
  await call("Page.enable", {}, session);
  await until(async () => (await evalIn(session, "document.readyState === 'complete'")));
  return { session, targetId: target.result.targetId };
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
      try { const result = JSON.parse(line); if (result.id && pending.has(result.id)) { const task = pending.get(result.id); pending.delete(result.id); clearTimeout(task.timer); result.error ? task.reject(new Error(result.error.message)) : task.resolve(result); } } catch {}
    }
  });
  const installed = await call("Extensions.loadUnpacked", { path: extension });
  const id = installed.result.id;
  assert.match(id, /^[a-p]{32}$/);

const page=await attach(`chrome-extension://${id}/options/options.html`),session=page.session;
await evalIn(session, `document.querySelector('[data-panel="data"]').click();chrome.storage.local.set({replyHistory:Array.from({length:30},(_,i)=>({id:'r'+i,reply:'same '+ 'longtext'.repeat(100),events:['selected'],createdAt:new Date(1700000000000+i*1000).toISOString()}))})`);
await until(()=>evalIn(session,"document.querySelector('#history-list').children.length===30"));
for(const [width,height] of [[1200,900],[520,700],[360,480]]){
await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},session);
const r=await evalIn(session,`(()=>{const l=document.querySelector('#history-list');return{h:l.clientHeight,s:l.scrollHeight,w:l.clientWidth,sw:l.scrollWidth}})()`);
assert.ok(r.h<=301&&r.h<=height*.45+1);assert.ok(r.s>r.h);assert.equal(r.w,r.sw);console.log(JSON.stringify({width,height,...r}));}
await evalIn(session,"document.querySelector('#history-list').scrollTop=200");
await evalIn(session,"chrome.storage.local.set({localUsageEvents:[]})");await wait(300);
assert.equal(await evalIn(session,"document.querySelector('#history-list').scrollTop"),200);
await evalIn(session,`chrome.storage.local.get('replyHistory').then(x=>chrome.storage.local.set({replyHistory:[...x.replyHistory,{id:'new',reply:'new reply',events:['selected'],createdAt:new Date().toISOString()}]}))`);
await until(()=>evalIn(session,"document.querySelector('#history-list').firstElementChild.dataset.recordKey==='new'"));
assert.equal(await evalIn(session,"document.querySelector('#history-latest').hidden"),false);
await evalIn(session,"document.querySelector('#history-latest').click()");assert.equal(await evalIn(session,"document.querySelector('#history-list').scrollTop"),0);
console.log('PASS: responsive height, no horizontal overflow, scroll retention and latest navigation');
}finally{if(chrome)chrome.kill();for(const t of pending.values())clearTimeout(t.timer);await wait(200);rmSync(profile,{recursive:true,force:true});}
