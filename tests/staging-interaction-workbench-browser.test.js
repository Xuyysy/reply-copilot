import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {withMomentumBrowser} from './helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../api/package.json',import.meta.url))('esbuild');
const html=readFileSync(new URL('../staging/interaction-workbench.html',import.meta.url),'utf8').replace(/<script type="module"[^>]*><\/script>/,'');
const js=buildSync({entryPoints:['staging/interaction-workbench.js'],bundle:true,format:'iife',write:false}).outputFiles[0].text;
const fixture=()=>{let owner='111';const identity={ownerUserId:'111',handle:'alice'};window.fixture={change:()=>{owner='222';}};
 const rows=Array.from({length:55},(_,i)=>({ownerUserId:'111',actorUserId:String(1000+i),targetUserId:'111',eventId:'111:like:'+String(1000+i)+':111:555',type:'like',direction:'inbound',targetPostId:'555',eventPostId:null,occurredAt:null,observedAt:Date.now(),source:'notification',sources:['notification'],evidenceQuality:'confirmed'}));
 const users=rows.map((r,i)=>({ownerUserId:'111',userId:r.actorUserId,handle:'user'+i,observedAt:Date.now()}));
 Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{sendMessage:async m=>({ok:true,value:m.action==='identity'?{...identity,ownerUserId:owner}:{identity,dataset:{ownerUserId:'111',rows,users,coverage:[],jobs:[]},sourceReady:false,running:false}})}}});
};
const setup=html.replace('</body>','<script>('+fixture.toString()+')();'+js+';window.momentumReady=true;</script></body>');
const wait=async(evaluate,expr)=>{for(let i=0;i<350;i++){if(await evaluate(expr))return;await new Promise(r=>setTimeout(r,10));}throw Error('UI timeout '+expr);};
test('independent interaction page automatically loads real-format cache and hides on owner switch',{timeout:30000},async()=>{
 await withMomentumBrowser(setup,async({evaluate})=>{
  await wait(evaluate,"document.getElementById('ranking').children.length===50");
  assert.equal(await evaluate("document.getElementById('people-count').textContent"),'55');
  assert.match(await evaluate("document.getElementById('status').textContent"),/尚未接入/);
  await evaluate("document.getElementById('next').click()");
  await wait(evaluate,"document.getElementById('ranking').children.length===5");
  await evaluate("document.querySelector('#ranking button').click()");
  await wait(evaluate,"document.getElementById('detail').textContent.includes('点赞')");
  await evaluate("fixture.change()");
  await wait(evaluate,"document.getElementById('content').hidden");
  assert.equal(await evaluate("document.getElementById('ranking').children.length"),0);
 });
});
