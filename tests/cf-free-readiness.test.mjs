import test from 'node:test';
import assert from 'node:assert/strict';
import {LIMITS,completeUtcDay,analyticsQuery,evaluateDay,loadDay,markdownReport,parseArgs} from '../scripts/cf-free-readiness.mjs';

const prod='reply-copilot-api-production';
const db='d9df7d23-9b9c-44ac-a33a-c24474c15691';
const version='b10bdc5b-c9db-4d93-b0c8-b11e120376fb';
const makeWorker=(name,requests,cpu=4000,errors=0)=>({
 dimensions:{scriptName:name,scriptVersion:version,date:'2026-11-16',eventType:'fetch',status:'success',httpResponseStatus:200},
 sum:{requests,errors},max:{cpuTime:cpu},quantiles:{cpuTimeP50:1000,cpuTimeP95:3000,cpuTimeP99:cpu}
});
const makeDb=(databaseId,read,write)=>({dimensions:{databaseId,date:'2026-11-16'},sum:{rowsRead:read,rowsWritten:write,readQueries:22,writeQueries:3}});
const opts={day:'2026-11-16',script:prod,database:db,expectedVersion:version};

test('strict UTC complete-day selection rejects current partial days',()=>{
 assert.equal(completeUtcDay(1,Date.UTC(2026,10,17,18)),'2026-11-16');
 assert.equal(completeUtcDay(3,Date.UTC(2026,10,17,18)),'2026-11-14');
 assert.throws(()=>completeUtcDay(0),/partial UTC/);
 assert.throws(()=>completeUtcDay(15),/partial UTC/);
});

test('aggregates account-wide D1 and Workers rather than only Production',()=>{
 const raw={workers:[makeWorker(prod,1100,6000),makeWorker('reply-copilot-api-staging',150,7000)],
   d1:[makeDb(db,200_000,500),makeDb('another-db',300_000,100)]};
 const result=evaluateDay(raw,opts);
 assert.equal(result.metrics.account.requests,1250);
 assert.equal(result.metrics.production.requests,1100);
 assert.equal(result.metrics.account.d1RowsRead,500_000);
 assert.equal(result.metrics.production.d1RowsRead,200_000);
 assert.equal(result.metrics.account.d1RowsWritten,600);
 assert.equal(result.verdict,'REVIEW_REQUIRED');
 assert.equal(result.certifiedForFree,false);
 assert.ok(result.metrics.production.versions.includes(version));
});

test('10ms Free CPU is per-invocation: low P95 never excuses CPU maximum >10ms',()=>{
 const raw={workers:[makeWorker(prod,20,16_500)],d1:[makeDb(db,2000,100)]};
 const result=evaluateDay(raw,opts);
 assert.equal(result.verdict,'NO_GO');
 assert.match(result.causes.join(';'),/10ms CPU/);
 assert.equal(result.metrics.production.maxCpuMs,16.5);
});

test('Cron CPU is not falsely classified as an HTTP request over the 10ms budget',()=>{
 const cron={...makeWorker(prod,1,50_000),dimensions:{...makeWorker(prod,1,50_000).dimensions,eventType:'cron'}};
 const raw={workers:[makeWorker(prod,20,4000),cron],d1:[makeDb(db,300,2)]};
 const result=evaluateDay(raw,opts);
 assert.equal(result.metrics.account.requests,21,'keep conservative total across all events');
 assert.equal(result.metrics.production.requests,20,'fetch request count excludes Cron');
 assert.equal(result.metrics.production.maxCpuMs,4);
 assert.equal(result.verdict,'REVIEW_REQUIRED');
});

test('all-D1-read 5M, write 100k, all-Worker requests 100k and errors each block',()=>{
 const base={workers:[makeWorker(prod,100_000,5000,1)],d1:[makeDb(db,5_000_000,100_000)]};
 const result=evaluateDay(base,opts);
 assert.equal(result.verdict,'NO_GO');
 assert.equal(result.causes.length,4);
 assert.match(result.causes.join('|'),/5,000,000/);
 assert.match(result.causes.join('|'),/100,000/);
});

