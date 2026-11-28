import test from 'node:test';
import assert from 'node:assert/strict';
import '../staging/interaction-interface.js';
import {createInteractionResponseProbe,responseKind} from '../staging/interaction-response-probe.js';
const project=globalThis.ReplyCopilotInteractionInterface.project;
const body={globalObjects:{notifications:{n:{icon:{id:'heart_icon'},template:{aggregateUserActionsV1:{targetObjects:[{tweet:{id:'555'}}],fromUsers:[{user:{id:'222'}}]}}}},tweets:{555:{id_str:'555',user_id_str:'111',full_text:'PRIVATE'}},users:{222:{id_str:'222',screen_name:'alice'}}},timeline:{instructions:[{addEntries:{entries:[{entryId:'notification-n',content:{}}]}}]}};
const channel=()=>{const set=new Set();return {addListener:f=>set.add(f),removeListener:f=>set.delete(f),emit:x=>{for(const f of [...set])f(x)},get size(){return set.size}}};
function fixture(){
 const network={onRequestFinished:channel(),onNavigated:channel()},reports=[],commits=[];
 const probe=createInteractionResponseProbe({network,project,commit:async x=>{commits.push(x);return {inserted:1,accepted:1}},notify:x=>reports.push(x),schedule:()=>1,unschedule:()=>{}});
 const start=()=>probe.start({source:'notification',ownerUserId:'111',authorized:true});
 let reads=0;
 const entry=(status=200,url='https://x.com/i/api/2/notifications/all.json',method='GET')=>({request:{url,method,get headers(){throw Error('must not read headers')}},response:{status,content:{size:100},get headers(){throw Error('must not read headers')}},getContent:f=>{reads++;f(JSON.stringify(body),'')}});
 return {network,reports,commits,probe,start,entry,get reads(){return reads}};
}
test('one authorized native response without terminal evidence is persisted as a sample, never a checkpoint',async()=>{
 const f=fixture();assert.equal(f.network.onRequestFinished.size,0);
 assert.throws(()=>f.probe.start({source:'notification',ownerUserId:'111',authorized:false}),/invalid_context/);
 assert.throws(()=>project(body,'rest','111'),/terminal_unverified/);
 f.start();f.network.onRequestFinished.emit(f.entry(200,'https://evil.test/i/api/2/notifications/all.json'));f.network.onRequestFinished.emit(f.entry(200,undefined,'POST'));
 assert.equal(f.reads,0);f.network.onRequestFinished.emit(f.entry());f.network.onRequestFinished.emit(f.entry());await Promise.resolve();await Promise.resolve();
 assert.equal(f.reads,1);assert.equal(f.commits.length,1);assert.equal(f.commits[0].events[0].type,'like');assert.ok(!JSON.stringify(f.commits).includes('PRIVATE'));assert.equal(f.reports.at(-1).phase,'saved');assert.equal(f.reports.at(-1).historyComplete,false);assert.equal(f.network.onRequestFinished.size,0);
});
test('denied and navigated samples stop without reading or committing bodies',()=>{
 for(const status of [401,403,429]){const f=fixture();f.start();f.network.onRequestFinished.emit(f.entry(status));assert.equal(f.reads,0);assert.equal(f.commits.length,0);assert.equal(f.reports.at(-1).httpStatus,status);assert.equal(f.probe.active,false);}
 const f=fixture();f.start();f.network.onNavigated.emit('https://x.com/home');f.network.onRequestFinished.emit(f.entry());assert.equal(f.reads,0);assert.equal(f.reports.at(-1).reason,'navigation');
 assert.equal(responseKind('https://x.com/i/api/graphql/abcdefgh/SearchTimeline','post'),'search');assert.equal(responseKind('https://x.com/i/api/graphql/abcdefgh/SearchTimeline','notification'),null);
});

test('a background cancellation is reported without replacing it with a generic source error',async()=>{
 const network={onRequestFinished:channel(),onNavigated:channel()},reports=[];
 const probe=createInteractionResponseProbe({network,project,commit:async()=>{throw Error('cancelled')},notify:e=>reports.push(e),schedule:()=>1,unschedule:()=>{}});
 probe.start({source:'notification',ownerUserId:'111',authorized:true});
 network.onRequestFinished.emit({request:{url:'https://x.com/i/api/2/notifications/all.json',method:'GET'},response:{status:200},getContent:f=>f(JSON.stringify(body),'')});
 await Promise.resolve();await Promise.resolve();assert.equal(reports.at(-1).reason,'cancelled');assert.equal(probe.active,false);
});
