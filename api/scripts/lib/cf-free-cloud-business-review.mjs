// Offline review of actual isolated-run artifacts. Never trusts precomputed routeCpu
// or converts missing/duplicated samples into pass evidence. No network or deploy.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const isNum=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const sha=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x);
const digest=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
export const POLICY=Object.freeze(Object.fromEntries([
 ...[10000,60000,100000,210000].flatMap(n=>[[`login-${n}-correct`,10],[`login-${n}-wrong`,10]]),
 ...['register','verify-registration','reset-request','reset-password','admin-reauth','admin-password-change','me','usage','entitlements','bootstrap','admin-read','payment-create-synthetic','payment-webhook-synthetic','payment-replay-synthetic'].map(s=>[s,10]),
 ...['legacy','managed'].flatMap(provider=>['free','paid','subscription'].flatMap(funding=>['generate','replay','ack','ack-replay','invalid-model-output'].map(action=>[`${action}-${funding}-${provider}`,funding==='free'?15:10]))),
 ['cleanup-http-not-cron',1],
]));
const expectedStatus=name=>name.endsWith('-wrong')?401:name.startsWith('invalid-model-output-')?503:name==='payment-create-synthetic'?201:200;
const stats=values=>{const sorted=values.slice().sort((a,b)=>a-b);return {samples:sorted.length,p95CpuMs:sorted[Math.ceil(sorted.length*.95)-1]??null,maxCpuMs:sorted.at(-1)??null};};
export function reviewCloudBusiness(report,{expectedSha,expectedVersion,reportSha256,independentCleanup,independentDo}={}){
 const blockers=new Set(), routes=[], seen=new Map(), tails=new Map(), groups=new Map();
 const fail=x=>blockers.add(x);
 if(!sha(expectedSha)||report?.sourceCommit!==expectedSha||!uuid(expectedVersion)||report?.cloudVersion!==expectedVersion||!digest(reportSha256))fail('REPORT_IDENTITY_UNVERIFIED');
 if(report?.scope!=='ISOLATED_CLOUD_SYNTHETIC'||report.behaviorPassed!==true||report.outboundPolicy!=='BUILD_TIME_INJECTED_DENY_BY_DEFAULT'||report.freeCertified!==false||!digest(report.apiBundleSha256)||!digest(report.verifierBundleSha256)||!digest(report.wasmSha256))fail('ISOLATED_REPORT_INVALID');
 for(const c of Array.isArray(report?.cases)?report.cases:[]){
  if(!c||!/^case-[1-9]\d{0,3}$/.test(c.id)||seen.has(c.id)){fail('DUPLICATE_OR_INVALID_CASE');continue;}
  seen.set(c.id,c);
  if(!Object.hasOwn(POLICY,c.scenario)){fail('UNEXPECTED_ROUTE:'+String(c.scenario));continue;}
  if(c.status!==expectedStatus(c.scenario)||c.expected!==expectedStatus(c.scenario)||c.ok!==true)fail('UNEXPECTED_HTTP_RESULT:'+c.scenario);
  const group=groups.get(c.scenario)||[];group.push(c.id);groups.set(c.scenario,group);
 }
 for(const t of Array.isArray(report?.tail)?report.tail:[]){
  if(!t||!seen.has(t.id)){fail('ORPHAN_TAIL_SAMPLE');continue;}
  const bucket=tails.get(t.id)||[];bucket.push(t);tails.set(t.id,bucket);
 }
 for(const [scenario,min] of Object.entries(POLICY)){
  const ids=groups.get(scenario)||[],values=[];
  for(const id of ids){
   const matches=tails.get(id)||[];
   if(matches.length!==1){fail((matches.length?'DUPLICATE_TAIL:':'MISSING_TAIL:')+scenario);continue;}
   const t=matches[0];
   if(t.outcome!=='ok'||!isNum(t.cpuMs)){fail('INVALID_TAIL:'+scenario);continue;}
   values.push(t.cpuMs);
  }
  const s=stats(values);routes.push({scenario,cases:ids.length,...s});
  if(ids.length<min||s.samples!==ids.length)fail('ROUTE_COVERAGE_INCOMPLETE:'+scenario);
  if(s.maxCpuMs!==null&&(s.maxCpuMs>8||s.p95CpuMs>5))fail('ROUTE_ENGINEERING_MARGIN_EXCEEDED:'+scenario);
  if(s.maxCpuMs!==null&&s.maxCpuMs>=10)fail('ROUTE_FREE_CPU_THRESHOLD:'+scenario);
 }
 const cronTimes=new Set(),cronValues=[];
 for(const c of Array.isArray(report?.cron)?report.cron:[]){
  if(!Number.isSafeInteger(c?.scheduledTime)||c.scheduledTime<=0||cronTimes.has(c.scheduledTime)||c.outcome!=='ok'||!isNum(c.cpuMs)){fail('INVALID_OR_DUPLICATE_REAL_CRON_SAMPLE');continue;}
  cronTimes.add(c.scheduledTime);cronValues.push(c.cpuMs);
 }
 const cron=stats(cronValues);
 if(report?.cronCleanupVerified!==true||cron.samples<10)fail('REAL_CRON_COVERAGE_INCOMPLETE');
 if(cron.maxCpuMs!==null&&(cron.maxCpuMs>8||cron.p95CpuMs>5))fail('CRON_ENGINEERING_MARGIN_EXCEEDED');
 if(cron.maxCpuMs!==null&&cron.maxCpuMs>=10)fail('CRON_FREE_CPU_THRESHOLD');
 if(independentCleanup?.source!=='CLOUDFLARE_CONTROL_PLANE'||independentCleanup?.workers!==0||independentCleanup?.d1!==0||independentCleanup?.do!==0)fail('INDEPENDENT_CLEANUP_UNVERIFIED');
 // DO metrics must be explicitly measured and attributed to this experiment.
 // Empty groups, Worker wall duration and an estimated cost are not evidence.
 const d=independentDo;
 if(d?.source!=='CLOUDFLARE_DO_ANALYTICS'||!uuid(report?.namespaceId)||d.namespaceId!==report.namespaceId||!Number.isSafeInteger(d.requests)||d.requests<=0||!isNum(d.durationGBSeconds)||!isNum(d.cpuP95Ms)||!isNum(d.rowsRead)||!isNum(d.rowsWritten)||!isNum(d.storedBytes)||d.executionErrors!==0)fail('INDEPENDENT_DO_EVIDENCE_INCOMPLETE');
 else if(d.requests>=100000||d.durationGBSeconds>=13000||d.rowsRead>=5000000||d.rowsWritten>=100000||d.storedBytes>5000000000||d.cpuP95Ms>=30000)fail('DO_RESOURCE_LIMIT_REACHED');
 // These require separate independently reviewed live-account evidence.
 for(const x of ['ACCOUNT_PLAN_ATTESTATION_REQUIRED','THREE_COMPLETE_POST_RELEASE_UTC_DAYS_REQUIRED','PAID_ROLLBACK_REHEARSAL_REQUIRED','PER_INVOCATION_D1_AND_SUBREQUEST_EVIDENCE_REQUIRED','EXPLICIT_RELEASE_AUTHORIZATION_REQUIRED'])fail(x);
 return {decision:'NO_GO',freeCertified:false,deploymentAuthorized:false,sourceCommit:report?.sourceCommit??null,reportSha256:reportSha256??null,totalCases:seen.size,uniqueSampledCases:[...tails].filter(([,v])=>v.length===1&&v[0].outcome==='ok'&&isNum(v[0].cpuMs)).length,routeCpu:routes,cronCpu:cron,blockers:[...blockers]};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [reportPath,expectedSha,expectedVersion,independentPath]=process.argv.slice(2);
 if(!reportPath||!expectedSha||!expectedVersion)throw Error('usage: node cf-free-cloud-business-review.mjs cloud.json EXPECTED_SHA EXPECTED_VERSION [independent-evidence.json]');
 const raw=readFileSync(reportPath),independent=independentPath?JSON.parse(readFileSync(independentPath,'utf8')):{};
 console.log(JSON.stringify(reviewCloudBusiness(JSON.parse(raw.toString('utf8')),{expectedSha,expectedVersion,reportSha256:createHash('sha256').update(raw).digest('hex'),independentCleanup:independent.cleanup,independentDo:independent.durableObjects}),null,2));
}