test('analytics no traffic, truncation, wrong version, and partial postrelease day never certify',()=>{
 let raw={workers:[],d1:[makeDb(db,100,2)]};
 let result=evaluateDay(raw,opts);
 assert.equal(result.verdict,'INSUFFICIENT');
 assert.ok(result.uncertainties.some(x=>/insufficient/.test(x)));
 raw={workers:[makeWorker(prod,22,2000)],d1:[makeDb(db,100,2)]};
 result=evaluateDay(raw,{...opts,expectedVersion:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',releaseAt:'2026-11-16T05:00:00Z'});
 assert.equal(result.verdict,'INSUFFICIENT');
 assert.ok(result.uncertainties.some(x=>/expected Worker version/.test(x)));
 assert.ok(result.uncertainties.some(x=>/complete UTC day after target release/.test(x)));
 const older=evaluateDay(raw,{...opts,releaseAt:'2026-11-15T23:00:00Z'});
 assert.equal(older.verdict,'REVIEW_REQUIRED');
});

test('safe GraphQL query uses validated account/date; only aggregate fields',()=>{
 const q=analyticsQuery('f'.repeat(32),'2026-11-16');
 assert.match(q,/workersInvocationsAdaptive/);
 assert.match(q,/d1AnalyticsAdaptiveGroups/);
 assert.match(q,/scriptName scriptVersion/);
 assert.match(q,/httpResponseStatus/);
 assert.match(q,/rowsRead rowsWritten/);
 assert.doesNotMatch(q,/password_hash|SELECT |users |queryText|email/);
 assert.throws(()=>analyticsQuery('bad','2026-11-16'),/account ID/);
 assert.throws(()=>analyticsQuery('f'.repeat(32),'tomorrow'),/UTC day/);
});

test('read-only Cloudflare fetch uses POST GraphQL without mutation or sensitive data output',async()=>{
 const calls=[];
 const raw={workers:[makeWorker(prod,3,3000)],d1:[makeDb(db,24,1)]};
 const result=await loadDay({accountId:'b'.repeat(32),token:'test-token-SECRET',day:'2026-11-16',fetchImpl:async(url,opts)=>{
  calls.push({url,opts});
  return {ok:true,json:async()=>({data:{viewer:{accounts:[raw]}}})};
 }});
 assert.equal(calls.length,1);
 assert.equal(calls[0].opts.method,'POST');
 assert.equal(calls[0].url,'https://api.cloudflare.com/client/v4/graphql');
 assert.ok(calls[0].opts.headers.Authorization.includes('test-token-SECRET'));
 assert.deepEqual(result,raw);
 const report=markdownReport([evaluateDay(raw,opts)]);
 assert.ok(!report.includes('test-token-SECRET'));
 assert.match(report,/DO NOT switch to Free automatically/);
});

test('CLI input limits and invalid release timestamp fail closed',()=>{
 assert.equal(parseArgs(['--days','1','--script',prod]).days,1);
 assert.throws(()=>parseArgs(['--days','0']),/Choose 1-7/);
 assert.throws(()=>parseArgs(['--days','8']),/Choose 1-7/);
 assert.throws(()=>parseArgs(['--release-at','not-a-date']),/release timestamp/);
 assert.throws(()=>parseArgs(['--unexpected','x']),/Unsupported/);
});

test('incomplete Cloudflare response fails rather than reporting false Free clearance',()=>{
 assert.throws(()=>evaluateDay({workers:null,d1:[]},opts),/Missing/);
 assert.throws(()=>evaluateDay({workers:[makeWorker(prod,2,1200)],d1:[{sum:{rowsWritten:1}}]},opts),/Invalid aggregate/);
});

test('HTTP status CPU diagnostics isolate the pinned version and do not infer route identity',()=>{
 const ok=makeWorker(prod,120,24_000);
 ok.quantiles={cpuTimeP50:4500,cpuTimeP95:16_000,cpuTimeP99:21_000};
 const notFound={...makeWorker(prod,40,2100),
  dimensions:{...makeWorker(prod,40,2100).dimensions,httpResponseStatus:404}};
 notFound.quantiles={cpuTimeP50:350,cpuTimeP95:1200,cpuTimeP99:2000};
 const old={...makeWorker(prod,700,51_000),
  dimensions:{...makeWorker(prod,700,51_000).dimensions,scriptVersion:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}};
 const raw={workers:[ok,notFound,old],d1:[makeDb(db,5000,2)]};
 const result=evaluateDay(raw,opts);
 assert.equal(result.verdict,'NO_GO','account-wide CPU retains conservative old-version block');
 assert.equal(result.metrics.production.cpuByHttpStatus.length,2);
 assert.deepEqual(result.metrics.production.cpuByHttpStatus[0],{
  httpStatus:'200',requests:120,maxCpuMs:24,maxSegmentP95Ms:16,maxSegmentP99Ms:21
 });
 assert.equal(result.metrics.production.cpuByHttpStatus[1].httpStatus,'404');
 assert.equal(result.metrics.production.cpuByHttpStatus[1].maxCpuMs,2.1);
 const markdown=markdownReport([result]);
 assert.match(markdown,/Production HTTP status CPU diagnostic/);
 assert.match(markdown,/Not route-level evidence/);
 assert.match(markdown,/\| 200 \| 120 \| 24\.000ms/);
 assert.doesNotMatch(markdown,/request URL|user email|password_hash|test-token-SECRET/);
});
