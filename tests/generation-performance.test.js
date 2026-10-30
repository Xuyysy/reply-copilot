import test from 'node:test';
import assert from 'node:assert/strict';
import '../utils/generation-performance.js';
const perf=globalThis.ReplyCopilotPerformance;

test('opt-in performance diagnostics only retain finite allowlisted timings, never arbitrary payloads',async()=>{
 assert.equal(perf.createTrace().snapshot(),null);
 let now=20;const trace=perf.createTrace({enabled:true,now:()=>now});
 trace.mark('reply_click');now+=12;trace.mark('editor_bound');
 trace.mark('secret-post');trace.addDurations({dns:30,model:NaN,'requestId':'secret-id',ack:-1});
 await trace.measure('ack',async()=>{now+=8;return 'private reply';});
 const sample=trace.snapshot('success');
 assert.deepEqual(sample,{outcome:'success',marks:{reply_click:0,editor_bound:12},durations:{dns:30,ack:8},elapsedMs:20});
 assert.equal(JSON.stringify(sample).includes('private'),false);
 const c=perf.createCollector({limit:2});
 c.record({...sample,requestId:'secret',body:'secret'});c.record({...sample,elapsedMs:30});c.record({...sample,elapsedMs:40});
 c.record({outcome:'garbage',marks:{reply_click:'x'}});
 const report=c.report();assert.equal(report.samples,2);assert.equal(report.metrics.elapsedMs.p50,30);assert.equal(report.metrics.elapsedMs.p95,40);assert.equal(JSON.stringify(report).includes('secret'),false);
});

test('diagnostics keep failed/cancelled/incomplete separate from successful end-to-end percentiles',()=>{
 const c=perf.createCollector();
 c.record({outcome:'success',marks:{reply_click:0,editor_verified:100},elapsedMs:100});
 c.record({outcome:'failed',marks:{reply_click:0},elapsedMs:900});
 c.record({outcome:'cancelled',marks:{reply_click:0},elapsedMs:300});
 assert.equal(c.report().metrics.editor_verified.p95,100);
 assert.deepEqual(c.report().outcomes,{success:1,failed:1,cancelled:1});
 c.clear();assert.equal(c.report().samples,0);
});


test('click origin includes synchronous extraction before a trace is allocated',()=>{
 let now=20;const trace=perf.createTrace({enabled:true,now:()=>now,startAt:12});
 trace.mark('reply_click',12);now=24;trace.mark('editor_bound');
 assert.equal(trace.snapshot().elapsedMs,12);assert.equal(trace.snapshot().marks.reply_click,0);assert.equal(trace.snapshot().marks.editor_bound,12);
});
