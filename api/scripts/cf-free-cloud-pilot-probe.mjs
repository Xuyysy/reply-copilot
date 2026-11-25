#!/usr/bin/env node
// Opt-in, bounded, synthetic-only Cloudflare Free plan smoke test.
// NEVER queries real D1, deploys Workers or touches any production namespace.
import {pathToFileURL} from 'node:url';
const EXPECTED_KIND='xrh-cf-free-isolated-probe';
const WORKER='xrh-cf-free-cpu-pilot-20261120';
const SUBDOMAIN='x-reply-helper-isolated-workers-free-cpu-pilot';
export const ROUNDS=Object.freeze([10000,60000,100000,210000]);
export const MAX_REPEATS=2;

export function isAllowedCloudUrl(value){
  if(typeof value!=='string')return false;
  try{
    const url=new URL(value);
    return url.protocol==='https:' && !url.username && !url.password &&
      !url.port && url.pathname==='/' && !url.search && !url.hash &&
      url.hostname===WORKER+'.'+SUBDOMAIN+'.workers.dev';
  }catch{return false;}
}
export function parseCloudArgs(args,env){
  const out={execute:false,confirm:false,url:null,repeats:1,token:env.CF_FREE_PILOT_ACCESS_TOKEN};
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--execute-cloud'){out.execute=true;continue;}
    if(a==='--confirm-dedicated-free-account'){out.confirm=true;continue;}
    if(a==='--url'){out.url=args[++i];continue;}
    if(a==='--repeats'){out.repeats=Number(args[++i]);continue;}
    throw Error('Unknown or missing option');
  }
  if(!out.execute||!out.confirm||!isAllowedCloudUrl(out.url)||
     !Number.isInteger(out.repeats)||out.repeats<1||out.repeats>MAX_REPEATS||
     typeof out.token!=='string'||out.token.length<40||out.token.length>256)
    throw Error('Explicit isolated Free-account consent, URL and secret are required');
  return out;
}
function resultStatus(response,body,mode,rounds,wrong){
  if(!response.ok||body?.ok!==true||body?.kind!==EXPECTED_KIND||
     body?.mode!==mode||body?.rounds!==rounds||body?.syntheticOnly!==true||
     body?.freeCertified!==false||body?.verified!==!wrong)
    return 'FAILED_OR_RESOURCE_LIMIT';
  return 'SYNTHETIC_BEHAVIOR_OK';
}
export async function probeCloudPilot({url,token,repeats=1,fetchImpl=fetch}){
  if(!isAllowedCloudUrl(url)||typeof token!=='string'||token.length<40||token.length>256||
     !Number.isInteger(repeats)||repeats<1||repeats>MAX_REPEATS)
    throw Error('Invalid isolated test input');
  const base=new URL(url).origin;
  const headers={Authorization:'Bearer '+token};
  let identity;
  // Deployment/secret propagation is asynchronous. Retry only transient
  // availability or authentication failures, never redirects or wrong identity.
  const identityAttempts=[];
  for(let attempt=1;attempt<=4;attempt++){
    let status=null,ray=false,code='PROBE_IDENTITY_NETWORK_UNAVAILABLE';
    try{
      const r=await fetchImpl(base+'/__pilot',{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(8000)});
      status=r.status;ray=!!r.headers.get('cf-ray');
      if(status>=300&&status<400)throw Error('PROBE_IDENTITY_REDIRECT_REJECTED');
      let body=null;try{body=await r.json();}catch{}
      if(r.ok&&body?.kind===EXPECTED_KIND&&body?.protocol===1&&
         body?.syntheticOnly===true&&body?.freeCertified===false){
        identity='SYNTHETIC_ONLY_TARGET_CONFIRMED';
        identityAttempts.push({attempt,status,ray,code:'IDENTITY_OK'});
        break;
      }
      if(status===200)throw Error('PROBE_IDENTITY_MISMATCH');
      code='PROBE_IDENTITY_HTTP_'+status;
    }catch(e){
      if(['PROBE_IDENTITY_REDIRECT_REJECTED','PROBE_IDENTITY_MISMATCH'].includes(e?.message)){
        code=e.message;identityAttempts.push({attempt,status,ray,code});break;
      }
    }
    identityAttempts.push({attempt,status,ray,code});
    if(![null,401,404,429,500,502,503,504].includes(status))break;
    if(attempt<4)await new Promise(resolve=>setTimeout(resolve,2000*attempt));
  }
  if(!identity){
    const error=new Error(identityAttempts.at(-1)?.code||'PROBE_IDENTITY_UNAVAILABLE');
    error.identityAttempts=identityAttempts;
    throw error;
  }
  const cases=[];
  // Alternate HTTP and DO and reverse the factor order on the second pass.
  // This helps separate startup/propagation failures from work-factor effects.
  for(let repeat=0;repeat<repeats;repeat++)
    for(const rounds of (repeat===0?ROUNDS:[...ROUNDS].reverse()))for(const mode of ['http','do'])for(const wrong of [false,true]){
      const request={mode,rounds,wrong};
      let status='FAILED_OR_RESOURCE_LIMIT',httpStatus=null,wallMs=null,ray=false,diagnostic=null;
      try{
        const started=performance.now();
        const response=await fetchImpl(base+'/probe',{
          method:'POST',redirect:'error',headers:{...headers,'Content-Type':'application/json'},
          body:JSON.stringify(request),signal:AbortSignal.timeout(15000)
        });
        wallMs=Number((performance.now()-started).toFixed(3));
        httpStatus=response.status;
        ray=!!response.headers.get('cf-ray');
        // Cloudflare Error 1102 may be HTML; never reproduce the response body.
        let parsed=null;const bodyText=await response.text();try{parsed=JSON.parse(bodyText);}catch{}
        if(['NOT_CONFIGURED','UNAUTHORIZED','VERIFIER_UNAVAILABLE','PILOT_UNAVAILABLE','BAD_INPUT','NOT_FOUND','METHOD_NOT_ALLOWED'].includes(parsed?.code)){
          diagnostic={code:parsed.code,stage:['REQUEST','HTTP_VERIFY','DO_RPC'].includes(parsed.stage)?parsed.stage:null,failure:['KDF_RUNTIME_LIMIT','RUNTIME_RESOURCE_LIMIT','KDF_NOT_SUPPORTED','KDF_OPERATION_ERROR','UNCLASSIFIED'].includes(parsed.failure)?parsed.failure:null};
        }else if(!response.ok){diagnostic={code:/\b(?:Error\s*1102|exceeded resources)\b/i.test(bodyText)?'CF_RESOURCE_LIMIT_PAGE':'UNCLASSIFIED_HTTP_RESPONSE',stage:null,failure:null};}
        status=resultStatus(response,parsed,mode,rounds,wrong);
      }catch{
        status='FAILED_OR_RESOURCE_LIMIT';
      }
      cases.push({mode,rounds,wrong,repeat:repeat+1,behavior:status,httpStatus,wallMs,ray,diagnostic});
    }
  const summarize=mode=>{
    const group=cases.filter(x=>x.mode===mode);
    const passed=group.filter(x=>x.behavior==='SYNTHETIC_BEHAVIOR_OK').length;
    return {passed,total:group.length,status:passed===group.length?'BEHAVIOR_PASS':'FAILED_OR_RESOURCE_LIMIT'};
  };
  const components={http:summarize('http'),do:summarize('do')};
  const succeeded=components.http.status==='BEHAVIOR_PASS'&&components.do.status==='BEHAVIOR_PASS';
  return {kind:'SYNTHETIC_CF_FREE_ACCOUNT_PILOT',target:identity,
    identityAttempts,execution:'REMOTE_CLOUD',outcome:succeeded?'SYNTHETIC_SMOKE_PASS':'SYNTHETIC_SMOKE_FAIL',
    syntheticRequests:cases.length,components,freeCertified:false,
    httpCpuInCloudMs:null,doCpuInCloudMs:null,freeAccountPlanIndependentlyVerified:false,
    safeToDowngradeProduction:false,
    caveat:'HTTP/DO CPU budgets must be verified through genuine account, plan, version and Cloudflare per-invocation evidence. Client wall time is not CPU. A Paid account cannot prove Free limits. HTTP control failure does not imply DO failure, and neither component certifies CPU through behavioral success alone.',
    cases};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let args;
  try{args=parseCloudArgs(process.argv.slice(2),process.env);}
  catch{console.error('No cloud calls made. Requires --execute-cloud --confirm-dedicated-free-account --url https://'+WORKER+'.'+SUBDOMAIN+'.workers.dev plus CF_FREE_PILOT_ACCESS_TOKEN.');process.exitCode=2;}
  if(args)probeCloudPilot(args).then(report=>{
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(report.outcome!=='SYNTHETIC_SMOKE_PASS')process.exitCode=1;
  }).catch(()=>{
    console.error('Cloud pilot failed or was unreachable; no Free certification produced.');process.exitCode=1;
  });
}
