import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOptions, migrationStatements, summarizeWallMs, summarizeV8Profile, ROUTES} from '../scripts/lib/workerd-cpu-evidence.mjs';
import {runWorkerdCpuExperiment} from '../scripts/cf-free-workerd-cpu.mjs';

test('local CPU runner strictly bounds synthetic load and disallows unknown args',()=>{
  assert.deepEqual(parseOptions([]),{samples:3,warmup:1,profile:false});
  assert.deepEqual(parseOptions(['--samples','2','--warmup','0','--profile']),{samples:2,warmup:0,profile:true});
  for(const args of [['--samples','5'],['--samples','0'],['--warmup','2'],['--other','1'],['--samples','oops'],['--samples']])
    assert.throws(()=>parseOptions(args));
});

test('local migration parser preserves interior trigger semicolons',()=>{
  const text="-- synthetic only\nCREATE TABLE a (x INTEGER);\nCREATE TRIGGER check_a AFTER INSERT ON a BEGIN UPDATE a SET x=1; SELECT 1; END;\nINSERT INTO a(x) VALUES(2);";
  const statements=migrationStatements(text);
  assert.equal(statements.length,3);
  assert.match(statements[1],/UPDATE a SET x=1; SELECT 1; END/);
  assert.match(statements[2],/INSERT INTO a/);
});

test('wall time cannot be passed off as CPU, and profile data redacts paths',()=>{
  const summary=summarizeWallMs([9,1,4,2]);
  assert.equal(summary.metric,'node_dispatch_roundtrip_wall_ms');
  assert.equal(summary.p50Ms,2);
  assert.equal(summary.p95Ms,9);
  assert.throws(()=>summarizeWallMs([]));
  assert.throws(()=>summarizeWallMs([-1]));
  const profile=summarizeV8Profile({nodes:[
    {id:1,callFrame:{functionName:'passwordLogin'}},
    {id:2,callFrame:{functionName:'/v1/orders/sensitive-id'}},
    {id:3,callFrame:{functionName:'(idle)'}}
  ],samples:[1,1,2,3]});
  assert.equal(profile.status,'SAMPLED');
  assert.equal(profile.sampleCount,4);
  assert.equal(profile.topFunctions[0].name,'passwordLogin');
  assert.equal(profile.topFunctions.some(item=>item.name.includes('sensitive')),false);
  assert.equal(summarizeV8Profile({nodes:[],samples:[]}).status,'INSUFFICIENT');
  assert.equal(summarizeV8Profile(null).status,'INSUFFICIENT');
});

test('full business routes run in isolated workerd with local D1, mock AI and exact ACK accounting',{timeout:120000},async()=>{
  const report=await runWorkerdCpuExperiment({samples:1,warmup:0,profile:false});
  assert.equal(report.status,'SYNTHETIC_LOCAL_ONLY');
  assert.equal(report.runtime,'Miniflare/workerd');
  assert.equal(report.freeCertified,false);
  assert.equal(report.productionHotspotsConfirmed,false);
  assert.deepEqual(report.cases.map(row=>row.category),ROUTES);
  assert.deepEqual(report.assertions,{realNetworkCalls:0,creditDebits:1,endingFreeCredits:199,endingReservedCredits:0});
  for(const row of report.cases){
    assert.equal(row.wall.metric,'node_dispatch_roundtrip_wall_ms');
    assert.equal(row.wall.samples,1);
    assert.ok(row.wall.p95Ms>=0);
    assert.equal(row.cpuProfile.status,'NOT_REQUESTED');
  }
  const serialized=JSON.stringify(report);
  assert.ok(!serialized.includes('benchmark-main-user'));
  assert.ok(!serialized.includes('isolated-benchmark-pepper'));
  assert.ok(!serialized.includes('rc_session='));
  assert.ok(!serialized.includes('/v1/ai/requests/'));
});

test('opt-in V8 inspector produces real isolated workerd samples for each route',{timeout:120000},async()=>{
  const report=await runWorkerdCpuExperiment({samples:3,warmup:1,profile:true});
  assert.equal(report.freeCertified,false);
  assert.equal(report.productionHotspotsConfirmed,false);
  assert.equal(report.assertions.realNetworkCalls,0);
  assert.deepEqual(report.cases.map(row=>row.category),ROUTES);
  assert.equal(report.assertions.creditDebits,4);
  const withSamples=report.cases.filter(row=>row.cpuProfile.status==='SAMPLED');
  // Fail rather than claiming a valid CPU ranking when the inspector only
  // returns empty or unrelated profiles.
  assert.ok(withSamples.length>0,'No V8 samples captured; inspector connection/target must be corrected');
  const summary=report.cases.map(row=>({
    category:row.category,
    wallP50Ms:row.wall.p50Ms,
    wallP95Ms:row.wall.p95Ms,
    sampleCount:row.cpuProfile.sampleCount||0,
    cpuProfileStatus:row.cpuProfile.status,
    topFunctions:row.cpuProfile.topFunctions||[]
  }));
  const output=JSON.stringify({event:'isolated_workerd_v8_cpu_evidence',freeCertified:false,cases:summary});
  assert.ok(!output.includes('rc_session='));
  assert.ok(!output.includes('benchmark-main-user'));
  assert.ok(!output.includes('isolated-benchmark-pepper'));
  console.log(output);
});
