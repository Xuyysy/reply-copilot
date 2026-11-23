import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {classifyRelationships} from "../follow-manager/archive.js";

const read = name => readFileSync(new URL("../" + name,import.meta.url),"utf8");
function scannerHelpers() {
  const context = vm.createContext({});
  vm.runInContext(read("content/follow-dom-helpers.js"),context,{timeout:1000});
  return context.ReplyCopilotFollowDom;
}
function link(href) {return {getAttribute:()=>href};}
function cell({links=["/alice"],visible=true,name=true} = {}) {
  return {
    querySelector(selector) {
      if (name && selector.includes("User-Name")) return {querySelectorAll:()=>links.map(link)};
      return null;
    },
    querySelectorAll(){return links.map(link);},
    getBoundingClientRect(){return visible?{height:35,bottom:120,top:85}:{height:35,bottom:-40,top:-80};}
  };
}
function doc(items,active="/owner") {
  const column={querySelectorAll:selector=>selector.includes("UserCell")?items:[]};
  return {defaultView:{innerHeight:800},querySelector(selector){
    if (selector.includes("AppTabBar_Profile_Link")) return link(active);
    if (selector.includes("primaryColumn")) return column;
    return null;
  }};
}

test("DOM-only scanner accepts only own X following/follower routes",()=>{
  const api=scannerHelpers();
  assert.deepEqual(JSON.parse(JSON.stringify(api.route("/Owner/following"))),{owner:"owner",kind:"following"});
  assert.deepEqual(JSON.parse(JSON.stringify(api.route("/owner/followers/"))),{owner:"owner",kind:"followers"});
  for (const path of ["/home","/owner/status/123","/owner/verified_followers","/owner/following/x","/settings/following"])
    assert.equal(api.route(path),null,path);
  assert.equal(api.loggedInHandle(doc([],"/ActualOwner")),"actualowner");
});

test("DOM scanner collects only visible profile handles inside primary X user cards",()=>{
  const api=scannerHelpers();
  const page=doc([cell({links:["/Alice"]}),cell({links:["/bob","/i/user/123"]}),
    cell({links:["/offscreen"],visible:false}),cell({links:["/home"]}),
    cell({links:["/alice"]})]);
  const found=new Set();
  assert.equal(api.collect(page,found),2);
  assert.deepEqual([...found],["alice","bob"]);
  assert.equal(api.parseCell(cell({links:["/i/user/123"]})),null);
  assert.equal(api.parseCell(cell({links:["/Alice/status/123"]})),null);
});

test("DOM web scan uses handles, not precision-losing numeric snowflakes",()=>{
  const api=scannerHelpers();
  const out=api.compare(["Alice","carol","dave"],["alice","bob"]);
  assert.deepEqual(Array.from(out.mutual),["alice"]);
  assert.deepEqual(Array.from(out.notFollowingBack),["bob"]);
  assert.deepEqual(Array.from(out.iHaveNotFollowedBack),["carol","dave"]);
  const classified=classifyRelationships(["alice","carol","dave"],["alice","bob"]);
  assert.deepEqual(classified,{mutual:["alice"],notFollowingBack:["bob"],iHaveNotFollowedBack:["carol","dave"]});
});

