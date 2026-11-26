import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withMomentumBrowser} from './helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../api/package.json',import.meta.url))('esbuild');
const js=buildSync({stdin:{contents:"import {Workspace} from './interaction-manager/ui/workspace.js';window.W=Workspace;window.momentumReady=true;",resolveDir:process.cwd()},bundle:true,format:'iife',write:false}).outputFiles[0].text;
test('offline workspace end-to-end: import, reload, directions, details, isolation and deletion',{timeout:60000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate,call})=>{
 const r=await evaluate("(async()=>{const w=await W.open();await w.select('111');const now=Date.now();const file=JSON.stringify({format:'xrh-interaction-evidence-v1',ownerUserId:'111',kind:'post',observedAt:now,posts:[{postId:'123',authorUserId:'222',replyToUserId:'111',replyToPostId:'456',createdAt:now-1000},{postId:'124',authorUserId:'111',replyToUserId:'222',replyToPostId:'123',createdAt:now-1000}]});const first=await w.importText(file),repeat=await w.importText(file),view=await w.view({direction:'both'}),details=await w.details('222',{direction:'inbound',days:7});await w.select('333');let rejected=false;try{await w.importText(file)}catch(e){rejected=e.message==='owner_mismatch'}return {first,repeat,view,details,empty:(await w.view()).stored,rejected}})()");
 assert.equal(r.first.inserted,2);assert.equal(r.repeat.inserted,0);assert.equal(r.view.people[0].count,2);assert.equal(r.details.length,1);assert.equal(r.empty,0);assert.equal(r.rejected,true);
 await call('Page.reload');for(let i=0;i<100;i++){if(await evaluate('Boolean(window.momentumReady&&window.W)'))break;await new Promise(r=>setTimeout(r,10));}
 const after=await evaluate("(async()=>{const w=await W.open();await w.select('111');const before=(await w.view({direction:'both'})).stored;await w.clear();return {before,after:(await w.view()).stored,coverage:(await w.view()).coverage.length}})()");
 assert.deepEqual(after,{before:2,after:0,coverage:0});
 });
});
