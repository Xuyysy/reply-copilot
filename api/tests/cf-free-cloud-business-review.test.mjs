import test from 'node:test';
import assert from 'node:assert/strict';
import {POLICY,reviewCloudBusiness} from '../scripts/lib/cf-free-cloud-business-review.mjs';
const SHA='a'.repeat(40),VERSION='11111111-2222-3333-4444-555555555555',NS='a'.repeat(32),DIGEST='b'.repeat(64);
const opts={expectedSha:SHA,expectedVersion:VERSION,reportSha256:DIGEST,independentCleanup:{source:'CLOUDFLARE_CONTROL_PLANE',workers:0,d1:0,do:0},independentDo:{source:'CLOUDFLARE_DO_ANALYTICS',namespaceId:NS,requests:100,durationGBSeconds:10,cpuP95Ms:200,rowsRead:0,rowsWritten:0,storedBytes:0,executionErrors:0}};
function sample(){
 const cases=[],tail=[];let n=0;
 for(const [scenario,count] of Object.entries(POLICY))for(let i=0;i<count;i++){
  const status=scenario.endsWith('-wrong')?401:scenario.startsWith('invalid-model-output-')?503:scenario==='payment-create-synthetic'?201:200,id='case-'+(++n);
  cases.push({id,scenario,status,expected:status,ok:true});tail.push({id,cpuMs:3,outcome:'ok'});
 }
 return {sourceCommit:SHA,cloudVersion:VERSION,namespaceId:NS,apiBundleSha256:DIGEST,verifierBundleSha256:DIGEST,wasmSha256:DIGEST,scope:'ISOLATED_CLOUD_SYNTHETIC',behaviorPassed:true,freeCertified:false,outboundPolicy:'BUILD_TIME_INJECTED_DENY_BY_DEFAULT',cases,tail,cronCleanupVerified:true,cron:Array.from({length:10},(_,i)=>({scheduledTime:1700000000000+i*60000,cpuMs:3,outcome:'ok'}))};
}
test('complete route matrix never authorizes production or free migration',()=>{
 const r=reviewCloudBusiness(sample(),opts);
 assert.equal(r.totalCases,571);assert.equal(r.uniqueSampledCases,571);assert.equal(r.decision,'NO_GO');assert.equal(r.deploymentAuthorized,false);
 assert.ok(r.blockers.every(x=>/REQUIRED$/.test(x)));assert.equal(r.cronCpu.samples,10);
});
test('raw evidence rejects missing, duplicate, spoofed and oversize CPU samples',()=>{
 const checks=[
  [r=>r.tail.pop(),'MISSING_TAIL:cleanup-http-not-cron'],
  [r=>r.tail.push(r.tail[0]),'DUPLICATE_TAIL:login-10000-correct'],
  [r=>r.tail[0].cpuMs=13,'ROUTE_FREE_CPU_THRESHOLD:login-10000-correct'],
  [r=>r.tail[0].cpuMs=null,'INVALID_TAIL:login-10000-correct'],
  [r=>r.cases[0].status=401,'UNEXPECTED_HTTP_RESULT:login-10000-correct'],
  [r=>r.cases.push(r.cases[0]),'DUPLICATE_OR_INVALID_CASE'],
  [r=>r.tail.push({id:'case-9999',cpuMs:1,outcome:'ok'}),'ORPHAN_TAIL_SAMPLE'],
  [r=>r.cron.push(r.cron[0]),'INVALID_OR_DUPLICATE_REAL_CRON_SAMPLE'],
  [r=>r.cron.pop(),'REAL_CRON_COVERAGE_INCOMPLETE'],
  [r=>r.cloudVersion='wrong','REPORT_IDENTITY_UNVERIFIED']
 ];
 for(const [mutate,expected] of checks){const input=sample();mutate(input);assert.ok(reviewCloudBusiness(input,opts).blockers.includes(expected),expected);}
});
test('absent or unrelated DO and cleanup evidence cannot be inferred from a green workflow',()=>{
 const r=reviewCloudBusiness(sample(),{...opts,independentCleanup:{},independentDo:{...opts.independentDo,namespaceId:VERSION}});
 assert.ok(r.blockers.includes('INDEPENDENT_CLEANUP_UNVERIFIED'));assert.ok(r.blockers.includes('INDEPENDENT_DO_EVIDENCE_INCOMPLETE'));
});
test('a runner supplied route summary cannot hide a raw over-budget invocation',()=>{
 const input=sample();input.routeCpu=[{scenario:'login-10000-correct',maxCpuMs:0}];input.tail[0].cpuMs=11;
 assert.ok(reviewCloudBusiness(input,opts).blockers.includes('ROUTE_FREE_CPU_THRESHOLD:login-10000-correct'));
});
