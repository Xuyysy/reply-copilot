import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";import {createRequire} from "node:module";import {withMomentumBrowser} from "./helpers/momentum-browser.js";
const {buildSync}=createRequire(new URL("../api/package.json",import.meta.url))("esbuild");
const bundle=buildSync({stdin:{contents:"import {mountHistory} from './follow-manager/v2/history-ui.js';import {openRepository} from './follow-manager/v2/store.js';import {FIXTURE_OWNER} from './follow-manager/v2/fixture.js';window.R={openRepository,FIXTURE_OWNER};mountHistory().then(()=>window.momentumReady=true);",resolveDir:process.cwd()},bundle:true,format:"iife",write:false}).outputFiles[0].text;
const html=readFileSync(new URL("../follow-manager/v2/history.html",import.meta.url),"utf8").replace('<script type="module" src="history-page.js"></script>',"<script>"+bundle.replace(/<\/script/gi,"<\\/script")+"</script>");
test("history workbench actual Chromium: empty state, retained snapshots, arbitrary comparison, filter, reload and isolation",{timeout:60000},async()=>{
 await withMomentumBrowser(html,async({evaluate,call})=>{
  const wait=async expr=>{for(let i=0;i<200;i++){if(await evaluate(expr))return;await new Promise(r=>setTimeout(r,25));}throw Error("history state timeout: "+expr);};
  assert.match(await evaluate("document.getElementById('history-status').textContent"),/当前 0 份/);
  const seeded=await evaluate("(async()=>{const r=await R.openRepository(),o=R.FIXTURE_OWNER,save=async(f,g)=>{let j=await r.start(o,'fixture',f.length);for(const [kind,ids] of [['followers',f],['following',g]]){j=await r.append(o,j.jobId,j.lease,kind,{cursor:null,nextCursor:null,terminal:true,expected:ids.length,users:ids.map(n=>({userId:String(n),handle:'demo_'+n,verificationType:'blue'}))});}await r.finalize(o,j.jobId,j.lease);};await save([2,3],[2,4]);await save([2,5],[2,5]);await save([5,6],[5,6]);const m=await r.listSnapshots(o);let rejected=false;try{await r.readHistoryPair('222',m[0].snapshotId,m[2].snapshotId)}catch(e){rejected=e.message==='invalid_pair'}const bridge=await r.readFollowSnapshot(o);r.close();return {count:m.length,rejected,bridge};})()");
  assert.equal(seeded.count,3);assert.equal(seeded.rejected,true);assert.equal(seeded.bridge.completeness,"unknown");
  await evaluate("document.getElementById('refresh').click()");await wait("document.getElementById('history-status').textContent==='比较完成'");
  assert.equal(await evaluate("document.querySelectorAll('#trend tr').length"),3);
  await evaluate("document.getElementById('older').selectedIndex=2;document.getElementById('older').dispatchEvent(new Event('change'));document.getElementById('compare').click()");await wait("document.getElementById('history-status').textContent==='比较完成'");
  await evaluate("document.querySelector('[data-kind=newFollowers]').click()");assert.equal(await evaluate("document.querySelectorAll('#change-rows tr').length"),2);
  await evaluate("document.getElementById('change-query').value='demo_6';document.getElementById('change-query').dispatchEvent(new Event('input'))");assert.equal(await evaluate("document.querySelectorAll('#change-rows tr').length"),1);assert.match(await evaluate("document.getElementById('change-rows').textContent"),/@demo_6/);
  assert.equal(await evaluate("document.getElementById('csv').disabled"),false);
  await call("Page.reload");await wait("Boolean(window.momentumReady)&&document.getElementById('history-status').textContent==='比较完成'");assert.equal(await evaluate("document.querySelectorAll('#trend tr').length"),3);
 });
});
