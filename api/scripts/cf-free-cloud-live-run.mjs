#!/usr/bin/env node
// Explicit, one-shot, synthetic-only Free cloud experiment from a real
// network-connected machine. Not used by Production and never run by CI.
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {probeCloudPilot} from './cf-free-cloud-pilot-probe.mjs';
import {runPilotDryRun,validatePilotConfig} from './cf-free-cloud-pilot-dry-run.mjs';
import {collectCpuEvidence,validWindow} from './cf-free-cloud-cpu-evidence.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const REPO=resolve(ROOT,'..');
const API='https://api.cloudflare.com/client/v4';
const NAME='xrh-cf-free-cpu-pilot-20261120';
const ACCOUNT_NAME='X Reply Helper - Isolated Workers Free CPU Pilot';
const ACCOUNT_ID_HASH='e23dffc780a86b492af765c3e615f5d2f037c2e1e3223e027b396d102e77fcd6';
const SUBDOMAIN='x-reply-helper-isolated-workers-free-cpu-pilot';
const HEX32=/^[a-f0-9]{32}$/i;
const HEX40=/^[a-f0-9]{40}$/i;
function sha(value){return createHash('sha256').update(value).digest('hex');}
export function approvedAccount(value){
  return typeof value==='string'&&HEX32.test(value)&&sha(value.toLowerCase())===ACCOUNT_ID_HASH;
}
export function parseLiveRunArgs(args,env={}){
  const x={execute:false,free:false,cleanup:false,accountId:null,commit:null,repeats:1,token:env.CF_FREE_PILOT_API_TOKEN};
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--execute-isolated-free-pilot'){x.execute=true;continue;}
    if(a==='--confirm-workers-free'){x.free=true;continue;}
    if(a==='--confirm-delete-test-resources'){x.cleanup=true;continue;}
    if(a==='--expected-account-id'){x.accountId=args[++i];continue;}
    if(a==='--expected-commit'){x.commit=args[++i];continue;}
    if(a==='--repeats'){x.repeats=Number(args[++i]);continue;}
    throw Error('INVALID_CLI_FLAG');
  }
  if(!x.execute||!x.free||!x.cleanup||!approvedAccount(x.accountId)||!HEX40.test(x.commit||'')||
     !Number.isInteger(x.repeats)||x.repeats<1||x.repeats>2||
     typeof x.token!=='string'||x.token.length<20||x.token.length>1024)
    throw Error('EXPLICIT_FREE_TEST_AUTHORIZATION_REQUIRED');
  return x;
}
function git(args){
  const p=spawnSync('git',args,{cwd:REPO,encoding:'utf8',timeout:10000,maxBuffer:200000});
  if(p.status!==0||p.error)throw Error('GIT_CHECK_FAILED');
  return p.stdout.trim();
}
export function verifySource(commit){
  if(!HEX40.test(commit||'')||git(['rev-parse','HEAD']).toLowerCase()!==commit.toLowerCase())
    throw Error('GIT_SHA_MISMATCH');
  if(git(['status','--porcelain','--untracked-files=all'])!=='')
    throw Error('GIT_CHECKOUT_NOT_CLEAN');
  validatePilotConfig(JSON.parse(readFileSync(resolve(ROOT,'prototypes/cf-free-cloud-pilot/wrangler.jsonc'),'utf8')));
}
export function makeCloudClient(token,fetchImpl=fetch){
  return async(method,path)=>{
    // Defense in depth: even a direct caller of the client cannot delete a
    // different script or query a different account. Reject before fetch.
    const account=/^\/accounts\/([a-f0-9]{32})\/workers\/(scripts|durable_objects\/namespaces|subdomain)(?:\/(xrh-cf-free-cpu-pilot-20261120)\?force=false)?$/i.exec(path);
    const permitted=method==='GET'&&path==='/accounts?page=1&per_page=50' ||
      Boolean(account&&approvedAccount(account[1])&&(
        method==='GET'&&!account[3] ||
        method==='DELETE'&&account[2]==='scripts'&&account[3]===NAME
      ));
    if(!permitted)throw Error('CLOUD_API_PATH_NOT_ALLOWLISTED');
    let response;
    try{
      response=await fetchImpl(API+path,{method,redirect:'error',
        headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
    }catch{throw Error('CLOUD_API_NETWORK_ERROR');}
    if(response.status===204)return null;
    const body=await response.json().catch(()=>null);
    if(!response.ok||body?.success!==true)
      throw Error('CLOUD_API_HTTP_'+response.status);
    if(Array.isArray(body.result)&&(body.result_info?.total_pages>1||body.result_info?.total_count>body.result.length))
      throw Error('CLOUD_API_INVENTORY_TRUNCATED');
    return body.result;
  };
}
export function makeWranglerExecutor(accountId,token){
  const bin=resolve(ROOT,'node_modules/.bin/wrangler');
  const config='prototypes/cf-free-cloud-pilot/wrangler.jsonc';
  if(!approvedAccount(accountId)||typeof token!=='string'||token.length<20)throw Error('TEST_TARGET_REJECTED');
  const env={PATH:process.env.PATH||'',HOME:process.env.HOME||'',TMPDIR:process.env.TMPDIR||'/tmp',CLOUDFLARE_ACCOUNT_ID:accountId,CLOUDFLARE_API_TOKEN:token,
    WRANGLER_SEND_METRICS:'false',CI:'true'};
  return async(action,secret)=>{
    const args=action==='deploy'?['deploy','--config',config]:
      action==='secret'?['secret','put','PILOT_ACCESS_TOKEN','--config',config]:null;
    if(!args)throw Error('UNRECOGNIZED_WRANGLER_ACTION');
    const r=spawnSync(process.execPath,[bin,...args],{cwd:ROOT,env,encoding:'utf8',
      input:action==='secret'?secret+'\n':'',timeout:120000,maxBuffer:1500000});
    // Never echo stdout, stderr, auth tokens, or exception messages.
    if(r.status!==0||r.error||r.signal)
      throw Error(action==='deploy'?'WRANGLER_ISOLATED_DEPLOY_FAILED':'WRANGLER_PILOT_SECRET_FAILED');
  };
}
function result(){
  return {kind:'ISOLATED_FREE_HTTP_DO_PILOT',decision:'NO_GO',
    uploaded:false,smoke:null,cpuAnalytics:null,cpuEvidenceWindow:null,cpuNamespaceId:null,cloudCpuMs:null,doCpuMs:null,
    freeCertified:false,safeToDowngradeProduction:false,
    errors:[],cleanup:{attempted:false,workerAbsent:false,doNamespaceAbsent:false},
    productionUntouched:true};
}
function codeOf(error){
  return /^[A-Z][A-Z0-9_]{2,90}$/.test(error?.message||'')?error.message:'EXPERIMENT_FAILED';
}
/** All dependencies injectable: full CI runs offline with zero cloud calls. */
export async function runIsolatedFreePilot({accountId,commit,repeats=1,token},{
  cloud=makeCloudClient(token),wrangler=makeWranglerExecutor(accountId,token),
  probe=probeCloudPilot,source=verifySource,dryRun=runPilotDryRun,
  cpu=collectCpuEvidence,clock=()=>Date.now(),secret=()=>randomBytes(48).toString('hex')
}={}){
  if(!approvedAccount(accountId)||!HEX40.test(commit||'')||
    !Number.isInteger(repeats)||repeats<1||repeats>2)throw Error('TEST_TARGET_REJECTED');
  const o={...result(),sourceCommit:commit,stage:'source',identityAttempts:[]},base='/accounts/'+accountId+'/workers',path=base+'/scripts/'+NAME;
  let isolated=false,deployStarted=false,namespaceId=null,startedAt=null,completedAt=null;
  try{
    source(commit);
    o.stage='account_preflight';
    const accounts=await cloud('GET','/accounts?page=1&per_page=50');
    if(!Array.isArray(accounts)||accounts.length!==1||accounts[0]?.id!==accountId||
      accounts[0]?.name!==ACCOUNT_NAME)throw Error('ACCOUNT_SCOPE_OR_IDENTITY_REJECTED');
    const workers=await cloud('GET',base+'/scripts');
    const namespaces=await cloud('GET',base+'/durable_objects/namespaces');
    const subdomain=await cloud('GET',base+'/subdomain');
    if(!Array.isArray(workers)||workers.length!==0||
      !Array.isArray(namespaces)||namespaces.length!==0||
      subdomain?.subdomain!==SUBDOMAIN)
      throw Error('ISOLATED_ACCOUNT_NOT_EMPTY');
    isolated=true;
    o.stage='dry_run';
    const bundle=dryRun();
    if(bundle?.status!=='ISOLATED_WRANGLER_DRY_RUN_PASS'||bundle.deployed!==false)
      throw Error('LOCAL_BUNDLE_NOT_VERIFIED');
    const password=secret();
    if(typeof password!=='string'||password.length<40||password.length>256)
      throw Error('RANDOM_PILOT_TOKEN_INVALID');
    // Treat even a failed deploy command as potentially having created a Worker.
    o.stage='deploy';
    deployStarted=true;
    await wrangler('deploy');
    o.uploaded=true;
    o.stage='secret';
    await wrangler('secret',password);
    o.stage='namespace';
    const after=await cloud('GET',base+'/durable_objects/namespaces');
    const ns=Array.isArray(after)?after:[];
    const named=ns.filter(v=>v?.name===NAME+'_PasswordVerifierDO');
    if(ns.length!==1||named.length!==1||!/^[a-f0-9]{32}$/i.test(named[0].id||''))
      throw Error('ISOLATED_SQLITE_NAMESPACE_NOT_VERIFIED');
    namespaceId=named[0].id;
    startedAt=new Date(clock()-1000).toISOString();
    const url='https://'+NAME+'.'+SUBDOMAIN+'.workers.dev/';
    o.stage='probe';
    o.smoke=await probe({url,token:password,repeats});
    o.identityAttempts=o.smoke?.identityAttempts??[];
    completedAt=new Date(Math.max(clock(),Date.parse(startedAt)+1)).toISOString();
    if(o.smoke?.kind!=='SYNTHETIC_CF_FREE_ACCOUNT_PILOT'||o.smoke.syntheticRequests!==repeats*16||
      !['SYNTHETIC_SMOKE_PASS','SYNTHETIC_SMOKE_FAIL'].includes(o.smoke.outcome))
      throw Error('INVALID_PILOT_HTTP_REPORT');
    o.stage='probe_complete';
  }catch(e){
    o.errors.push(codeOf(e));
    if(startedAt&&!completedAt)completedAt=new Date(Math.max(clock(),Date.parse(startedAt)+1)).toISOString();
    if(Array.isArray(e?.identityAttempts))o.identityAttempts=e.identityAttempts.slice(0,4).map(x=>({attempt:x.attempt,status:x.status,ray:x.ray,code:x.code}));
  }
  finally{
    if(isolated&&deployStarted){
      o.cleanup.attempted=true;
      try{await cloud('DELETE',path+'?force=false');}
      catch{o.errors.push('ISOLATED_WORKER_DELETE_FAILED');}
    }
    if(isolated){
      try{
        const workers=await cloud('GET',base+'/scripts');
        const namespaces=await cloud('GET',base+'/durable_objects/namespaces');
        o.cleanup.workerAbsent=Array.isArray(workers)&&workers.length===0;
        o.cleanup.doNamespaceAbsent=Array.isArray(namespaces)&&namespaces.length===0;
      }catch{o.errors.push('FINAL_RESOURCE_INVENTORY_UNAVAILABLE');}
      if(!o.cleanup.workerAbsent||!o.cleanup.doNamespaceAbsent)
        o.errors.push('TEST_RESOURCES_NOT_CONFIRMED_REMOVED');
    }
    // Do not keep the Worker running to wait for delayed analytics. A separate
    // read-only GraphQL call follows only after cleanup is verified.
    if(isolated&&namespaceId&&startedAt&&completedAt){
      o.cpuNamespaceId=namespaceId;
      o.cpuEvidenceWindow={from:startedAt,to:completedAt};
      if(validWindow(startedAt,completedAt)&&o.cleanup.workerAbsent&&o.cleanup.doNamespaceAbsent){
        try{o.cpuAnalytics=await cpu({accountId,namespaceId,from:startedAt,to:completedAt,token});}
        catch{o.errors.push('CLOUD_CPU_ANALYTICS_UNAVAILABLE');}
      }else o.errors.push('CLOUD_CPU_ANALYTICS_WINDOW_OR_CLEANUP_UNAVAILABLE');
    }
  }
  return o;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let args;
  try{args=parseLiveRunArgs(process.argv.slice(2),process.env);}
  catch{console.error('No cloud calls: dedicated Free account, exact clean Git SHA, explicit flags and CF_FREE_PILOT_API_TOKEN required.');process.exitCode=2;}
  if(args){
    const r=await runIsolatedFreePilot({accountId:args.accountId,commit:args.commit,
      repeats:args.repeats,token:args.token});
    process.stdout.write(JSON.stringify(r,null,2)+'\n');
    if(r.smoke?.outcome!=='SYNTHETIC_SMOKE_PASS'||
       r.cpuAnalytics?.status!=='BOTH_COMPONENTS_OBSERVED_NOT_CERTIFIED'||
       !r.cleanup.workerAbsent||!r.cleanup.doNamespaceAbsent||r.errors.length)process.exitCode=1;
  }
}
