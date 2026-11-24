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
    users:[{handle:"alice",id:"100"},{handle:"bob",id:"200"}],nextCursor:"next:1",hasEntries:true
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
  assert.doesNotMatch(page,/id="internal-(?:following|followers)-count"/);
  assert.match(page,/id="internal-settings"/);
  assert.match(page,/id="internal-export"/);
  assert.match(page,/通过 X 网页内部接口/);
  assert.doesNotMatch(page,/<script[^>]+src="https?:\/\//);
  const ui=read("follow-manager/internal-sync-ui.js");
  assert.match(ui,/chrome\.tabs\.create/);
  assert.match(ui,/active:false/);
  assert.match(ui,/chrome\.tabs\.remove/);
  assert.match(ui,/XRH_INTERNAL_START/);
  assert.match(ui,/XRH_INTERNAL_CANCEL/);
  assert.ok(ui.includes("const completeRecord=await saveInternalSnapshot(data);"));
  assert.ok(ui.includes("readCheckpoint("));
  assert.ok(ui.includes("queueCheckpoint("));
  assert.ok(ui.includes('job.checkpoint.stages.following'));
  assert.ok(ui.includes('runIncrementalRound({'));
  assert.ok(ui.includes('localStorage.getItem(CONSENT_KEY)'));
  assert.ok(ui.includes('"internal-reset").addEventListener'));
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
    assert.equal(options.method,url.includes("/UserByScreenName?")?"GET":"POST");
    if(options.method==="POST") {
      const body=JSON.parse(options.body);
      assert.equal(body.variables.withGrokTranslatedBio,true);
      assert.equal(body.variables.userId,"1000");
      assert.equal(options.headers["content-type"],"application/json");
    }
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
  assert.ok(h.requests[1].url.includes("/ObservedFollowQuery123/Following"));
  assert.equal(h.requests.some(x=>x.url.includes("example.com")),false);
});

test("internal parser also accepts modern core.screen_name user shape",()=>{
  const p=helpers();
  const modern={data:{user:{result:{
    __typename:"User",rest_id:"1945678999123456789",core:{screen_name:"NEW_HANDLE"}
  }}}};
  assert.equal(p.parseProfile(modern).handle,"new_handle");
  const nested=data([{entryId:"module-item",content:{item:{
    itemContent:{user_results:{result:{__typename:"User",rest_id:"1111",
      core:{screen_name:"nested_user"}}}}
  }}}]);
  assert.deepEqual(Array.from(p.parsePage(nested).users.map(x=>x.handle)),["nested_user"]);
});

test("internal checkpoint lets a new run start from the saved cursor without duplicating users",async()=>{
  const h=webClientHarness();
  const saved={handles:["alice"],ids:{alice:"2000"},verification:{alice:true},
    cursor:"saved-cursor",pages:32,reason:"paused",userId:"1000"};
  assert.equal(h.send({type:"XRH_INTERNAL_START",scanId:UUID,kind:"following",owner:"owner",
    resume:saved}).ok,true);
  const done=await completed(h);
  assert.equal(done.reason,"complete");
  assert.deepEqual(Array.from(done.handles),["alice","bob"]);
  assert.equal(done.pages,33);
  const body=JSON.parse(h.requests[1].options.body);
  assert.equal(body.variables.cursor,"saved-cursor");
});

test("internal missing query and rate-limit errors stop without uncontrolled retries",async()=>{
  for(const [status,reason] of [[404,"query_not_found"],[400,"invalid_request"],[429,"rate_limited"]]){
    const h=webClientHarness({status});
    assert.equal(h.send({type:"XRH_INTERNAL_START",scanId:UUID,kind:"following",owner:"owner"}).ok,true);
    const done=await completed(h);
    assert.equal(done.reason,reason);
    assert.equal(h.requests.length,1);
  }
});

test("staging-only internal page explains bounded batches and reset control",()=>{
  const html=read("follow-manager/internal-sync.html");
  const script=read("content/follow-internal-scanner.js");
  assert.ok(html.includes('id="internal-reset"'));
  assert.ok(!html.includes("每批最多读取约 3,000 人"));
  assert.ok(!html.includes("查看上次结果"));
  assert.ok(!html.includes("scan-progress"));
  assert.ok(script.includes('const MAX_USERS = 30000'));
  assert.ok(script.includes('const MAX_BATCH_ADDED = 3000'));
  assert.ok(script.includes('const CHECKPOINT_EVERY = 2'));
  assert.ok(script.includes('const MAX_PAGES = 6'));
  assert.ok(script.includes('method:isList ? "POST" : "GET"'));
});

test("internal results display only the two one-sided relationship categories",()=>{
  const page=read("follow-manager/internal-sync.html");
  const ui=read("follow-manager/internal-sync-ui.js");
  assert.deepEqual(Array.from(page.matchAll(/data-internal-kind="([^"]+)"/g),m=>m[1]),["notFollowingBack","iHaveNotFollowedBack"]);
  assert.ok(page.includes('data-internal-kind="notFollowingBack" aria-pressed="true">未回关我'));
  assert.ok(page.includes('data-internal-kind="iHaveNotFollowedBack" aria-pressed="false">我未回关'));
  assert.ok(!page.includes('id="internal-mutual"'));
  assert.ok(!ui.includes('$("internal-mutual")'));
  assert.ok(ui.includes('let selectedKind = "notFollowingBack"'));
  assert.ok(ui.includes("未回关关系尚待确认"));
  assert.ok(ui.includes("classifyRelationships(data.followers,data.following)"));
  assert.ok(ui.includes('isComplete(snapshot)?"snapshot":"partial"'));
});
