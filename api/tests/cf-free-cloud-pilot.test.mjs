import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pbkdf2Sync} from 'node:crypto';
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
import {isAllowedCloudUrl,parseCloudArgs,probeCloudPilot,ROUNDS} from '../scripts/cf-free-cloud-pilot-probe.mjs';

const NAME='xrh-cf-free-cpu-pilot-20261120';
const PILOT_URL='https://'+NAME+'.x-reply-helper-isolated-workers-free-cpu-pilot.workers.dev/';
const PASSWORD='xrh-cf-free-synthetic-password-2026!';
const PEPPER='xrh-isolated-free-pilot-pepper-2026-synthetic-only';
const TOKEN='locally-generated-synthetic-pilot-token-2026-unique-000001';
const BINDINGS={
  PILOT_ENV:{type:'text',value:'dedicated-synthetic-free-account'},
  PASSWORD_PEPPER:{type:'text',value:PEPPER},
  PILOT_ACCESS_TOKEN:{type:'text',value:TOKEN},
  PASSWORD_VERIFY_DO:{type:'durable-object',worker:NAME,exportName:'PasswordVerifierDO'}
};
async function fixture(vars=BINDINGS){
  let external=0;
  const script=buildSync({
    entryPoints:[new URL('../prototypes/cf-free-cloud-pilot/src/index.ts',import.meta.url).pathname],
    bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',
    external:['cloudflare:workers']
  }).outputFiles[0].text;
  const mf=new Miniflare({workers:[{
    config:{name:NAME,compatibilityDate:'2026-10-14',env:vars,
      manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:script}}},
      exports:{PasswordVerifierDO:{type:'durable-object',storage:'sqlite'}}},
    dev:{outboundService:{type:'fetcher',handler:()=>{external++;throw Error('Offline only');}}}
  }]});
  try {
    const r=await mf.dispatchFetch(PILOT_URL+'__pilot',{method:'GET',headers:{Authorization:'Bearer '+TOKEN}});
    await r.text(); // Prove the isolated Worker is reachable before returning.
    return {mf,external:()=>external};
  }catch(error){await mf.dispose();throw error;}
}
function signed(){return {Authorization:'Bearer '+TOKEN};}
test('hardcoded synthetic password corpus matches exact project PBKDF2 hashing format',()=>{
  const code=readFileSync(new URL('../prototypes/cf-free-cloud-pilot/src/index.ts',import.meta.url),'utf8');
  for(const rounds of ROUNDS){
    const digest=pbkdf2Sync(PASSWORD+'\0'+PEPPER,Buffer.alloc(16,0x2a),rounds,32,'sha256').toString('hex');
    const stored='pbkdf2-sha256:'+rounds+':'+('2a'.repeat(16))+':'+digest;
    assert.ok(code.includes(stored),'Corpus drift for '+rounds);
  }
});
test('dedicated Worker config has no production route, D1, triggers or real secrets',()=>{
  const path=new URL('../prototypes/cf-free-cloud-pilot/wrangler.jsonc',import.meta.url);
  const config=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(config.name,NAME);
  assert.equal(config.workers_dev,true);
  assert.equal(config.main,'./src/index.ts');
  assert.equal(config.vars.PASSWORD_PEPPER,PEPPER);
  assert.equal(config.observability.enabled,false);
  assert.deepEqual(config.migrations[0].new_sqlite_classes,['PasswordVerifierDO']);
  for(const danger of ['routes','route','d1_databases','triggers','account_id','PAYMENTS_ENABLED',
    'DEEPSEEK_API_KEY','PASSWORD_VERIFY_DO_ENABLED','PILOT_ACCESS_TOKEN']){
    assert.equal(Object.hasOwn(config,danger),false,danger);
    assert.equal(Object.hasOwn(config.vars,danger),false,danger);
  }
});
test('cloud CLI refuses Production domain, arbitrary hosts, missing consent and weak tokens',()=>{
  assert.equal(isAllowedCloudUrl(PILOT_URL),true);
  for(const u of ['https://api.x-reply-helper.top/','http://'+NAME+'.x-reply-helper-isolated-workers-free-cpu-pilot.workers.dev/',
    'https://'+NAME+'.evil.workers.dev.attacker.test/',
    'https://'+NAME+'.x-reply-helper-isolated-workers-free-cpu-pilot.workers.dev/probe',
    'https://'+NAME+'.x-reply-helper-isolated-workers-free-cpu-pilot.workers.dev/?token=x',
    'https://example.workers.dev/', 'https://'+NAME+'.other-account.workers.dev/'])
    assert.equal(isAllowedCloudUrl(u),false,u);
  for(const args of [[],['--execute-cloud'],['--confirm-dedicated-free-account'],
    ['--execute-cloud','--confirm-dedicated-free-account','--url','https://api.x-reply-helper.top/'],
    ['--execute-cloud','--confirm-dedicated-free-account','--url',PILOT_URL,'--repeats','3']])
    assert.throws(()=>parseCloudArgs(args,{CF_FREE_PILOT_ACCESS_TOKEN:TOKEN}));
  assert.throws(()=>parseCloudArgs(['--execute-cloud','--confirm-dedicated-free-account','--url',PILOT_URL],{
    CF_FREE_PILOT_ACCESS_TOKEN:'not-long-enough'
  }));
  assert.equal(parseCloudArgs(['--execute-cloud','--confirm-dedicated-free-account','--url',PILOT_URL],{
    CF_FREE_PILOT_ACCESS_TOKEN:TOKEN
  }).repeats,1);
});

