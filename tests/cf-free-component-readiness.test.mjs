import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateComponentReadiness,parseArgs,FREE_LIMITS} from '../scripts/cf-free-component-readiness.mjs';
import {evaluateDay} from '../scripts/cf-free-readiness.mjs';

const VERSION='ad1095da-90cd-4d93-ba22-ce760cdf5967';
const DAY='2026-11-19', NOW=Date.UTC(2026,10,20,13);
const worker=(cpu,requests=250,errors=0)=>({
  dimensions:{scriptName:'reply-copilot-api-production',scriptVersion:VERSION,date:DAY,eventType:'fetch',status:'success'},
  sum:{requests,errors},max:{cpuTime:cpu},quantiles:{cpuTimeP50:1000,cpuTimeP95:1500,cpuTimeP99:cpu}
});
const db=(rowsRead=200,rowsWritten=4)=>({
  dimensions:{databaseId:'d9df7d23-9b9c-44ac-a33a-c24474c15691',date:DAY},
  sum:{rowsRead,rowsWritten,readQueries:4,writeQueries:1}
});
const analytics=(cpu=9000,requests=250,errs=0)=>({
  results:[evaluateDay({workers:[worker(cpu,requests,errs)],d1:[db()]},
    {day:DAY,expectedVersion:VERSION})]
});
const localProof=()=>{
  const entry=factor=>({factor,
    wall:{metric:'node_dispatch_roundtrip_wall_ms',samples:3,p50Ms:20,p95Ms:24,maxMs:25},
    httpCpu:{status:'SAMPLED',sampleCount:4,topFunctions:[{name:'deriveBits',samples:3}]}});
  const doEntry=factor=>({factor,
    httpCpu:{status:'SAMPLED',sampleCount:3,topFunctions:[{name:'fetch',samples:1}]},
    verifierCpu:{status:'SAMPLED',sampleCount:20,topFunctions:[{name:'deriveBits',samples:18}]}});
  return {status:'SYNTHETIC_LOCAL_ONLY',freeCertified:false,productionCertified:false,
    comparisons:[{mode:'http_local',cases:[10000,100000,210000].map(entry),
      wrongPasswordDenied:true,storedFactorUnchanged:true,externalCalls:0},
      {mode:'do_rpc',cases:[10000,100000,210000].map(doEntry),
      wrongPasswordDenied:true,storedFactorUnchanged:true,externalCalls:0}]};
};
const usage={cloudflareReadOnlyAggregate:true,day:DAY,rpcRequests:300,durationGbSeconds:50,sqliteStoredBytes:0};
const evalGate=(data)=>evaluateComponentReadiness(data,NOW);
test('default gate is NO_GO with missing independent account, DO, route and rollback evidence',()=>{
 const r=evalGate();
 assert.equal(r.decision,'NO_GO');
 assert.equal(r.safeToDowngrade,false);
 assert.equal(r.verifiedCloudFree,false);
 assert.equal(r.evidence.account.status,'MISSING');
 assert.equal(r.evidence.password.status,'MISSING');
 assert.equal(r.evidence.durableObjects.status,'MISSING');
 assert.ok(r.uncertainties.includes('HTTP_ROUTE_LEVEL_CPU_NOT_VERIFIED_ON_FREE'));
 assert.ok(r.uncertainties.includes('DO_REAL_INVOCATION_CPU_NOT_VERIFIED_ON_FREE'));
});

test('real historical account max CPU >=10ms blocks even when P95 is below limit',()=>{
 const r=evalGate({analytics:analytics(18689),passwordProof:localProof(),
   doUsage:usage,expectedVersion:VERSION});
 assert.ok(r.blockers.includes('HTTP_CPU_OVER_10MS_OBSERVED'));
 assert.ok(r.blockers.includes('EXISTING_ACCOUNT_READINESS_NO_GO'));
 assert.equal(r.evidence.password.status,'LAB_ONLY_OFFLOAD_OBSERVED');
 assert.equal(r.decision,'NO_GO');
});

