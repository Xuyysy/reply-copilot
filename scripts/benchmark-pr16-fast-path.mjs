// Reproducible isolated comparison; never connects to a real website/provider/D1.
import {generationFixture} from './lib/generation-performance-fixture.mjs';
import {writeFileSync} from 'node:fs';import path from 'node:path';
const args=process.argv.slice(2),option=(key,fallback)=>{const at=args.indexOf(key);return at<0?fallback:args[at+1];};
const baseline=path.resolve(option('--baseline','/private/tmp/reply-copilot-pr16-before-fast')),candidate=path.resolve(new URL('..',import.meta.url).pathname),n=Number(option('--samples',20)),networkMs=Number(option('--network-ms',80));
if(!Number.isInteger(n)||n<5||n>40||!Number.isFinite(networkMs)||networkMs<0||networkMs>250)throw Error('Invalid bounded benchmark parameters');
const versions={baseline,candidate},runs={baseline:[],candidate:[]};
const stats=values=>{const a=[...values].sort((a,b)=>a-b),p=q=>a[Math.min(a.length-1,Math.ceil(a.length*q)-1)]||0;return{n:a.length,mean:values.reduce((a,b)=>a+b,0)/Math.max(1,a.length),p50:p(.5),p90:p(.9)};};
for(let i=-2;i<n;i++)for(const version of (i%2===0?['baseline','candidate']:['candidate','baseline'])){
 const run=await generationFixture({sourceRoot:versions[version],scenario:'english-short',options:{networkRoundTripMs:networkMs,deadlineMs:3000}});
 if(i>=0)runs[version].push(run);
}
const summary={parameters:{samplesPerVersion:n,warmupsPerVersion:2,fixedHttpDelayMs:networkMs,provider:'same synthetic Qwen-compatible fixture; 35ms fixed model delay',database:'synthetic reservation boundary, NOT live D1 latency',measurement:'native reply click -> verified editable mock composer; fresh content/background VM each sample',realX:false},versions:{}};
for(const [name,rows]of Object.entries(runs)){
 const metric=key=>stats(rows.map(r=>r.report.metrics[key]?.mean||0));
 summary.versions[name]={endToEndMs:stats(rows.map(r=>r.elapsedMs)),successRate:rows.filter(r=>r.calls.insertions===1&&r.calls.debits===1).length/rows.length,recoveryGets:stats(rows.map(r=>r.requestPaths.filter(p=>p.startsWith('/v1/ai/requests/')&&!p.endsWith('/delivered')).length)),preGenerateHttp:stats(rows.map(r=>r.requestPaths.indexOf('/v1/ai/generate'))),httpTotal:stats(rows.map(r=>r.requestPaths.length)),routePattern:rows[0].requestPaths.map(p=>p.replace(/[0-9a-f-]{36}/g,':requestId')),stagesMs:{editorBinding:metric('editor_bound'),localPrecheck:metric('precheck'),preferencesAndContext:metric('background_prepare'),historyContext:metric('history_context'),ownerIdentity:metric('owner_check'),recoveryQueries:stats(rows.map(r=>r.apiTimings.filter(x=>x.path.startsWith('/v1/ai/requests/')&&!x.path.endsWith('/delivered')).reduce((s,x)=>s+x.durationMs,0))),syntheticD1Reservation:stats(rows.map(r=>r.marks.reserved-r.marks.reserve_start)),modelOnly:stats(rows.map(r=>r.marks.model_end-r.marks.model_start)),generateHttpIncludingModel:metric('cloud_generate'),ackHttp:metric('ack'),afterAckToEditor:stats(rows.map(r=>r.marks.verified-r.marks.ack_end))}};
}
summary.identicalPromptHashes=runs.baseline.every((r,i)=>JSON.stringify(r.promptHashes)===JSON.stringify(runs.candidate[i].promptHashes));
summary.phaseWarning='modelOnly is contained in generateHttpIncludingModel; phases overlap (parallel local reads). Do not add all columns. Total is measured directly.';
if(!summary.identicalPromptHashes||summary.versions.candidate.successRate!==1||summary.versions.candidate.recoveryGets.mean!==0)throw Error('Benchmark failed safety/fast-path gates');
const output=option('--out','/private/tmp/pr16-fast-path-benchmark.json');writeFileSync(output,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
