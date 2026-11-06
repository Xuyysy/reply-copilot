// Actual content/background/hosted orchestration; only DOM, transport and D1 latency are synthetic.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {generationFixture} from '../../scripts/lib/generation-performance-fixture.mjs';import {DEFAULT_MOMENTUM_CONFIG} from '../../domain/creator-momentum.js';
const current=new URL('../..',import.meta.url).pathname;
test('fixed Production full-path alternating A/B includes binding, account preflight, voice/history, ACK and fill',{timeout:60000},async()=>{
 const baseline=mkdtempSync(path.join(tmpdir(),'xrh-momentum-fixed-production-'));
 try{
  const archive=execFileSync('git',['archive','3cebe3ecbee552ef5b0e68afc7882a2dfb3869fa'],{maxBuffer:64*1024*1024});execFileSync('tar',['-x','-C',baseline],{input:archive});
  const before=[],after=[];let promptHash=null;
  for(let i=0;i<14;i++)for(const [kind,sourceRoot]of (i%2?[['after',current],['before',baseline]]:[['before',baseline],['after',current]])){
   const r=await generationFixture({sourceRoot,options:{momentumFeature:{eligible:true,policy:{...DEFAULT_MOMENTUM_CONFIG,enabled:true}}}});
   assert.deepEqual(r.calls,{generations:1,acks:1,debits:1,insertions:1});if(!promptHash)promptHash=r.promptHashes[0];assert.equal(r.promptHashes[0],promptHash,'personalized prompt body unchanged');assert.equal(r.requestPaths.length,5);assert.ok(r.marks.insert>=r.marks.ack_end);
   if(i>=2)(kind==='before'?before:after).push({display:r.marks.candidates,editor:r.elapsedMs,ack:r.report.metrics.ack.p50,editorBinding:r.report.metrics.editor_bound.p50,preflight:r.report.metrics.precheck_complete.p50,http:r.requestPaths.length});
  }
  const summary=rows=>{const result={samples:rows.length,http:[...new Set(rows.map(r=>r.http))],normalExtraRecoveryHTTP:0};for(const key of ['display','editor','ack','editorBinding','preflight']){const a=rows.map(r=>r[key]).sort((a,b)=>a-b);result[key]={mean:a.reduce((s,x)=>s+x,0)/a.length,p50:a[Math.ceil(a.length*.5)-1],p90:a[Math.ceil(a.length*.9)-1]};}return result;};
  const report={environment:'Synthetic DOM/transport/D1 latency; actual fixed source content/background/hosted/provider/ACK paths; no real vendor or X requests.',before:summary(before),after:summary(after)};
  writeFileSync('/private/tmp/xrh-momentum-full-path-performance.json',JSON.stringify(report,null,2));console.log('Full-path A/B '+JSON.stringify(report));assert.ok(report.after.editor.p90-report.before.editor.p90<10,'investigate >10ms reproducible client overhead');
 }finally{rmSync(baseline,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