test('synthetic Worker+SQLite DO run in real local workerd, with private auth and no network',{timeout:120000},async()=>{
  const {mf,external}=await fixture();
  try{
    const unauth=await mf.dispatchFetch(PILOT_URL+'__pilot',{method:'GET'});
    assert.equal(unauth.status,401);
    assert.equal(unauth.headers.get('Cache-Control'),'no-store');
    const unknown=await mf.dispatchFetch(PILOT_URL+'v1/auth/login',{method:'POST',headers:signed()});
    assert.equal(unknown.status,404);
    const wrong=await mf.dispatchFetch(PILOT_URL+'probe',{method:'POST',
      headers:{...signed(),'Content-Type':'application/json'},
      body:JSON.stringify({mode:'do',rounds:500000,wrong:false})});
    assert.equal(wrong.status,400);
    const body=(await wrong.json());
    assert.equal(body.code,'BAD_INPUT');
    assert.equal(Object.hasOwn(body,'password'),false);
    const invalid=await mf.dispatchFetch(PILOT_URL+'probe',{method:'POST',
      headers:{...signed(),'Content-Type':'application/json'},
      body:JSON.stringify({mode:'do',rounds:100000,wrong:false,stored:'secret-data'})});
    assert.equal(invalid.status,400);

    const report=await probeCloudPilot({
      url:PILOT_URL,token:TOKEN,repeats:1,
      fetchImpl:(url,init)=>mf.dispatchFetch(url,init)
    });
    assert.equal(report.target,'SYNTHETIC_ONLY_TARGET_CONFIRMED');
    assert.equal(report.outcome,'SYNTHETIC_SMOKE_PASS');
    assert.equal(report.syntheticRequests,16);
    assert.equal(report.cases.length,16);
    assert.ok(report.cases.every(x=>x.behavior==='SYNTHETIC_BEHAVIOR_OK'));
    assert.equal(report.freeCertified,false);
    assert.equal(report.safeToDowngradeProduction,false);
    assert.equal(report.httpCpuInCloudMs,null);
    assert.equal(report.doCpuInCloudMs,null);
    assert.equal(report.freeAccountPlanIndependentlyVerified,false);
    assert.equal(external(),0);
    const serialized=JSON.stringify(report);
    for(const value of [TOKEN,PASSWORD,PEPPER,'rc_session','password_hash'])
      assert.equal(serialized.includes(value),false);
  }finally{await mf.dispose();}
});
test('pilot fails closed when access secret, dedicated flag or synthetic pepper is absent',{timeout:120000},async()=>{
  const malformed={...BINDINGS,
    PASSWORD_PEPPER:{type:'text',value:'real-pepper-must-not-be-used'}};
  const {mf}=await fixture(malformed);
  try{
    const res=await mf.dispatchFetch(PILOT_URL+'__pilot',{method:'GET',headers:signed()});
    assert.equal(res.status,503);
    assert.equal((await res.json()).code,'NOT_CONFIGURED');
  }finally{await mf.dispose();}
});
test('cloud response classifier rejects wrong results and non-JSON Cloudflare CPU error HTML',async()=>{
  let count=0;
  const stub=async(url,init)=>{
    count++;
    if(url.endsWith('/__pilot'))return new Response(JSON.stringify({
      ok:true,kind:'xrh-cf-free-isolated-probe',protocol:1,syntheticOnly:true,freeCertified:false
    }),{status:200,headers:{'Content-Type':'application/json'}});
    if(count===2)return new Response('<html>Error 1102</html>',{status:500});
    return new Response(JSON.stringify({ok:false}),{status:200});
  };
  const r=await probeCloudPilot({url:PILOT_URL,token:TOKEN,repeats:1,fetchImpl:stub});
  assert.equal(r.outcome,'SYNTHETIC_SMOKE_FAIL');
  assert.ok(r.cases.every(x=>x.behavior==='FAILED_OR_RESOURCE_LIMIT'));
  assert.equal(r.freeCertified,false);
});

