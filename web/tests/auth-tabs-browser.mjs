import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.RC_WEB_URL || "http://127.0.0.1:4321/login";
const chromePath = process.env.CHROME_BINARY || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(path.join(os.tmpdir(), "reply-copilot-auth-tabs-"));
const port = 43000 + Math.floor(Math.random() * 4000);
const failures = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, socket, nextId = 0;
let pageLoads = 0;
const pending = new Map();

async function until(check, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result; } catch {}
    await wait(100);
  }
  throw new Error(`Timed out waiting for login hydration. Browser failures: ${JSON.stringify(failures)}`);
}
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { if (pending.delete(id)) reject(new Error(`Chrome command timed out: ${method}`)); }, 10_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result.result.value;
}
async function ready() {
  await until(() => evaluate('Boolean(document.querySelector("astro-island[component-url*=AuthPanel]") && !document.querySelector("astro-island[component-url*=AuthPanel]").hasAttribute("ssr"))'));
  assert.equal(await evaluate('document.querySelectorAll("[role=tab]").length'), 3);
}
async function choose(index, expected, fields) {
  const rect = await evaluate(`(()=>{const r=document.querySelectorAll('[role=tab]')[${index}].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await until(() => evaluate(`document.querySelectorAll('[role=tab]')[${index}].dataset.state === 'active'`), 3000);
  const actual = await evaluate("[...document.querySelectorAll('form input')].map(input => input.autocomplete)");
  for (const field of fields) assert.ok(actual.includes(field), `${expected} form is missing ${field}: ${actual.join(", ")}`);
}

try {
  assert.ok(existsSync(chromePath), `Chrome not found: ${chromePath}`);
  const response = await fetch(url);
  assert.equal(response.status, 200, `${url} did not load`);
  chrome = spawn(chromePath, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--window-size=1440,1000", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, url], { stdio: "ignore" });
  const target = await until(async () => {
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return tabs.find(tab => tab.type === "page" && tab.url.startsWith(url));
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer);
      message.error ? item.reject(new Error(message.error.message)) : item.resolve(message);
    }
    if (message.method === "Runtime.exceptionThrown") failures.push({ type: "exception", detail: message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text });
    if (message.method === "Network.responseReceived" && message.params.response.status >= 400 && message.params.response.url.includes("/.vite/deps/")) failures.push({ type: "dependency", status: message.params.response.status, url: message.params.response.url });
    if (message.method === "Page.loadEventFired") pageLoads++;
  });
  await Promise.all([cdp("Runtime.enable"), cdp("Network.enable"), cdp("Page.enable")]);
  await ready();
  await choose(1, "register", ["username", "email", "new-password"]);
  await choose(2, "reset", ["email"]);
  await choose(0, "login", ["username", "current-password"]);
  await choose(1, "register", ["username", "email", "new-password"]);
  const beforeReload = pageLoads;
  await cdp("Page.reload", { ignoreCache: true });
  await until(() => pageLoads > beforeReload);
  await ready();
  await choose(1, "register after reload", ["username", "email", "new-password"]);
  await choose(0, "login after reload", ["username", "current-password"]);
  assert.equal(failures.length, 0, JSON.stringify(failures));
  console.log(JSON.stringify({ ok: true, url, hydrated: true, register: true, reset: true, login: true, repeated: true, reload: true, dependencyErrors: 0 }));
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  try { socket?.close(); } catch {}
  chrome?.kill("SIGTERM");
  await wait(400);
  rmSync(profile, { recursive: true, force: true });
}
