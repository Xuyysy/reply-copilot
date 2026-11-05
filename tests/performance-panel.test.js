import test from 'node:test';import assert from 'node:assert/strict';import {mountPerformancePanel} from '../sidepanel/performance-panel.js';
test('Staging report controls only toggle diagnostics and expose aggregates without generating AI',async()=>{
 const calls=[],nodes=[];const el=tag=>{const n={tag,children:[],listeners:{},append(...v){this.children.push(...v);},setAttribute(){},addEventListener(t,fn){this.listeners[t]=fn;}};nodes.push(n);return n;};const dashboard=el('section'),document={createElement:el,getElementById:id=>id==='dashboard'?dashboard:null};
 mountPerformancePanel(document,{sendMessage:async m=>{calls.push(m);return{ok:true,enabled:m.enabled===true,report:{samples:2,metrics:{model:{mean:100}}}};}});await Promise.resolve();
 const start=nodes.find(n=>n.textContent==='开始记录');await start.listeners.click();assert.deepEqual(calls.at(-1),{type:'REPLY_COPILOT_PERFORMANCE_CONTROL',enabled:true});assert.equal(dashboard.children.length,1);assert.ok(calls.every(c=>c.type==='REPLY_COPILOT_PERFORMANCE_CONTROL'));assert.equal(JSON.stringify(calls).includes('requestId'),false);
});
