import test from "node:test";
import assert from "node:assert/strict";
import {cpSync,mkdtempSync,rmSync,readFileSync,existsSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
const root=fileURLToPath(new URL("../",import.meta.url));
const json=file=>JSON.parse(readFileSync(file,"utf8"));
test("joint account tools appear only in actual staging build, preserving base permissions and production entrypoints",{timeout:60000},()=>{
 const dir=mkdtempSync(path.join(tmpdir(),"xrh-joint-build-"));
 try{
  for(const name of ["background","config","content","domain","icons","onboarding","options","prompts","services","sidepanel","utils","manifest.json","privacy.html","staging","interaction-manager","follow-manager","package.json"])cpSync(path.join(root,name),path.join(dir,name),{recursive:true});
  mkdirSync(path.join(dir,"scripts"));
  for(const name of ["build.js","extension-identity.mjs"])cpSync(path.join(root,"scripts",name),path.join(dir,"scripts",name));
  const base=json(path.join(dir,"manifest.json")),identity=json(path.join(dir,"config","extension-store-identity.json"));
  const sourcePanel=readFileSync(path.join(dir,"sidepanel","sidepanel.html"),"utf8");
  for(const channel of ["staging","production","development"]){
   const env={...process.env};delete env.REPLY_COPILOT_EXTENSION_PUBLIC_KEY_FILE;delete env.REPLY_COPILOT_EXTENSION_ID;
   env.REPLY_COPILOT_WEBSITE_URL=channel==="staging"?"https://staging.x-reply-helper.top":"https://app.x-reply-helper.top";
   env.REPLY_COPILOT_API_URL=channel==="staging"?"https://api-staging.x-reply-helper.top":"https://api.x-reply-helper.top";
   execFileSync(process.execPath,[path.join(dir,"scripts","build.js"),channel],{env,stdio:"pipe"});
   const out=path.join(dir,"dist",channel),m=json(path.join(out,"manifest.json")),panel=readFileSync(path.join(out,"sidepanel","sidepanel.html"),"utf8");
   assert.deepEqual(m.permissions,base.permissions);
   assert.equal(m.version,base.version);
   if(channel==="staging"){
    assert.equal(m.background.service_worker,"staging/service-worker.js");
    assert.deepEqual(m.host_permissions,["https://api-staging.x-reply-helper.top/*"]);
    assert.deepEqual(m.content_scripts[0].js,["staging/momentum-content.js",...base.content_scripts[0].js,"staging/interaction-capture.js"]);
    assert.equal(Object.hasOwn(m,"key"),false);
    for(const target of ["follow-manager/v2/workbench.html","follow-manager/v2/history.html","interaction-manager/ui/index.html","staging/interaction-panel.js"])assert.ok(existsSync(path.join(out,target)),target);
    assert.ok(!existsSync(path.join(out,"follow-manager","manager.html")));
    assert.equal((panel.match(/id="joint-follow-preview"/g)||[]).length,1);
    assert.equal((panel.match(/id="staging-interactions"/g)||[]).length,1);
    assert.match(panel,/互关助手 V2（模拟数据预览）/);
    assert.match(panel,/interaction-manager\/ui\/index\.html/);
    assert.match(panel,/staging\/interaction-panel\.js/);
   }else{
    for(const name of ["follow-manager","interaction-manager","staging"])assert.equal(existsSync(path.join(out,name)),false,name);
    assert.equal(panel,sourcePanel);
    assert.deepEqual(m.content_scripts,base.content_scripts);
    assert.equal(m.background.service_worker,base.background.service_worker);
    if(channel==="production"){assert.equal(m.key,identity.publicKey);assert.deepEqual(m.host_permissions,["https://api.x-reply-helper.top/*"]);}
   }
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
