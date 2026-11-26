import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {withMomentumBrowser} from './helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../api/package.json',import.meta.url))('esbuild');
const build=readFileSync(new URL('../scripts/build.js',import.meta.url),'utf8');
const match=build.match(/const apiInteraction='([^\n]+)';/);
assert.ok(match,'actual Staging panel markup must exist');
const js=buildSync({entryPoints:['staging/interaction-interface-panel.js'],bundle:true,format:'iife',write:false}).outputFiles[0].text;
// Browser DOM and IndexedDB are real. Only the extension message boundary is
// simulated; there is no X traffic or access to a real account in this test.
const fixture=()=>{let owner='111',activeTab=1,serial=0,session=null;const calls=[],events={activated:[],updated:[],removed:[]};const listener=k=>({addListener:f=>events[k].push(f)});const user=(id,h)=>({rest_id:id,core:{screen_name:h}});
 const page=(cursor)=>{
 const actors=Array.from({length:cursor===null?55:1},(_,i)=>({user_results:{result:user(String(1000+i),'user'+i)}}));
 return {status:200,ownerUserId:owner,source:'notification',requestCursor:cursor,structureVerified:true,done:cursor!==null,nextCursor:cursor===null?'next':null,terminalEvidence:cursor===null?null:'explicit',payload:{data:[{__typename:'TimelineNotification',notification_icon:'heart_icon',template:{from_users:actors,target_objects:[{tweet_results:{result:{rest_id:cursor===null?'555':'556',core:{user_results:{result:user(owner,'me')}}}}}]}}]},posts:cursor===null?[{postId:'777',authorUserId:'1000',replyToUserId:owner,replyToPostId:'555',createdAt:Date.now()-1000}]:[],users:[]};};
 window.fixture={calls,events,changeOwner:v=>{owner=v;},switchTab:v=>{activeTab=v;events.activated.forEach(f=>f({tabId:v}));}};
 Object.defineProperty(window,'chrome',{configurable:true,value:{tabs:{query:async()=>[{id:activeTab}],onActivated:listener('activated'),onUpdated:listener('updated'),onRemoved:listener('removed'),sendMessage:async(tab,m)=>{calls.push({action:m.action,readOnly:m.readOnly,cursor:m.cursor});if(m.action==='start'){session='fixture-'+(++serial);return {ok:true,value:{ownerUserId:owner,handle:'me',sessionId:session,kind:m.readOnly?null:'graphql'}};}if(m.action==='cancel')return {ok:true,value:{}};if(m.sessionId!==session)return {ok:false,error:'identity_changed'};if(m.action==='identity')return {ok:true,value:{ownerUserId:owner,handle:'me',sessionId:session}};if(m.action==='page')return {ok:true,value:page(m.cursor)};return {ok:false,error:'source_error'};}}}});
};
const setup=match[1]+'<script>('+fixture.toString()+')();'+js+';window.momentumReady=true;</script>';
const wait=async(evaluate,expr)=>{for(let i=0;i<300;i++){if(await evaluate(expr))return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timeout: '+expr);};
test('interface workbench actual DOM: sync two pages, persistence, filters, details, account isolation and cache only',{timeout:60000},async()=>{
 await withMomentumBrowser(setup,async({evaluate,call})=>{
 const ready="!document.getElementById('interface-sync').disabled";
 await evaluate("document.getElementById('interface-authorized').click();document.getElementById('interface-sync').click()");
 await wait(evaluate,ready+"&&document.getElementById('interface-results').children.length===50");
 assert.equal(await evaluate("document.getElementById('interface-page').textContent"),'1 / 2');
 assert.deepEqual(await evaluate("fixture.calls.filter(x=>x.action==='page').map(x=>x.cursor)"),[null,'next']);
 assert.match(await evaluate("document.getElementById('interface-summary').textContent"),/57 条/);
 await evaluate("document.getElementById('interface-next').click()");
 await wait(evaluate,"document.getElementById('interface-results').children.length===5");
 assert.equal(await evaluate("document.getElementById('interface-results').children.length"),5);
 await evaluate("document.getElementById('interface-days').value='7';document.getElementById('interface-days').dispatchEvent(new Event('change'));");
 await wait(evaluate,"document.getElementById('interface-results').children.length===1");
 assert.equal(await evaluate("document.getElementById('interface-results').children.length"),1);
 await evaluate("document.querySelector('#interface-results button').click()");
 await wait(evaluate,"document.getElementById('interface-detail').textContent.includes('回复')");
 assert.match(await evaluate("document.getElementById('interface-detail').textContent"),/回复/);
 await evaluate("document.getElementById('interface-days').value='';document.getElementById('interface-days').dispatchEvent(new Event('change'));document.getElementById('interface-search').value='user0';document.getElementById('interface-search').dispatchEvent(new Event('input'));");
 await wait(evaluate,"document.getElementById('interface-results').children.length===1");
 assert.equal(await evaluate("document.getElementById('interface-results').children.length"),1);
 await evaluate("fixture.switchTab(2)");
 assert.equal(await evaluate("document.getElementById('interface-results').children.length"),0);
 await call('Page.reload');await wait(evaluate,"Boolean(window.momentumReady)");
 await evaluate("document.getElementById('interface-authorized').click();document.getElementById('interface-cached').click()");
 await wait(evaluate,ready+"&&document.getElementById('interface-results').children.length===50");
 assert.equal(await evaluate("fixture.calls.filter(x=>x.action==='page').length"),0);
 await evaluate("fixture.changeOwner('333')");
 await wait(evaluate,"document.getElementById('interface-results').children.length===0&&document.getElementById('interface-status').textContent.includes('账号或页面已变化')");
 assert.equal(await evaluate("fixture.calls.filter(x=>x.action==='page').length"),0);
 await evaluate("document.getElementById('interface-cached').click()");
 await wait(evaluate,ready+"&&document.getElementById('interface-summary').textContent.includes('已存 0 条')");
 assert.equal(await evaluate("document.getElementById('interface-results').children.length"),0);
 });
});
