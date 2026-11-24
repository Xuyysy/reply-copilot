import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {collectDiagnostics,diagnosticRows,sanitizeProbe} from "../sidepanel/diagnostics.js";
function fixture({tab={id:7,url:"https://x.com/private/status/123"},response,permission=true,fail=false}={}){
  const calls=[];
  return {calls,api:{runtime:{getManifest:()=>({version:"0.3.9"})},permissions:{contains:async()=>permission},
    tabs:{query:async options=>{calls.push(options);return tab?[tab]:[];},
      sendMessage:async(...args)=>{calls.push(args);if(fail)throw new Error("private error");return response;}}}};
}
const probe={ok:true,schema:1,replyControlPresent:true,visibleEditors:1,replyDialogs:1,windowState:"absent",
  events:[{stage:"rejected",reason:"reply_context_unconfirmed"}]};
test("local diagnosis distinguishes successful script response from missing overlay",async()=>{
  const {api,calls}=fixture({response:probe});
  const r=await collectDiagnostics({chromeApi:api,userAgent:"Chrome/144.0.0.0",preferences:{showFloatingWindow:true,autoGenerateOnReply:true},accountStatus:"credits_available"});
  assert.equal(r.page,"x");assert.equal(r.contentScript,"running");assert.equal(r.siteAccess,"reachable");
  assert.equal(r.probe.windowState,"absent");assert.equal(r.probe.events[0].reason,"reply_context_unconfirmed");
  assert.equal(r.browserVersion,"144.0.0.0");assert.equal(r.floatingEnabled,true);
  assert.deepEqual(calls[1],[7,{type:"REPLY_COPILOT_LOCAL_DIAGNOSTICS"},{frameId:0}]);
  assert.ok(diagnosticRows(r).some(([label,value])=>label==="账户连接"&&value==="已连接"));
  assert.doesNotMatch(JSON.stringify(r),/private|123/);
});
test("withheld URL and no listener stay unknown instead of claiming permission denial",async()=>{
  const {api}=fixture({tab:{id:7},permission:false,fail:true});
  const r=await collectDiagnostics({chromeApi:api});
  assert.equal(r.page,"unknown");assert.equal(r.siteAccess,"unknown");assert.equal(r.contentScript,"no_response");
  assert.equal(r.probe,null);
});
test("known unrelated tab is not probed",async()=>{
  const {api,calls}=fixture({tab:{id:7,url:"https://example.org"}});
  const r=await collectDiagnostics({chromeApi:api});
  assert.equal(r.page,"other");assert.equal(calls.length,1);
});
test("missing tab and invalid response have honest outcomes",async()=>{
  const empty=fixture({tab:null});
  assert.equal((await collectDiagnostics({chromeApi:empty.api})).page,"no_tab");
  const f=fixture({response:{ok:false,schema:1}});
  assert.equal((await collectDiagnostics({chromeApi:f.api})).contentScript,"probe_failed");
});
test("report is an allowlist of bounded values, not a dump of account or page information",async()=>{
  const secret="private_token@example.test";
  const unsafe={...probe,sourceText:secret,url:secret,events:Array.from({length:30},()=>({stage:secret,reason:secret,at:123})),visibleEditors:9999,windowState:secret};
  const clean=sanitizeProbe(unsafe);
  assert.equal(clean.events.length,12);assert.equal(clean.events[0].reason,"unknown");assert.equal(clean.visibleEditors,null);
  assert.equal(clean.windowState,"unknown");assert.doesNotMatch(JSON.stringify(clean),/private_token/);
  const {api}=fixture({response:unsafe});
  const r=await collectDiagnostics({chromeApi:api,accountStatus:secret,userAgent:secret,preferences:{showFloatingWindow:secret}});
  assert.equal(r.accountStatus,"unknown");assert.equal(r.floatingEnabled,null);assert.doesNotMatch(JSON.stringify(r),/private_token/);
});
test("diagnostics are opt-in and restricted to the existing side panel",async()=>{
  const content=await readFile(new URL("../content/content-script.js",import.meta.url),"utf8");
  const panel=await readFile(new URL("../sidepanel/sidepanel.js",import.meta.url),"utf8");
  const page=await readFile(new URL("../sidepanel/sidepanel.html",import.meta.url),"utf8");
  assert.ok(content.includes("sender?.url!==chrome.runtime.getURL('sidepanel/sidepanel.html')"));
  assert.match(content,/events:associationEvents\.slice\(-12\)\.map\(\(\{stage,reason\}\)=>\(\{stage,reason\}\)\)/);
  assert.match(panel,/\$\('diagnostic-run'\)\.addEventListener\('click'/);
  assert.match(panel,/navigator\.clipboard\.writeText\(JSON\.stringify\(diagnosticReport/);
  assert.match(page,/id="diagnostic-panel"/);
});


test("diagnostic advice is specific and does not confuse missing access with denial",async()=>{
 const {diagnosticAdvice}=await import("../sidepanel/diagnostics.js");
 const r=await collectDiagnostics({chromeApi:fixture({response:probe}).api,preferences:{showFloatingWindow:true}});
 assert.match(diagnosticAdvice(r),/布局未适配/);
 assert.match(diagnosticAdvice({...r,floatingEnabled:false}),/显示回复悬浮框/);
 assert.match(diagnosticAdvice({...r,probe:{...r.probe,windowState:"not_visible"}}),/重置悬浮框位置/);
});
test("remote diagnostic grant requires exact true and unexpired time",async()=>{
 const {validGrant,fetchDiagnosticGrant}=await import("../sidepanel/diagnostic-access.js");
 const data={schema:1,features:{localDiagnostics:{enabled:true,expiresAt:Date.now()+60000}}};
 assert.ok(validGrant(data));assert.equal(validGrant(data,data.features.localDiagnostics.expiresAt),null);
 assert.equal(validGrant({schema:1,features:{localDiagnostics:{enabled:"true",expiresAt:Date.now()+60000}}}),null);
 const paths=[];
 const client={token:async()=>"local-token",request:async(path,options)=>{paths.push([path,options]);return data}};
 assert.ok(await fetchDiagnosticGrant(client));
 assert.deepEqual(paths,[["/v1/extension/support-features",{expectedToken:"local-token"}]]);
 assert.equal(await fetchDiagnosticGrant({...client,request:async()=>{throw Error("unavailable")}}),null);
 let reads=0;
 assert.equal(await fetchDiagnosticGrant({...client,token:async()=>++reads===1?"old":"new"}),null);
 assert.equal(await fetchDiagnosticGrant({...client,token:async()=>""}),null);
});
test("targeted support uses dedicated authenticated routes and auditable admin writes",async()=>{
 const server=await readFile(new URL("../api/src/support-features.ts",import.meta.url),"utf8");
 const page=await readFile(new URL("../sidepanel/sidepanel.html",import.meta.url),"utf8");
 const panel=await readFile(new URL("../sidepanel/sidepanel.js",import.meta.url),"utf8");
 const route=await readFile(new URL("../api/src/index.ts",import.meta.url),"utf8");
 assert.match(server,/session\.kind!=="extension"/);
 assert.match(server,/readGrant\(env,session\.user_id\)/);
 assert.match(server,/requireAdminSession\(request,env,write\)/);
 assert.match(server,/commitOperation\(env,op,statements/);
 assert.match(route,/\/v1\/extension\/support-features/);
 assert.match(page,/id="diagnostic-panel" hidden/);
 assert.match(panel,/if\(diagnosticBusy\|\|!hasDiagnosticAccess\(\)\)return/);
 assert.match(panel,/if\(revision!==diagnosticRevision\|\|!hasDiagnosticAccess\(\)\)return/);
});
