import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {
  verificationFor,validVerification,validIds,selectAccounts,compareSnapshots,snapshotIsCurrent,
  classifySnapshotRelationships,accountProfileUrl,validDirectional
} from "../follow-manager/results-utils.js";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("confirmed blue V is filterable without conflating missing metadata with non-blue",()=>{
  const data={verification:{alice:true,bob:false}};
  assert.deepEqual(selectAccounts(["alice","bob","carol"],"","blue",data),["alice"]);
  assert.deepEqual(selectAccounts(["alice","bob","carol"],"","not-blue",data),["bob"]);
  assert.deepEqual(selectAccounts(["alice","bob","carol"],"","unknown",data),["carol"]);
  assert.deepEqual(selectAccounts(["alice","bob","carol"],"@BO","all",data),["bob"]);
  assert.equal(verificationFor(data,"carol"),null);
  assert.equal(validVerification(undefined),true);
  assert.equal(validVerification({alice:true,bob:false}),true);
  assert.equal(validVerification({alice:"true"}),false);
  assert.equal(validVerification({bad_name____too_long:true}),false);
  assert.equal(validIds({alice:"1928374655647382910"}),true);
  assert.equal(validIds({alice:1928374655647382910}),false);
});

test("internal verified parsing relies on explicit X blue field and excludes gold/gray",()=>{
  const context=vm.createContext({});
  vm.runInContext(read("content/follow-internal-helpers.js"),context,{timeout:1000});
  const parse=context.ReplyCopilotInternalFollowParser.parseProfile;
  const profile=(h,id,blue,verified_type)=>({
    data:{user:{result:{__typename:"User",rest_id:id,
      legacy:{screen_name:h,verified:true},is_blue_verified:blue,verified_type}}}
  });
  assert.equal(parse(profile("Alice","123",true)).blueVerified,true);
  assert.equal(parse(profile("Bob","124",false)).blueVerified,false);
  assert.equal(parse(profile("Biz","125",true,"Business")).blueVerified,false);
  assert.equal(parse(profile("Gov","126",true,"Government")).blueVerified,false);
  assert.equal(parse(profile("Mystery","127",undefined)).blueVerified,undefined);
});

test("DOM blue badge requires blue color and never infers gold/grey as blue",()=>{
  const context=vm.createContext({});
  vm.runInContext(read("content/follow-dom-helpers.js"),context,{timeout:1000});
  const api=context.ReplyCopilotFollowDom;
  const badge={getAttribute:()=>""};
  const cell={querySelector:()=>badge};
  const doc=color=>({defaultView:{getComputedStyle:()=>({color})}});
  assert.equal(api.blueBadge(cell,doc("rgb(29, 155, 240)")),true);
  assert.equal(api.blueBadge(cell,doc("rgb(255, 212, 0)")),null);
  assert.equal(api.blueBadge(cell,doc("rgb(130, 140, 150)")),null);
  assert.equal(api.blueBadge({querySelector:()=>null},doc("rgb(29, 155, 240)")),null);
});

test("snapshot history comparisons use stable IDs when available",()=>{
  const prior={owner:"myacc",followers:["alice","bob"],following:[],ids:{alice:"111",bob:"222"},importedAt:"2026-11-22T10:00:00Z"};
  const current={owner:"myacc",followers:["alicerename","carol"],following:[],ids:{alicerename:"111",carol:"333"},importedAt:"2026-11-23T10:00:00Z"};
  assert.deepEqual(compareSnapshots(current,prior),{
    newFollowers:1,missingFollowers:1,previousAt:prior.importedAt,byStableId:true
  });
  assert.equal(compareSnapshots(current,{...prior,owner:"not-myacc"}),null);
  assert.equal(compareSnapshots({owner:"myacc",followers:["alice"]},{owner:"myacc",followers:["alice"],importedAt:"x"}).byStableId,false);
  assert.equal(snapshotIsCurrent({importedAt:new Date(Date.now()-10000).toISOString()}),true);
  assert.equal(snapshotIsCurrent({importedAt:"2020-01-01T00:00:00Z"}),false);
});

