import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withMomentumBrowser} from './helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../api/package.json',import.meta.url))('esbuild');
const js=buildSync({stdin:{contents:"import * as R from './interaction-manager/storage/repository.js';window.R=R;window.momentumReady=true;",resolveDir:process.cwd()},bundle:true,format:'iife',write:false}).outputFiles[0].text;
test('native live dataset reads a consistent owner snapshot without exposing cursors',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
 const r=await evaluate("(async()=>{const db=await R.openInteractionDB(indexedDB,'live-dataset-test');const a=await R.beginSession(db,'111');const j=await R.openSyncJob(db,a,{providerId:'web-graphql',source:'notification'});await R.commitBatch(db,a,[{ownerUserId:'111',actorUserId:'222',targetUserId:'111',type:'like',targetPostId:'555',source:'notification',evidenceQuality:'confirmed',observedAt:Date.now()}],{source:'notification',cursor:'private-cursor',checkpoint:{providerId:'web-graphql',revision:j.revision,nextCursor:'private-cursor',done:false,quality:{unsupported:2,unresolvedActors:1,foreignTargets:0,ignored:3}}});const first=await R.readOwnerDataset(db,a);const b=await R.beginSession(db,'333');const other=await R.readOwnerDataset(db,b);let stale=false;try{await R.readOwnerDataset(db,a)}catch(e){stale=e.message==='stale_session'}return {first,other,stale}})()");
 assert.equal(r.first.rows.length,1);assert.equal(r.first.jobs[0].pages,1);assert.equal(r.first.jobs[0].done,false);assert.deepEqual(r.first.jobs[0].quality,{unsupported:2,unresolvedActors:1,foreignTargets:0,ignored:3});assert.equal(r.first.jobs[0].qualityPages,1);assert.equal(r.other.jobs.length,0);assert.ok(!JSON.stringify(r.first).includes('private-cursor'));assert.equal(r.other.rows.length,0);assert.equal(r.stale,true);
 });
});
