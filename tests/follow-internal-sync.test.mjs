import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read = p => readFileSync(new URL("../"+p,import.meta.url),"utf8");
function helpers() {
  const context=vm.createContext({});
  vm.runInContext(read("content/follow-internal-helpers.js"),context,{timeout:1000});
  return context.ReplyCopilotInternalFollowParser;
}
function user(handle,id) {
  return {__typename:"User",rest_id:id,legacy:{screen_name:handle}};
}
function data(entries) {
  return {data:{user:{result:{timeline:{timeline:{instructions:[
    {type:"TimelineAddEntries",entries}
  ]}}}}}};
}
function entry(handle,id) {
  return {entryId:"user-"+id,content:{itemContent:{
    itemType:"TimelineUser",user_results:{result:user(handle,id)}
  }}};
}
function cursor(value) {
  return {entryId:"cursor-bottom",content:{
    entryType:"TimelineTimelineCursor",cursorType:"Bottom",value
  }};
}

test("internal GraphQL parser handles valid user profiles and rejects malformed identities",()=>{
  const p=helpers();
  assert.deepEqual(JSON.parse(JSON.stringify(p.parseProfile({data:{user:{result:user("Jane_1","1928374655647382910")}}}))),
    {handle:"jane_1",id:"1928374655647382910"});
  assert.throws(()=>p.parseProfile({data:{user:{result:{}}}}),/账号信息/);
  assert.throws(()=>p.parseProfile({data:{user:{result:user("not-a-handle","42")}}}),/账号信息/);
  assert.throws(()=>p.parseProfile({data:{user:{result:user("jane", 1928374655647382910)}}}),/账号信息/);
});

test("internal timeline page parses user entries, dedupes IDs and retains bottom cursor",()=>{
  const p=helpers();
  const result=p.parsePage(data([entry("ALICE","100"),entry("bob","200"),entry("alice","100"),cursor("next:1")]));
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{
    users:[{handle:"alice",id:"100"},{handle:"bob",id:"200"}],nextCursor:"next:1"
  });
  const end=p.parsePage(data([entry("carol","300")]));
  assert.equal(end.nextCursor,null);
  assert.deepEqual(Array.from(end.users.map(x=>x.handle)),["carol"]);
  assert.throws(()=>p.parsePage({data:{user:{}}}),/格式/);
  assert.equal(p.parsePage(data([])).users.length,0);
});

