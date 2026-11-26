import test from "node:test";import assert from "node:assert/strict";import {createRequire} from "node:module";import {withMomentumBrowser} from "./helpers/momentum-browser.js";
const {buildSync}=createRequire(new URL("../api/package.json",import.meta.url))("esbuild");
const bundle=buildSync({stdin:{contents:"import {openRepository,LIVE_SOURCE} from './follow-manager/v2/store.js';import {mountAuthorizedCache} from './follow-manager/v2/cache-workbench.js';window.R={openRepository,LIVE_SOURCE,mountAuthorizedCache};window.momentumReady=true;",resolveDir:process.cwd()},bundle:true,format:"iife",write:false}).outputFiles[0].text;
test("authorized cache workbench Chromium: real IndexedDB, partial evidence, history and account invalidation",{timeout:60000},async()=>{
 await withMomentumBrowser("<div id='root'></div><script>"+bundle+"</script>",async({evaluate})=>{
  await evaluate("(async()=>{const r=await R.openRepository(indexedDB,{live:true}),o='123',s=R.LIVE_SOURCE;window.repo=r;window.identity={source:s,ownerUserId:o,sessionId:'one',identityEvidence:'self_profile_and_session'};const save=async(f,g)=>{let j=await r.start(o,s,{followers:f.length,following:g.length});for(const [kind,ids] of [['followers',f],['following',g]])j=await r.append(o,j.jobId,j.lease,kind,{cursor:null,nextCursor:null,terminal:true,expected:ids.length,coverage:'authorized_observed',users:ids.map(n=>({userId:String(n),handle:'u'+n}))});await r.finalize(o,j.jobId,j.lease,{followers:f.length,following:g.length});};await save([2,3],[2,4]);await save([2,5],[2,6]);let j=await r.start(o,s,{following:2,followers:2});await r.append(o,j.jobId,j.lease,'following',{cursor:null,nextCursor:null,terminal:true,expected:2,coverage:'authorized_observed',users:[{userId:'7',handle:'u7'},{userId:'8',handle:'u8'}]});window.view=await R.mountAuthorizedCache({root:document.getElementById('root'),repo:r,ownerUserId:o,sessionId:'one',readIdentity:async()=>window.identity,download:async()=>{}});})()");
  assert.match(await evaluate("document.getElementById('cache-summary').textContent"),/没回关 1/);
  assert.match(await evaluate("document.getElementById('cache-progress').textContent"),/关注 2\\/2/);
  const wait=async expr=>{for(let i=0;i<100;i++){if(await evaluate(expr))return;await new Promise(r=>setTimeout(r,25))}throw Error("cache view timeout")};
  await evaluate("document.getElementById('cache-compare').click()");await wait("document.querySelectorAll('#cache-history-list li').length>0");
  await evaluate("document.getElementById('cache-mode').value='progress';document.getElementById('cache-mode').dispatchEvent(new Event('input'))");
  await wait("document.getElementById('cache-summary').textContent.includes('部分名单')");
  assert.equal(await evaluate("document.querySelector('#cache-kind option[value=notFollowingBack]').disabled"),true);
  assert.match(await evaluate("document.getElementById('cache-list').textContent"),/@u7/);
  await evaluate("window.identity={...window.identity,ownerUserId:'999'};document.getElementById('cache-refresh').click()");
  await wait("document.getElementById('cache-content').hidden");
  assert.equal(await evaluate("document.getElementById('cache-list').textContent"),"");
  await evaluate("window.view.dispose();window.repo.close()");
 });
});