test('all-green synthetic DO V8 proof and good account aggregates still cannot certify cloud Free',()=>{
 const r=evalGate({analytics:analytics(),passwordProof:localProof(),
   doUsage:usage,expectedVersion:VERSION});
 assert.equal(r.evidence.account.status,'READ_ONLY_AGGREGATES');
 assert.equal(r.evidence.password.status,'LAB_ONLY_OFFLOAD_OBSERVED');
 assert.equal(r.evidence.durableObjects.status,'UNVERIFIED_EXTERNAL_AGGREGATES');
 assert.equal(r.safeToDowngrade,false);
 assert.equal(r.decision,'NO_GO');
 assert.ok(r.uncertainties.includes('DO_CPU_LIMIT_PLAN_APPLICABILITY_NEEDS_CONFIRMATION'));
 assert.ok(r.uncertainties.includes('PRODUCTION_ROLLBACK_NOT_APPROVED'));
});

test('observed per-account quota boundaries block at limits, even if CPU appears low',()=>{
 const r=evalGate({analytics:analytics(9000,100000),passwordProof:localProof(),expectedVersion:VERSION,
   doUsage:{...usage,rpcRequests:100000,durationGbSeconds:13000,sqliteStoredBytes:5000000000}});
 for(const code of ['WORKER_DAILY_REQUEST_QUOTA','DO_RPC_DAILY_QUOTA','DO_DURATION_DAILY_QUOTA','DO_STORAGE_QUOTA'])
   assert.ok(r.blockers.includes(code),code);
 assert.equal(r.safeToDowngrade,false);
});

test('malformed, stale and wrong-version analytics fail closed instead of turning zeros into success',()=>{
 const stale=analytics(3000);
 stale.results[0].day='2026-11-20';
 let r=evalGate({analytics:stale,expectedVersion:VERSION});
 assert.equal(r.evidence.account.status,'INVALID');
 assert.ok(r.uncertainties.includes('ACCOUNT_ANALYTICS_INVALID'));
 r=evalGate({analytics:analytics(),expectedVersion:'ffffffff-ffff-ffff-ffff-ffffffffffff'});
 assert.ok(r.uncertainties.includes('EXPECTED_VERSION_NOT_OBSERVED'));
 const invalid=analytics();invalid.results[0].metrics.account.maxCpuMs=null;
 r=evalGate({analytics:invalid,expectedVersion:VERSION});
 assert.equal(r.evidence.account.status,'INVALID');
});

test('profiles without active DO deriveBits samples never get marked as locally supported',()=>{
 let proof=localProof();
 proof.comparisons[1].cases[1].verifierCpu.topFunctions=[{name:'(idle)',samples:15}];
 const r=evalGate({passwordProof:proof});
 assert.equal(r.evidence.password.status,'INCOMPLETE');
 assert.ok(r.uncertainties.includes('ISOLATED_PASSWORD_DO_PROOF_INCOMPLETE'));
 proof=localProof();proof.comparisons[1].externalCalls=1;
 assert.equal(evalGate({passwordProof:proof}).evidence.password.status,'INCOMPLETE');
});

test('arbitrary payloads are never reproduced in sanitized report, and no GO is possible',()=>{
 const r=evalGate({analytics:{results:'secret-session-token'},passwordProof:{apiKey:'secret'},
   doUsage:{...usage,rpcRequests:'100'}});
 const output=JSON.stringify(r);
 assert.equal(output.includes('secret-session-token'),false);
 assert.equal(output.includes('apiKey'),false);
 assert.equal(r.decision,'NO_GO');
 assert.equal(r.evidence.durableObjects.status,'INVALID');
 assert.equal(r.automaticPlanChangeAuthorized,false);
});

test('CLI rejects invalid input, duplicates and out-of-scope options',()=>{
 assert.deepEqual(parseArgs([]),{analytics:null,passwordProof:null,doUsage:null,expectedVersion:null});
 assert.equal(parseArgs(['--expected-version',VERSION]).expectedVersion,VERSION);
 assert.throws(()=>parseArgs(['--unexpected','x']));
 assert.throws(()=>parseArgs(['--expected-version','fake']));
 assert.throws(()=>parseArgs(['--analytics','a','--analytics','b']));
});

test('Free limit constants separate HTTP 10ms and documented DO default 30s, without assuming local enforcement',()=>{
 assert.equal(FREE_LIMITS.httpCpuMs,10);
 assert.equal(FREE_LIMITS.doDefaultCpuMsDocumented,30000);
 assert.equal(FREE_LIMITS.workerRequestsPerUtcDay,100000);
 assert.equal(FREE_LIMITS.doRpcRequestsPerUtcDay,100000);
});
