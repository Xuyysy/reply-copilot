import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {withMomentumBrowser} from "./helpers/momentum-browser.js";
const {buildSync}=createRequire(new URL("../api/package.json",import.meta.url))("esbuild");
const bundle=buildSync({stdin:{contents:"import {createApprovedFollowRunner} from './follow-manager/v2/approved-runner.js';import {openRepository} from './follow-manager/v2/store.js';window.R={createApprovedFollowRunner,openRepository};window.momentumReady=true;",resolveDir:process.cwd()},bundle:true,format:"iife",write:false}).outputFiles[0].text;
test("approved source through Chromium IndexedDB: incomplete -> resume -> complete snapshot, no fixture leakage",{timeout:60000},async()=>{
 await withMomentumBrowser("<script>"+bundle+"</script>",async({evaluate})=>{
  const result=await evaluate("(async()=>{const owner='9007199254740993123',binding={ownerUserId:owner,handle:'Zane',sessionId:'session'},counts={following:2,followers:2};const entry=id=>({entryId:'user-'+id,content:{entryType:'TimelineTimelineItem',itemContent:{itemType:'TimelineUser',user_results:{result:{__typename:'User',rest_id:id,core:{screen_name:'user'+id},legacy:{followers_count:3}}}}}});const payload=kind=>({data:{user:{result:{__typename:'User',rest_id:owner,timeline_v2:{timeline:{instructions:[{type:'TimelineAddEntries',entries:(kind==='following'?['2','3']:['2','4']).map(entry)},{type:'TimelineTerminateTimeline',direction:'Bottom'}]}}}}});let opens=0,closes=0;const runner=R.createApprovedFollowRunner({openTransport:async()=>{opens++;return {currentBinding:async()=>binding,readSelf:async()=>({viewerUserId:owner,profileUserId:owner,handle:binding.handle,counts}),readPage:async({kind})=>({status:200,payload:payload(kind)}),close:async()=>{closes++}}},maxPages:1});runner.start({binding,authorized:true});await runner.waitForIdle();const repo=await R.openRepository(indexedDB,{live:true}),partial=await repo.readProgress(owner),old=await repo.readFollowSnapshot(owner);runner.start({binding,authorized:true});await runner.waitForIdle();const full=await repo.readSnapshot(owner),bridge=await repo.readFollowSnapshot(owner),list=await repo.listSnapshots(owner);await repo.purge(owner);repo.close();return {first:partial?.completeness,unknown:partial?.relationshipByUserId['3']?.follower,old:old.completeness,final:full?.completeness,negative:full?.relationshipByUserId['3']?.follower,bridge:bridge.completeness,history:list.length,opens,closes};})()");
  assert.deepEqual(result,{first:"partial",unknown:null,old:"unknown",final:"complete",negative:false,bridge:"unknown",history:1,opens:2,closes:2});
 });
});

test("Chromium: rate limit leaves last complete snapshot, explicit restart rotates lease and recovers",{timeout:60000},async()=>{
 await withMomentumBrowser("<script>"+bundle+"</script>",async({evaluate})=>{
  const result=await evaluate(`(async()=>{
   const owner="123",binding={ownerUserId:owner,handle:"self",sessionId:"one"},counts={following:1,followers:1};
   const u=id=>({entryId:"user-"+id,content:{entryType:"TimelineTimelineItem",itemContent:{itemType:"TimelineUser",user_results:{result:{__typename:"User",rest_id:id}}}}});
   const payload=kind=>({data:{user:{result:{__typename:"User",rest_id:owner,timeline_v2:{timeline:{instructions:[
    {type:"TimelineAddEntries",entries:[u(kind==="following"?"3":"4")]},
    {type:"TimelineTerminateTimeline",direction:"Bottom"}]}}}}}});
   let rateLimit=false,requests=0,closed=0;
   const runner=R.createApprovedFollowRunner({openTransport:async()=>({
    currentBinding:async()=>binding,readSelf:async()=>({viewerUserId:owner,profileUserId:owner,handle:"self",counts}),
    readPage:async({kind})=>{requests++;return rateLimit?{status:429,payload:{}}:{status:200,payload:payload(kind)}},
    close:async()=>{closed++}
   })});
   runner.start({binding,authorized:true});await runner.waitForIdle();
   const repo=await R.openRepository(indexedDB,{live:true}),first=await repo.readSnapshot(owner);
   rateLimit=true;runner.start({binding,authorized:true});await runner.waitForIdle();
   const error=runner.status(binding).status,previous=await repo.readSnapshot(owner),active=await repo.active(owner);
   rateLimit=false;runner.start({binding,authorized:true});await runner.waitForIdle();
   const latest=await repo.readSnapshot(owner),history=await repo.listSnapshots(owner);
   repo.close();
   return {first:first.completeness,error,unchanged:first.capturedAt===previous.capturedAt,
    interrupted:active.status,final:latest.completeness,history:history.length,requests,closed};
  })()`);
  assert.deepEqual(result,{first:"complete",error:"rate_limited",unchanged:true,interrupted:"rate_limited",final:"complete",history:2,requests:5,closed:3});
 });
});
