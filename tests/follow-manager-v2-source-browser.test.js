import test from "node:test";import assert from "node:assert/strict";
import {createRequire} from "node:module";import {withMomentumBrowser} from "./helpers/momentum-browser.js";
const {buildSync}=createRequire(new URL("../api/package.json",import.meta.url))("esbuild");
const bundle=buildSync({stdin:{contents:"import {openRepository} from './follow-manager/v2/store.js';import {runFixtureSync} from './follow-manager/v2/sync-engine.js';import {createFixtureSource} from './follow-manager/v2/fixture-source.js';import {FIXTURE_OWNER} from './follow-manager/v2/fixture.js';window.R={openRepository,runFixtureSync,createFixtureSource,FIXTURE_OWNER};window.momentumReady=true;",resolveDir:process.cwd()},bundle:true,format:"iife",write:false}).outputFiles[0].text;
test("source pipeline native Chromium: paused checkpoint, resumed parsed pages, stable IDs, unchanged real bridge",{timeout:60000},async()=>{
 await withMomentumBrowser("<script>"+bundle+"</script>",async({evaluate})=>{
  const result=await evaluate("(async()=>{const r=await R.openRepository(),o=R.FIXTURE_OWNER;let j=await r.start(o,'fixture',1000),paused=false;j=await R.runFixtureSync({repo:r,job:j,source:R.createFixtureSource(1000),shouldPause:()=>paused,onProgress:()=>{paused=true}});const first=j.stages.following.count,firstStatus=j.status;const saved=await r.active(o);j=await r.resume(o,saved.jobId,saved.lease);j=await R.runFixtureSync({repo:r,job:j,source:R.createFixtureSource(1000)});const snapshot=await r.readSnapshot(o),bridge=await r.readFollowSnapshot(o);await r.purge(o);r.close();return {first,firstStatus,status:j.status,rows:snapshot.users.length,bridge:bridge.completeness};})()");
  assert.deepEqual(result,{first:200,firstStatus:"paused",status:"completed",rows:2000,bridge:"unknown"});
 });
});