test("both scan pages have blue V filter, historical change summary, and old-data restoration",()=>{
  for(const mode of ["web","internal"]){
    const page=read("follow-manager/"+(mode==="web"?"web-scan":"internal-sync")+".html");
    const script=read("follow-manager/"+(mode==="web"?"web-scan-ui":"internal-sync-ui")+".js");
    assert.match(page,new RegExp('id="'+mode+'-verified"'));
    assert.match(page,/仅看蓝 V/);
    assert.match(page,new RegExp('id="'+mode+'-changes"'));
    assert.ok(script.includes("verificationFor,validVerification,validIds,selectAccounts,compareSnapshots,snapshotIsCurrent"));
    assert.match(script,/restoreLastResult/);
    assert.match(script,/read(?:Web|Internal)Checkpoint/);
    assert.match(script,/save(?:Web|Internal)Checkpoint/);
    assert.match(script,/history\?\.\[0\]/);
    assert.ok(script.includes('badge.className="blue-v-chip"'));
    assert.ok(script.includes("source:"));
    assert.match(script,/blue_verified/);
    assert.match(script,/snapshot\.owner\s*!==\s*account/);
    assert.equal(script.includes("chrome.cookies") || script.includes("document.cookie"),false);
  }
});

test("v2 shared snapshots keep old v1 records and isolate incomplete checkpoints",()=>{
  const code=read("follow-manager/follow-snapshot-store.js");
  assert.ok(code.includes("indexedDB.open(dbName,2)"));
  assert.ok(code.includes('objectStoreNames.contains("snapshots")'));
  assert.ok(code.includes('objectStoreNames.contains("pending")'));
  assert.ok(code.includes("saveSnapshot(snapshot)"));
  assert.ok(code.includes("slice(0,MAX_HISTORY)"));
  assert.ok(code.includes('tx.objectStore("pending").delete(snapshot.owner)'));
  const dom=read("follow-manager/web-scan-store.js");
  const internal=read("follow-manager/internal-sync-store.js");
  assert.match(dom,/xrh-follow-web-v1/);
  assert.match(internal,/xrh-follow-internal-v1/);
  assert.match(dom,/createFollowStore/);
  assert.match(internal,/createFollowStore/);
});

test("directional identity diff handles renamed users, recycled handles and legacy records",()=>{
  const s={following:["old","reused","legacy"],followers:["new","reused","legacy"],
    directional:{following:{ids:{old:"100",reused:"200"},verification:{reused:true}},
      followers:{ids:{new:"100",reused:"300"},verification:{reused:false}}}};
  assert.equal(validDirectional(s.directional),true);
  assert.deepEqual(classifySnapshotRelationships(s),{mutual:["old","legacy"],
    notFollowingBack:["reused"],iHaveNotFollowedBack:["reused"]});
  assert.equal(accountProfileUrl(s,"reused","following"),"https://x.com/i/user/200");
  assert.equal(accountProfileUrl(s,"reused","followers"),"https://x.com/i/user/300");
  assert.equal(verificationFor(s,"reused","following"),true);
  assert.equal(verificationFor(s,"reused","followers"),false);
  assert.deepEqual(selectAccounts(["reused"],"","blue",s,"followers"),[]);
  assert.deepEqual(classifySnapshotRelationships({following:["a","b"],followers:["b","c"]}),
    {mutual:["b"],notFollowingBack:["a"],iHaveNotFollowedBack:["c"]});
});
test("history does not invent churn when old handles lack IDs or either snapshot is partial",()=>{
  const a={owner:"owner",followers:["alice"],following:[],importedAt:"2026-11-22"};
  const b={...a,ids:{alice:"123"},importedAt:"2026-11-23"};
  assert.deepEqual(compareSnapshots(b,a),{newFollowers:0,missingFollowers:0,previousAt:a.importedAt,byStableId:false});
  assert.equal(compareSnapshots({...b,reasons:{following:"complete",followers:"paused"}},a),null);
});
