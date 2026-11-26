import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {withMomentumBrowser} from './helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../api/package.json',import.meta.url))('esbuild');
const bundle=buildSync({stdin:{contents:"import './interaction-manager/ui/page.js';window.momentumReady=true;",resolveDir:process.cwd()},bundle:true,format:'iife',write:false}).outputFiles[0].text;
const html=readFileSync(new URL('../interaction-manager/ui/index.html',import.meta.url),'utf8').replace('<script type="module" src="page.js"></script>','<script>'+bundle.replace(/<\/script/gi,'<\\/script')+'</script>');
test('offline workbench actual DOM: import, replay, type filter, date filter, details, reload, owner deletion',{timeout:60000},async()=>{
 await withMomentumBrowser(html,async({evaluate,call})=>{
  const wait=async expression=>{for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,25));}throw Error('workbench not ready: '+expression);};
  const open=async id=>{await wait("!document.querySelector('#owner-form button').disabled");await evaluate("document.getElementById('owner').value="+JSON.stringify(id)+";document.getElementById('owner-form').requestSubmit()");await wait("document.getElementById('active-owner').textContent.includes("+JSON.stringify(id)+")&&!document.getElementById('import').disabled");};
  const now=Date.now();
  const payload={format:'xrh-interaction-evidence-v1',ownerUserId:'111',kind:'post',posts:[{postId:'11',authorUserId:'222',replyToUserId:'111',replyToPostId:'10',createdAt:now-1000},{postId:'12',authorUserId:'222',quotedUserId:'111',quotedPostId:'10',createdAt:null},{postId:'13',authorUserId:'111',replyToUserId:'222',replyToPostId:'11',createdAt:now-1000}],users:[{userId:'222',handle:'alice'}]};
  const importFile=async(obj,added)=>{await evaluate("(async()=>{const dt=new DataTransfer();dt.items.add(new File(["+JSON.stringify(JSON.stringify(obj))+"],'data.json',{type:'application/json'}));document.getElementById('file').files=dt.files;document.getElementById('import').click();})()");await wait("!document.getElementById('import').disabled&&document.getElementById('status').textContent.includes('新增 "+added+" 条')");};
  const count=()=>evaluate("document.querySelector('#ranking tr td:nth-child(3)')?.textContent");
  const filter=async(id,value)=>{await evaluate("document.getElementById("+JSON.stringify(id)+").value="+JSON.stringify(value)+";document.getElementById("+JSON.stringify(id)+").dispatchEvent(new Event('change'))");await wait("!document.getElementById('import').disabled");};
  await open('111');await importFile(payload,3);assert.equal(await count(),'2');
  assert.match(await evaluate("document.getElementById('ranking').textContent"),/@alice/);await importFile(payload,0);
  await filter('type','reply');assert.equal(await count(),'1');
  await filter('type','all');await filter('days','7');assert.equal(await count(),'1');
  await evaluate("document.querySelector('#ranking button').click()");await wait("!document.getElementById('import').disabled");assert.equal(await evaluate("document.querySelectorAll('#details li').length"),1);
  await filter('direction','outbound');assert.equal(await count(),'1');
  await call('Page.reload');await wait('Boolean(window.momentumReady)');await open('111');assert.equal(await count(),'2');
  await open('333');assert.equal(await evaluate("document.querySelectorAll('#ranking tr').length"),0);
  await importFile({format:'xrh-interaction-evidence-v1',ownerUserId:'333',kind:'post',posts:[{postId:'14',authorUserId:'444',replyToUserId:'333',replyToPostId:'15',createdAt:now-1000}]},1);
  await open('111');await evaluate("window.confirm=()=>true;document.getElementById('clear').click()");await wait("document.getElementById('status').textContent.includes('当前资料已清除')&&!document.getElementById('import').disabled");
  assert.equal(await evaluate("document.querySelectorAll('#ranking tr').length"),0);await open('333');assert.equal(await count(),'1');
 });
});
