import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(root, "dist/development");
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
  const actionTarget = await call("Target.createTarget", { url: "about:blank" });
  let toolbarAction = false, toolbarActionError = "";
  try { await call("Extensions.triggerAction", { id, targetId: actionTarget.result.targetId }); toolbarAction = true; } catch (error) { toolbarActionError = error.message; }
  const panel = await attach(`chrome-extension://${id}/sidepanel/sidepanel.html`);
  await call("Target.activateTarget", { targetId: panel.targetId });
  assert.equal(await evalIn(panel.session, "chrome.runtime.getManifest().name"), "x-Reply-Helper");
  assert.equal(await evalIn(panel.session, "chrome.runtime.getManifest().action.default_title"), "x-Reply-Helper");
  assert.equal(await evalIn(panel.session, "document.querySelector('header h1').textContent"), "x-Reply-Helper");
  await until(() => evalIn(panel.session, "Boolean(document.querySelector('#dashboard') && !document.querySelector('#dashboard').classList.contains('hidden') && document.querySelector('#account-name').textContent !== '正在读取账户…')"));
  assert.equal(await evalIn(panel.session, "document.querySelector('#quick-auto').checked"), true);
  await click(panel.session, "#quick-auto");
  await until(() => evalIn(panel.session, "document.querySelector('#quick-auto').checked === false"));
  assert.equal(await evalIn(panel.session, "chrome.storage.local.get('behaviorPreferences').then(x=>x.behaviorPreferences.autoGenerateOnReply)"), false);
  await call("Page.reload", { ignoreCache: true }, panel.session);
  await until(() => evalIn(panel.session, "document.readyState === 'complete' && document.querySelector('#quick-auto')?.checked === false"));
  const options = await attach(`chrome-extension://${id}/options/options.html`);
  await until(() => evalIn(options.session, "Boolean(document.querySelector('#auto-generate'))"));
  assert.equal(await evalIn(options.session, "document.title"), "x-Reply-Helper 设置中心");
  assert.equal(await evalIn(options.session, "document.querySelector('.brand strong').textContent"), "x-Reply-Helper");
  const onboarding = await attach(`chrome-extension://${id}/onboarding/onboarding.html`);
  assert.equal(await evalIn(onboarding.session, "document.title"), "欢迎使用 x-Reply-Helper");
  assert.equal(await evalIn(onboarding.session, "document.querySelector('.brand').textContent.trim()"), "x-Reply-Helper · 客户端测试版");
  assert.equal(await evalIn(options.session, "document.querySelector('#auto-generate').checked"), false);
  await evalIn(options.session, "chrome.storage.local.set({behaviorPreferences:{autoGenerateOnReply:true,showFloatingWindow:true,rememberFloatingPosition:true,floatingPosition:null,defaultReplyMode:'natural'}})");
  await until(() => evalIn(panel.session, "document.querySelector('#quick-auto').checked === true"));
  const stale = { requestId: crypto.randomUUID(), sourceText: "old post", sourceUrl: "https://x.com/a/status/123", createdAt: new Date(Date.now() - 60_000).toISOString() };
  await evalIn(panel.session, `chrome.storage.session.set({pendingReplyRequest:${JSON.stringify(stale)}})`);
  await call("Page.reload", { ignoreCache: true }, panel.session);
  await until(() => evalIn(panel.session, "document.readyState === 'complete' && document.querySelector('#dashboard') && !document.querySelector('#dashboard').classList.contains('hidden')"));
  await until(() => evalIn(panel.session, "chrome.storage.session.get('pendingReplyRequest').then(x=>!x.pendingReplyRequest)"));
  assert.equal(await evalIn(panel.session, "document.querySelector('#result').classList.contains('hidden')"), true);
  assert.equal(await evalIn(panel.session, "chrome.storage.local.get('localUsageEvents').then(x=>(x.localUsageEvents||[]).filter(e=>e.action==='generated').length)"), 0);
  const icon = await evalIn(panel.session, "fetch(chrome.runtime.getURL('icons/icon-16.png')).then(r=>({ok:r.ok,type:r.headers.get('content-type')}))");
  assert.equal(icon.ok, true);
  if (process.env.RC_EXTENSION_SCREENSHOT) {
    await evalIn(panel.session, "document.scrollingElement.scrollTop=0");
    const screenshot = await call("Page.captureScreenshot", { format: "png" }, panel.session);
    writeFileSync(process.env.RC_EXTENSION_SCREENSHOT, Buffer.from(screenshot.result.data, "base64"));
  }
  if (process.env.RC_EXTENSION_MANAGER_SCREENSHOT) {
    const manager = await attach("chrome://extensions/");
    await wait(600);
    const screenshot = await call("Page.captureScreenshot", { format: "png" }, manager.session);
    writeFileSync(process.env.RC_EXTENSION_MANAGER_SCREENSHOT, Buffer.from(screenshot.result.data, "base64"));
  }
  const overlayFixture = await attach(`chrome-extension://${id}/privacy.html`);
  await call("Target.activateTarget", { targetId: overlayFixture.targetId });
  await evalIn(overlayFixture.session, `import(chrome.runtime.getURL('content/inline-assistant.js')).then(()=>{window.fixtureActions=[];window.fixtureOverlay=ZaneReplyCopilotContent.inlineAssistant.mount(document.body,(action,data)=>fixtureActions.push({action,data}),{preferences:{autoGenerateOnReply:false}});fixtureOverlay.showAccount('guest',null,false);return true})`);
  assert.equal(await evalIn(overlayFixture.session, "fixtureOverlay.host.shadowRoot.querySelector('.top strong').textContent"), "x-Reply-Helper");
  assert.equal(await evalIn(overlayFixture.session, "fixtureOverlay.host.shadowRoot.querySelector('.panel').getAttribute('aria-label')"), "x-Reply-Helper 回复助手");
  assert.equal(await evalIn(overlayFixture.session, "fixtureOverlay.host.shadowRoot.querySelector('[data-action=register]').classList.contains('hidden')"), false);
  const before = await evalIn(overlayFixture.session, "(()=>{const r=fixtureOverlay.host.getBoundingClientRect();return {x:r.x,y:r.y}})()");
  const point = await evalIn(overlayFixture.session, "(()=>{const r=fixtureOverlay.host.shadowRoot.querySelector('#auto-generate-toggle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, overlayFixture.session);
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, overlayFixture.session);
  await until(() => evalIn(overlayFixture.session, "fixtureActions.some(item=>item.action==='toggle_auto_generate' && item.data.enabled===true)"));
  const after = await evalIn(overlayFixture.session, "(()=>{const r=fixtureOverlay.host.getBoundingClientRect();return {x:r.x,y:r.y}})()");
  assert.deepEqual(after,before);
  const fresh = { ...stale, requestId: crypto.randomUUID(), sourceText: "Freshly selected post", createdAt: new Date().toISOString() };
  await evalIn(panel.session, `chrome.storage.session.set({pendingReplyRequest:${JSON.stringify(fresh)}})`);
  await until(() => evalIn(panel.session, "document.querySelector('#dashboard').classList.contains('hidden') && !document.querySelector('#back-dashboard').classList.contains('hidden')"));
  await until(() => evalIn(panel.session, "document.querySelector('#status').classList.contains('error')"));
  await click(panel.session, "#back-dashboard");
  assert.equal(await evalIn(panel.session, "document.querySelector('#dashboard').classList.contains('hidden')"), false);
  await call("Page.reload", { ignoreCache: true }, panel.session);
  await until(() => evalIn(panel.session, "document.readyState === 'complete' && !document.querySelector('#dashboard').classList.contains('hidden')"));
  assert.equal(await evalIn(panel.session, "chrome.storage.local.get('localUsageEvents').then(x=>(x.localUsageEvents||[]).filter(e=>e.action==='generated').length)"), 0);
  console.log(JSON.stringify({ ok: true, realChrome: true, extensionInstalled: true, toolbarAction, toolbarActionError, dashboard: true, autoSwitchClicked: true, persistedAfterReload: true, optionsSync: true, overlaySwitchFixtureClicked: true, overlayDidNotDrag: true, staleRequestIgnored: true, freshRequestEnteredWorkMode: true, reopenReturnsDashboard: true, generatedEvents: 0, iconLoaded: true }));
} finally {
  for (const task of pending.values()) clearTimeout(task.timer);
  chrome?.kill("SIGTERM");
  await wait(400);
  rmSync(profile, { recursive: true, force: true });
}
