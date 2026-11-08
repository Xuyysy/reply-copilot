import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withMomentumBrowser} from './helpers/momentum-browser.js';

const script=readFileSync(new URL('../content/inline-assistant.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../content/inline-assistant.css',import.meta.url),'utf8');
const replies={natural:'自然回复',light_humor:'幽默回复',thoughtful:'观点回复'};
const page=`<script>window.chrome={runtime:{getURL:()=> 'data:text/css,'}};window.actions=[];</script><script>${script}</script><script>
window.fixture=ZaneReplyCopilotContent.inlineAssistant.mount(document.body,(action,data)=>actions.push({action,data}),{preferences:{autoGenerateOnReply:false,defaultReplyMode:'natural'}});
const style=document.createElement('style');style.textContent=${JSON.stringify(css)};
fixture.host.shadowRoot.prepend(style);
fixture.showResult(${JSON.stringify(replies)},'natural');
window.momentumReady=true;
</script>`;
const snapshot=`(()=>[...fixture.host.shadowRoot.querySelectorAll('.style-tabs button')].map(b=>({
 key:b.dataset.style,active:b.classList.contains('active'),pressed:b.getAttribute('aria-pressed'),
 background:getComputedStyle(b).backgroundColor
})))()`;
function check(rows,key){
 assert.equal(rows.filter(x=>x.active).length,1);
 assert.equal(rows.filter(x=>x.pressed==='true').length,1);
 assert.equal(rows.find(x=>x.key===key).active,true);
 assert.equal(rows.find(x=>x.key===key).pressed,'true');
 assert.equal(new Set(rows.map(x=>x.background)).size,2,'only the active choice has a distinct background');
}
test('floating V2 style controls show exactly one active color after click, default setting and cycle',{timeout:30000},async()=>{
 await withMomentumBrowser(page,async({evaluate,call})=>{
  let rows=await evaluate(snapshot);check(rows,'natural');
  const point=await evaluate(`(()=>{const r=fixture.host.shadowRoot.querySelector('[data-style="light_humor"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
  rows=await evaluate(snapshot);check(rows,'light_humor');
  assert.equal(rows.find(x=>x.key==='natural').pressed,'false');
  assert.equal(await evaluate('actions.at(-1).action'),'selected');
  assert.equal(await evaluate('fixture.host.shadowRoot.querySelector(".reply").textContent'),'幽默回复');
  await evaluate('fixture.showResult('+JSON.stringify(replies)+',"thoughtful")');
  rows=await evaluate(snapshot);check(rows,'thoughtful');
  assert.equal(await evaluate('fixture.host.shadowRoot.querySelector(".reply").textContent'),'观点回复');
  await evaluate('fixture.host.shadowRoot.querySelector("[data-action=change]").click()');
  rows=await evaluate(snapshot);check(rows,'natural');
  await evaluate('fixture.showResult('+JSON.stringify(replies)+',"light_humor");fixture.host.dataset.theme="dark"');
  rows=await evaluate(snapshot);check(rows,'light_humor');
  assert.equal(await evaluate('getComputedStyle(fixture.host.shadowRoot.querySelector(".panel")).backgroundColor'),'rgb(26, 36, 52)');
  await evaluate('fixture.host.shadowRoot.querySelector("[data-action=minimize]").click()');
  assert.equal(await evaluate('getComputedStyle(fixture.host.shadowRoot.querySelector(".body")).display'),'none');
 });
});
test('style highlight CSS never assumes natural is the active first-child',()=>{
 assert.doesNotMatch(css,/\.actions\s+button:first-child\s*\{/);
 assert.match(css,/\.action-row\s+button:first-child\s*\{/);
 assert.match(css,/\.style-tabs\s+button\[aria-pressed="true"\]/);
 const code=readFileSync(new URL('../content/content-script.js',import.meta.url),'utf8');
 assert.match(code,/current\.preferences\?\.defaultReplyMode\s*\|\|/);
});