test("DOM web scanning is explicitly read-only, bounded and independent of AI or payments",()=>{
  const scan=read("content/follow-web-scanner.js");
  const logic=read("content/follow-dom-helpers.js");
  const ui=read("follow-manager/web-scan-ui.js");
  const manifest=JSON.parse(read("manifest.json"));
  assert.deepEqual(manifest.content_scripts[0].js.slice(-4),[
    "content/follow-dom-helpers.js","content/follow-web-scanner.js",
    "content/follow-internal-helpers.js","content/follow-internal-scanner.js"
  ]);
  assert.equal(manifest.permissions.includes("cookies"),false);
  assert.equal(manifest.permissions.includes("scripting"),false);
  assert.equal(manifest.permissions.includes("tabs"),false);
  assert.ok(manifest.host_permissions.every(x=>!/(?:x\.com|twitter\.com)/.test(x)));
  for(const code of [scan,logic,ui]) {
    assert.doesNotMatch(code,/chrome\.cookies|document\.cookie|auth_token|x-csrf-token|GraphQL|graphql|XMLHttpRequest|fetch\s*\(|sendBeacon|eval\s*\(|new Function|friends\/list|friendships\/destroy|chrome\.scripting/);
  }
  assert.doesNotMatch(scan, /\.click\s*\(|requestSubmit\s*\(|dispatchEvent\s*\(|\.innerHTML\s*=/);
  assert.match(scan,/MAX_DURATION_MS = 4 \* 60 \* 1000/);
  assert.match(scan,/MAX_USERS = 3000/);
  assert.match(scan,/XRH_FOLLOW_WEB_CANCEL/);
  assert.match(scan,/currentAccount && currentAccount !== owner/);
  assert.ok(ui.includes("chrome.tabs.create"));
  assert.ok(ui.includes("chrome.tabs.update"));
  assert.ok(ui.includes("chrome.tabs.remove"));
  assert.match(ui,/active:false/);
  assert.doesNotMatch(ui,/active:true/);
  assert.ok(ui.includes("elapsedLabel(ms)"));
  assert.ok(ui.includes("job.timer = setInterval"));
  assert.match(ui,/if \(observedEnds\) await saveWebSnapshot/);
  assert.match(ui,/结果可能不完整/);
});

test("DOM scanner page is voluntary, conservative and separate from archive import",()=>{
  const manager=read("follow-manager/manager.html");
  const page=read("follow-manager/web-scan.html");
  assert.match(manager,/href="web-scan\.html"/);
  assert.match(manager,/一键查看关注关系/);
  assert.doesNotMatch(manager,/体验网页扫描|Staging 实验版/);
  assert.match(manager,/id="archive-dropzone"/);
  assert.doesNotMatch(page,/id="web-consent"/);
  assert.match(page,/<h1>互关助手<\/h1>/);
  assert.match(page,/id="web-elapsed"/);
  assert.match(page,/id="web-loading"/);
  assert.doesNotMatch(page,/网页扫描|实验版|Staging|风险|收费 X API/);
  assert.match(page,/id="web-cancel"/);
  assert.match(page,/id="web-following-count"/);
  assert.match(page,/id="web-followers-count"/);
  assert.match(page,/可能没回关我/);
  assert.match(page,/结果来自 X 实际加载的账号，可能有遗漏/);
  assert.match(page,/web-scan-ui\.js/);
  assert.match(page,/href="manager\.html"/);
  assert.doesNotMatch(page,/<script[^>]+src="https?:\/\//);
});

test("DOM scanner safe per-handle links and no server upload paths",()=>{
  const ui=read("follow-manager/web-scan-ui.js");
  assert.match(ui,/link\.href = "https:\/\/x\.com\/" \+ handle/);
  assert.match(ui,/link\.rel = "noopener noreferrer"/);
  assert.doesNotMatch(ui,/chrome\.runtime\.sendMessage\(\{type:"REPLY_COPILOT_GENERATE"|AccountClient|QuotaService|HostedAIClient|D1|api-staging/);
  const store=read("follow-manager/web-scan-store.js");
  assert.match(store,/createFollowStore/);
  assert.match(read("follow-manager/follow-snapshot-store.js"),/indexedDB\.open/);
  assert.doesNotMatch(store,/fetch\(|chrome\.storage|XMLHttpRequest/);
});

test("background scan keeps the user on the assistant, tracks elapsed time, and cleans its own tab", () => {
  const ui = read("follow-manager/web-scan-ui.js");
  const page = read("follow-manager/web-scan.html");
  assert.match(ui, /chrome\.tabs\.create\(\{url:[^}]+active:false\}\)/);
  assert.match(ui, /chrome\.tabs\.update\(job\.tabId,\{[\s\S]*?url:/);
  assert.doesNotMatch(ui, /active:true/);
  assert.match(ui, /await closeTemporaryTab\(job\)/);
  assert.match(ui, /clearInterval\(job\.timer\)/);
  assert.match(ui, /job\.timer = setInterval/);
  assert.match(page, /id="web-following-count"/);
  assert.match(page, /id="web-followers-count"/);
  assert.match(page, /id="web-elapsed"/);
  assert.match(page, /结果.*可能有遗漏/);
  assert.doesNotMatch(page, /web-consent|Staging 实验版|网页扫描|风险限制/);
});