test('direct HTTP resource failures are recorded separately from successful DO controls',async()=>{
  const report=await probeCloudPilot({url:PILOT_URL,token:TOKEN,repeats:1,fetchImpl:async(url,init)=>{
    assert.equal(init.redirect,url.endsWith('/__pilot')?'manual':'error');
    if(url.endsWith('/__pilot'))return Response.json({ok:true,kind:'xrh-cf-free-isolated-probe',protocol:1,syntheticOnly:true,freeCertified:false});
    const {mode,rounds,wrong}=JSON.parse(init.body);
    if(mode==='http'&&rounds>10000)return new Response('<html>Error 1102</html>',{status:500});
    return Response.json({ok:true,kind:'xrh-cf-free-isolated-probe',mode,rounds,verified:!wrong,syntheticOnly:true,freeCertified:false});
  }});
  assert.deepEqual(report.components,{http:{passed:2,total:8,status:'FAILED_OR_RESOURCE_LIMIT'},do:{passed:8,total:8,status:'BEHAVIOR_PASS'}});
  assert.equal(report.outcome,'SYNTHETIC_SMOKE_FAIL');
  assert.equal(report.freeCertified,false);
  assert.equal(report.safeToDowngradeProduction,false);
});

test('identity redirect and mismatch stop immediately and never send password probes',async()=>{
  for(const [response,code] of [[()=>new Response(null,{status:302,headers:{location:'https://example.test/'}}),'PROBE_IDENTITY_REDIRECT_REJECTED'],[()=>Response.json({kind:'wrong'}),'PROBE_IDENTITY_MISMATCH'],[()=>new Response(null,{status:403}),'PROBE_IDENTITY_HTTP_403']]){
    let count=0;
    await assert.rejects(()=>probeCloudPilot({url:PILOT_URL,token:TOKEN,fetchImpl:async(url,init)=>{count++;assert.ok(url.endsWith('/__pilot'));assert.equal(init.redirect,'manual');return response();}}),e=>e.message===code&&e.identityAttempts.length===1);
    assert.equal(count,1);
  }
});
test('identity can recover from one transient deployment 404 without replaying calculation probes',async()=>{
  let identityCalls=0,probeCalls=0;
  const report=await probeCloudPilot({url:PILOT_URL,token:TOKEN,fetchImpl:async(url,init)=>{
    if(url.endsWith('/__pilot')){identityCalls++;return identityCalls===1?new Response(null,{status:404,headers:{'cf-ray':'synthetic'}}):Response.json({ok:true,kind:'xrh-cf-free-isolated-probe',protocol:1,syntheticOnly:true,freeCertified:false});}
    probeCalls++;const {mode,rounds,wrong}=JSON.parse(init.body);return Response.json({ok:true,kind:'xrh-cf-free-isolated-probe',mode,rounds,verified:!wrong,syntheticOnly:true,freeCertified:false});
  }});
  assert.equal(identityCalls,2);assert.equal(probeCalls,16);assert.equal(report.identityAttempts[0].status,404);assert.equal(report.identityAttempts[1].code,'IDENTITY_OK');
});