test("internal mode declares no new sensitive Chrome permissions and remains separate",()=>{
  const manifest=JSON.parse(read("manifest.json"));
  const scripts=manifest.content_scripts[0].js;
  assert.deepEqual(scripts.slice(-2),[
    "content/follow-internal-helpers.js","content/follow-internal-scanner.js"
  ]);
  assert.equal(manifest.permissions.includes("cookies"),false);
  assert.equal(manifest.permissions.includes("tabs"),false);
  assert.equal(manifest.permissions.includes("scripting"),false);
  assert.equal(manifest.host_permissions.some(x=>x.includes("x.com")||x.includes("twitter.com")),false);
  const manager=read("follow-manager/manager.html");
  const page=read("follow-manager/internal-sync.html");
  assert.match(manager,/href="internal-sync.html"/);
  assert.match(manager,/href="web-scan.html"/);
  assert.match(manager,/id="archive-dropzone"/);
  assert.match(page,/id="internal-consent"/);
  assert.match(page,/id="internal-loading"/);
  assert.match(page,/id="internal-following-count"/);
  assert.match(page,/id="internal-followers-count"/);
  assert.match(page,/id="internal-export"/);
  assert.match(page,/通过 X 网页内部接口/);
  assert.doesNotMatch(page,/<script[^>]+src="https?:\/\//);
  const ui=read("follow-manager/internal-sync-ui.js");
  assert.match(ui,/chrome\.tabs\.create/);
  assert.match(ui,/active:false/);
  assert.match(ui,/chrome\.tabs\.remove/);
  assert.match(ui,/XRH_INTERNAL_START/);
  assert.match(ui,/XRH_INTERNAL_CANCEL/);
  assert.ok(ui.includes("const completeRecord=observedEnds ? await saveInternalSnapshot(data) : null;"));
  assert.match(ui,/source:"internal_sync"/);
  assert.doesNotMatch(ui,/chrome\.cookies|auth_token|fetch\s*\(|https:\/\/api-staging|D1|AccountClient/);
  assert.match(read("follow-manager/internal-sync-store.js"),/xrh-follow-internal-v1/);
  assert.match(read("follow-manager/web-scan-store.js"),/xrh-follow-web-v1/);
  const scanner=read("content/follow-internal-scanner.js");
  assert.doesNotMatch(scanner,/chrome\.cookies|chrome\.storage|document\.cookie\s*=|friendships\/destroy/);
  assert.match(scanner,/credentials:"include"/);
  assert.match(scanner,/const raw = \/\(\?:\^\|;\)/);
});

function webClientHarness({signedIn="owner",status=200,observedQueries=[]}={}) {
  const messages=[];
  const requests=[];
  let listener;
  const location={protocol:"https:",hostname:"x.com",origin:"https://x.com",pathname:"/owner/following"};
  const chrome={runtime:{
    id:"test-extension",
    onMessage:{addListener(fn){listener=fn}},
    sendMessage(message){messages.push(message);return Promise.resolve();}
  }};
  const document={cookie:"ct0=csrf-test-value; auth_token=private-secret",
    querySelector(selector) {
      if(selector==='a[data-testid="AppTabBar_Profile_Link"]')return {
        getAttribute(){return "/"+signedIn; }
      };
      return null;
    }};
  let fetchCount=0;
  async function fetchMock(url,options) {
    requests.push({url,options});
    fetchCount++;
    if (status !== 200) return {status,ok:false};
    if(url.includes("/UserByScreenName?")) return {
      status:200,ok:true,async json(){return {data:{user:{result:user("owner","1000")}}};}
    };
    return {status:200,ok:true,async json(){return data([entry("alice","2000"),entry("bob","3000")]);}};
  }
  const context=vm.createContext({
    location,document,chrome,URLSearchParams,AbortController,
    setTimeout,clearTimeout,fetch:fetchMock,console,URL,
    performance:{getEntriesByType(kind) {
      return kind === "resource" ? observedQueries.map(name=>({name})) : [];
    }},
  });
  vm.runInContext(read("content/follow-dom-helpers.js"),context,{timeout:1000});
  vm.runInContext(read("content/follow-internal-helpers.js"),context,{timeout:1000});
  vm.runInContext(read("content/follow-internal-scanner.js"),context,{timeout:1000});
  function send(message) {
    let reply;
    listener(message,{id:"test-extension"},value=>{reply=value;});
    return reply;
  }
  return {send,location,messages,requests,fetchCount:()=>fetchCount};
}
async function completed(harness) {
  for(let tries=0;tries<100;tries++){
    const done=harness.messages.find(x=>x.type==="XRH_INTERNAL_DONE");
    if(done)return done;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw new Error("scanner failed to report terminal state");
}
const UUID="12345678-1234-4234-a234-123456789abc";

test("same-origin read-only internal sync returns usernames without forwarding private credentials",async()=>{
  const h=webClientHarness();
  assert.equal(h.send({type:"XRH_INTERNAL_PING"}).loggedIn,"owner");
  assert.equal(h.send({type:"XRH_INTERNAL_START",scanId:UUID,kind:"following",owner:"owner"}).ok,true);
  const done=await completed(h);
  assert.equal(done.reason,"complete");
  assert.deepEqual(Array.from(done.handles),["alice","bob"]);
  assert.equal(h.requests.length,2);
  for(const {url,options} of h.requests){
    assert.equal(new URL(url).origin,"https://x.com");
    assert.equal(options.method,"GET");
    assert.equal(options.credentials,"include");
    assert.equal(options.headers["x-csrf-token"],"csrf-test-value");
  }
  assert.equal(JSON.stringify(h.messages).includes("csrf-test-value"),false);
  assert.equal(JSON.stringify(h.messages).includes("private-secret"),false);
  assert.equal(h.requests.some(x=>x.url.includes("/friendships/destroy")),false);
});

test("internal sync rejects scanning other accounts and fails closed without ownership proof",async()=>{
  const h=webClientHarness({signedIn:"someone_else"});
  assert.equal(h.send({type:"XRH_INTERNAL_START",scanId:UUID,kind:"following",owner:"owner"}).ok,false);
  assert.equal(h.requests.length,0);
  const g=webClientHarness();
  assert.equal(g.send({type:"XRH_INTERNAL_START",scanId:UUID,kind:"followers",owner:"owner"}).ok,false);
  assert.equal(g.requests.length,0);
});

test("429 rate limit stops immediately, reports partial state and does not auto-retry",async()=>{
  const h=webClientHarness({status:429});
  assert.equal(h.send({type:"XRH_INTERNAL_START",scanId:UUID,kind:"following",owner:"owner"}).ok,true);
  const done=await completed(h);
  assert.equal(done.reason,"rate_limited");
  assert.equal(h.requests.length,1);
  assert.equal(done.handles.length,0);
});

test("uses query IDs already observed on the active X page when available",async()=>{
  const h=webClientHarness({observedQueries:[
    "https://x.com/i/api/graphql/ObservedUserQueryId123/UserByScreenName?abc=1",
    "https://x.com/i/api/graphql/ObservedFollowQuery123/Following?abc=2",
    "https://example.com/i/api/graphql/BadThirdPartyQuery/Following"
  ]});
  assert.equal(h.send({type:"XRH_INTERNAL_START",scanId:UUID,kind:"following",owner:"owner"}).ok,true);
  const done=await completed(h);
  assert.equal(done.reason,"complete");
  assert.ok(h.requests[0].url.includes("/ObservedUserQueryId123/UserByScreenName?"));
  assert.ok(h.requests[1].url.includes("/ObservedFollowQuery123/Following?"));
  assert.equal(h.requests.some(x=>x.url.includes("example.com")),false);
});
