// One-off CI evidence handoff for the authorized isolated Free-account test.
// The emitted bundle has ONLY public synthetic fixtures (no API tokens or user data).
// Always compile via the repository-locked Wrangler, never by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePilotConfig} from '../scripts/cf-free-cloud-pilot-dry-run.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const config=resolve(root,'prototypes/cf-free-cloud-pilot/wrangler.jsonc');
function walk(dir){
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>
    e.isDirectory()?walk(join(dir,e.name)):e.isFile()?[join(dir,e.name)]:[]);
}
test('export exact synthetic Wrangler bundle for isolated authorized CPU pilot', {timeout:120000},()=>{
  validatePilotConfig(JSON.parse(readFileSync(config,'utf8')));
  const temp=mkdtempSync(join(tmpdir(),'xrh-pilot-export-'));
  try{
    const output=join(temp,'out');
    const binary=resolve(root,'node_modules/.bin/wrangler');
    assert.ok(existsSync(binary),'Locked Wrangler required');
    const p=spawnSync(process.execPath,[binary,'deploy','--dry-run','--outdir',output,
      '--config','prototypes/cf-free-cloud-pilot/wrangler.jsonc'],{
      cwd:root,encoding:'utf8',timeout:90000,maxBuffer:2000000,
      env:{PATH:process.env.PATH||'',HOME:temp,CI:'true',
        WRANGLER_SEND_METRICS:'false',NO_COLOR:'1',FORCE_COLOR:'0'}
    });
    assert.equal(p.status,0,'Credential-free Wrangler dry-run must succeed');
    const sources=walk(output).filter(path=>/\.(js|mjs)$/.test(path));
    const matches=sources.map(path=>readFileSync(path,'utf8'))
      .filter(src=>src.includes('xrh-cf-free-isolated-probe')&&src.includes('PasswordVerifierDO'));
    assert.equal(matches.length,1,'Exactly one matching compiled pilot module');
    const source=matches[0];
    assert.ok(source.length>5000&&source.length<1000000,'Expected bounded synthetic source');
    assert.ok(!source.includes('reply-copilot-api-production'));
    const digest=createHash('sha256').update(source).digest('hex');
    const wasmFiles=walk(output).filter(path=>path.endsWith('.wasm'));
    assert.equal(wasmFiles.length,1);
    const wasmDigest=createHash('sha256').update(readFileSync(wasmFiles[0])).digest('hex');
    assert.equal(wasmDigest,'2d34ed3d829ebff018cf3afaba063c9cfd90d14b00db938d082fa862e74ce838');
    console.log('XRH_SYNTHETIC_WASM_SHA256='+wasmDigest);
    console.log('XRH_SYNTHETIC_BUNDLE_SHA256='+digest);
    console.log('XRH_SYNTHETIC_BUNDLE_BASE64='+Buffer.from(source).toString('base64'));
    console.log('XRH_SYNTHETIC_BUNDLE_END');
  }finally{rmSync(temp,{recursive:true,force:true});}
});
