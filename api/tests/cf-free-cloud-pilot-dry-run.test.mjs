import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  FREE_UNCOMPRESSED_LIMIT_BYTES,parseWranglerUploadBytes,runPilotDryRun,validatePilotConfig
} from '../scripts/cf-free-cloud-pilot-dry-run.mjs';

test('Wrangler output parser uses uncompressed Total Upload, never the gzip size',()=>{
  assert.equal(parseWranglerUploadBytes('Total Upload: 259.61 KiB / gzip: 47.23 KiB'),
    Math.ceil(259.61*1024));
  assert.equal(parseWranglerUploadBytes('Total Upload: 1.50 MiB / gzip: 100.00 KiB'),
    1572864);
  assert.equal(parseWranglerUploadBytes('Total Upload: 100 B / gzip: 10 B'),100);
  assert.throws(()=>parseWranglerUploadBytes('gzip: 47.23 KiB'));
  assert.throws(()=>parseWranglerUploadBytes('Total Upload: 0 B'));
  assert.equal(FREE_UNCOMPRESSED_LIMIT_BYTES,64*1024*1024);
});

test('allowlist blocks accidental production routes, extra bindings and runtime flags',()=>{
  const config=JSON.parse(readFileSync(new URL('../prototypes/cf-free-cloud-pilot/wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(validatePilotConfig(config),true);
  for(const mutation of [
    x=>{x.name='reply-copilot-api-production';},
    x=>{x.routes=['example.com/*'];},
    x=>{x.d1_databases=[{binding:'DB',database_id:'unknown'}];},
    x=>{x.vars.PILOT_ACCESS_TOKEN='never-commit';},
    x=>{x.observability.enabled=true;},
    x=>{x.durable_objects.bindings[0].class_name='OtherDO';},
    x=>{x.migrations[0].new_sqlite_classes=['OtherDO'];},
    x=>{x.workers_dev=false;}
  ]){
    const changed=structuredClone(config);
    mutation(changed);
    assert.throws(()=>validatePilotConfig(changed));
  }
});

test('pinned Wrangler deploy --dry-run builds the actual standalone Free pilot without credentials or deployment',{
  timeout:120000
},()=>{
  const report=runPilotDryRun();
  assert.equal(report.status,'ISOLATED_WRANGLER_DRY_RUN_PASS');
  assert.equal(report.workerName,'xrh-cf-free-cpu-pilot-20261120');
  assert.equal(report.sqliteDurableObject,'PasswordVerifierDO');
  assert.equal(report.deployed,false);
  assert.equal(report.freeAccountUsed,false);
  assert.equal(report.freeCpuCertified,false);
  assert.equal(report.safeToDowngradeProduction,false);
  assert.ok(report.uncompressedWranglerUploadBytes>0);
  assert.ok(report.uncompressedWranglerUploadBytes<FREE_UNCOMPRESSED_LIMIT_BYTES);
  assert.ok(report.conservativeOutputBytes>0);
  const output=JSON.stringify(report);
  for(const secret of ['CLOUDFLARE_API_TOKEN','PILOT_ACCESS_TOKEN','AUTH_HASH_SECRET'])
    assert.ok(!output.includes(secret));
  console.log(JSON.stringify({event:'isolated_free_pilot_wranger_dryrun',
    status:report.status,uncompressedWranglerUploadBytes:report.uncompressedWranglerUploadBytes,
    limitBytes:report.freeBundleLimitBytes,deployed:false,freeCpuCertified:false}));
});
