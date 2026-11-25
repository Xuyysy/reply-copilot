#!/usr/bin/env node
// Isolated Cloudflare Free pilot deploy dry-run ONLY.
// Uses the repo-pinned Wrangler with credentials stripped. Never deploys.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CONFIG=resolve(ROOT,'prototypes/cf-free-cloud-pilot/wrangler.jsonc');
const BIN=resolve(ROOT,'node_modules/.bin/wrangler');
export const FREE_UNCOMPRESSED_LIMIT_BYTES=64*1024*1024;
const PILOT_NAME='xrh-cf-free-cpu-pilot-20261120';
const PILOT_PEPPER='xrh-isolated-free-pilot-pepper-2026-synthetic-only';

export function validatePilotConfig(config){
  const expectedKeys=['$schema','compatibility_date','durable_objects','main','migrations',
    'name','observability','vars','workers_dev'];
  if(!config||typeof config!=='object'||Array.isArray(config)||
    JSON.stringify(Object.keys(config).sort())!==JSON.stringify(expectedKeys.sort())||
    config.name!==PILOT_NAME||config.main!=='./src/index.ts'||
    config.workers_dev!==true||config.compatibility_date!=='2026-10-14'||
    config.observability?.enabled!==false||
    config.$schema!=='../../node_modules/wrangler/config-schema.json'||
    JSON.stringify(config.vars)!==JSON.stringify({
      PILOT_ENV:'dedicated-synthetic-free-account',PASSWORD_PEPPER:PILOT_PEPPER
    })||
    JSON.stringify(config.durable_objects)!==JSON.stringify({
      bindings:[{name:'PASSWORD_VERIFY_DO',class_name:'PasswordVerifierDO'}]
    })||
    JSON.stringify(config.migrations)!==JSON.stringify([{
      tag:'isolated-free-pilot-v1',new_sqlite_classes:['PasswordVerifierDO']
    }])){
    throw Error('Pilot configuration is not the allowlisted standalone synthetic Worker');
  }
  return true;
}

export function parseWranglerUploadBytes(output){
  const clean=String(output).replace(/\u001b\[[0-9;]*m/g,'');
  const m=clean.match(/Total Upload:\s*([\d,.]+)\s*(B|KiB|MiB)\b/i);
  if(!m)throw Error('Wrangler did not disclose an uncompressed Total Upload size');
  const value=Number(m[1].replace(/,/g,''));
  const unit=m[2].toLowerCase();
  if(!Number.isFinite(value)||value<=0)throw Error('Wrangler upload size is invalid');
  return Math.ceil(value*(unit==='mib'?1048576:unit==='kib'?1024:1));
}

function collect(dir){
  const paths=[];
  for(const ent of readdirSync(dir,{withFileTypes:true})){
    const child=join(dir,ent.name);
    if(ent.isDirectory())paths.push(...collect(child));
    else if(ent.isFile())paths.push(child);
    else throw Error('Unexpected symlink or special file in dry-run output');
  }
  return paths;
}

export function runPilotDryRun(){
  validatePilotConfig(JSON.parse(readFileSync(CONFIG,'utf8')));
  if(!existsSync(BIN))throw Error('Locked Wrangler is not installed; run npm --prefix api ci');
  const scratch=mkdtempSync(join(tmpdir(),'xrh-cf-free-dry-run-'));
  try{
    const outdir=join(scratch,'dist');
    const result=spawnSync(process.execPath,[BIN,'deploy','--dry-run','--outdir',outdir,
      '--config','prototypes/cf-free-cloud-pilot/wrangler.jsonc'],{
      cwd:ROOT,encoding:'utf8',input:'',timeout:90000,maxBuffer:2_000_000,
      // Explicitly discard ambient Cloudflare auth, account IDs and project
      // environment so a dry run cannot accidentally use real credentials.
      env:{PATH:process.env.PATH||'',HOME:scratch,CI:'true',
        WRANGLER_SEND_METRICS:'false',NO_COLOR:'1',FORCE_COLOR:'0'}
    });
    if(result.error||result.signal||result.status!==0){
      // Do not print raw CLI output, which might contain local filesystem data.
      throw Error('Locked Wrangler isolated dry-run build failed (exit '+
        String(result.status??result.signal??'error')+')');
    }
    const reported=parseWranglerUploadBytes((result.stdout||'')+'\n'+(result.stderr||''));
    if(reported>=FREE_UNCOMPRESSED_LIMIT_BYTES)
      throw Error('Standalone Worker is at or over the 64MiB Free bundle limit');
    if(!existsSync(outdir))throw Error('Wrangler reported success but emitted no build');
    const files=collect(outdir);
    const wasmFiles=files.filter(file=>file.endsWith('.wasm'));
    if(wasmFiles.length!==1||createHash('sha256').update(readFileSync(wasmFiles[0])).digest('hex')!=='2d34ed3d829ebff018cf3afaba063c9cfd90d14b00db938d082fa862e74ce838')throw Error('PILOT_WASM_ARTIFACT_MISMATCH');
    const sources=files.filter(file=>file.endsWith('.js')||file.endsWith('.mjs'));
    if(sources.length===0)throw Error('No bundled Worker source emitted');
    const code=sources.map(file=>readFileSync(file,'utf8')).join('\n');
    if(!code.includes('PasswordVerifierDO')||!code.includes('xrh-cf-free-isolated-probe'))
      throw Error('Bundled script does not contain expected private DO and pilot probe');
    if(code.includes('reply-copilot-api-production'))
      throw Error('Production Worker identifier unexpectedly present in pilot bundle');
    const outputByteCount=files.reduce((n,file)=>n+statSync(file).size,0);
    if(outputByteCount>=FREE_UNCOMPRESSED_LIMIT_BYTES)
      throw Error('Conservative local output size exceeds 64MiB Free bundle limit');
    return {
      status:'ISOLATED_WRANGLER_DRY_RUN_PASS',
      deployed:false,
      freeAccountUsed:false,
      freeCpuCertified:false,
      safeToDowngradeProduction:false,
      workerName:PILOT_NAME,
      sqliteDurableObject:'PasswordVerifierDO',
      uncompressedWranglerUploadBytes:reported,
      conservativeOutputBytes:outputByteCount,
      freeBundleLimitBytes:FREE_UNCOMPRESSED_LIMIT_BYTES,
      limitations:'This measures a local, credential-free Wrangler bundle only. It does not verify Cloudflare plan, deployment, invocation CPU, DO quotas or startup time in the cloud.'
    };
  }finally{rmSync(scratch,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{process.stdout.write(JSON.stringify(runPilotDryRun(),null,2)+'\n');}
  catch{console.error('Isolated Wrangler dry-run did not pass; no deployment occurred.');process.exitCode=1;}
}
