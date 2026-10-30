import path from 'node:path';
import {writeFileSync} from 'node:fs';
import {generationFixture} from './lib/generation-performance-fixture.mjs';
import '../utils/generation-performance.js';
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
const before=option('--before'),output=option('--output');
if(!args.includes('--before')||!args.includes('--output'))throw Error('Use --before <archived baseline source> --output <json>');
const samples=Number(args.includes('--samples')?option('--samples'):24);
if(!Number.isSafeInteger(samples)||samples<4||samples>100)throw Error('samples must be 4–100');
const scenarios=['chinese-short','chinese-long','english-short','english-long'];
const summary=rows=>({samples:rows.length,successes:rows.filter(r=>r.elapsedMs!==null).length,failures:rows.filter(r=>r.elapsedMs===null).length,endToEndMs:ReplyCopilotPerformance.summarize(rows.map(r=>r.elapsedMs)),stages:Object.fromEntries(['background_return','candidates','insert','verified','ack_end','stored'].map(stage=>[stage,ReplyCopilotPerformance.summarize(rows.map(r=>r.marks[stage]))]))});
const runs={before:[],after:[]};
// Alternate baseline/candidate to reduce monotonic machine-load bias.
for(let i=0;i<samples;i++)for(const phase of i%2?['after','before']:['before','after'])runs[phase].push(await generationFixture({sourceRoot:phase==='before'?path.resolve(before):process.cwd(),scenario:scenarios[i%4]}));
for(let i=0;i<samples;i++)if(JSON.stringify(runs.before[i].promptHashes)!==JSON.stringify(runs.after[i].promptHashes))throw Error('Prompt/model payload changed');
const report={kind:'LOCAL_MOCK_NOT_REAL_X_OR_PRODUCTION',fixture:'Actual content/background/hosted/provider code; synthetic editor, D1 and model. No external requests. Model 35ms, A 9ms, AAAA 13ms, ACK 12ms plus API transport 6ms, local reads 4ms/writes 6ms; unchanged 80ms paste check.',baseline:'98155453560209f3c77de069c34735fccb444a65',before:summary(runs.before),after:summary(runs.after),identicalPromptAndModelPayloads:true,phaseDurations:Object.fromEntries(['before','after'].map(phase=>[phase,Object.fromEntries([['dns','dns_start','dns_end'],['upstream','model_start','model_end'],['ack','ack_start','ack_end'],['result_to_editor','stored','verified']].map(([name,a,b])=>[name,ReplyCopilotPerformance.summarize(runs[phase].map(row=>row.marks[b]-row.marks[a]))]))])),afterDiagnostics:runs.after[0].report};
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
