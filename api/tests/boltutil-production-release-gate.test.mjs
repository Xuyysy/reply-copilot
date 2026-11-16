import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productionBlockers,BOLTUTIL_PRODUCTION_SOURCE_OFF_KEYS} from '../../scripts/production-preflight.mjs';

const worker=JSON.parse(readFileSync(new URL('../deploy/production.wrangler.json',import.meta.url),'utf8'));
const staging=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')).env.staging;
const build=readFileSync(new URL('../../.github/workflows/production-build.yml',import.meta.url),'utf8');
const deploy=readFileSync(new URL('../../.github/workflows/production-deploy.yml',import.meta.url),'utf8');
const verify=readFileSync(new URL('../../scripts/verify-production-artifact.py',import.meta.url),'utf8');

test('production candidate starts fail-closed while original CNY payments and isolated D1 persist',()=>{
 assert.deepEqual(productionBlockers(worker,staging),[]);
 assert.equal(worker.name,'reply-copilot-api-production');
 assert.equal(worker.vars.PAYMENTS_ENABLED,'1');
 assert.equal(worker.vars.XIAODOU_WEBHOOKS_ENABLED,'1');
 assert.equal(worker.vars.ADMIN_PORTAL_ENABLED,'1');
 assert.equal(worker.d1_databases[0].database_name,'reply-copilot-production');
 assert.notEqual(worker.d1_databases[0].database_id,staging.d1_databases[0].database_id);
 assert.equal(BOLTUTIL_PRODUCTION_SOURCE_OFF_KEYS.length,9);
 for(const key of BOLTUTIL_PRODUCTION_SOURCE_OFF_KEYS)assert.notEqual(worker.vars[key],'1',key);
 for(const key of ['BOLTUTIL_API_KEY','BOLTUTIL_WEBHOOK_SECRET','BOLTUTIL_CNY_PER_USDT_MICROS'])
   assert.equal(Object.hasOwn(worker.vars,key),false,key);
});

test('each unsafe source-side USDT enable flag and any committed secret/FX fails preflight',()=>{
 for(const key of BOLTUTIL_PRODUCTION_SOURCE_OFF_KEYS){
  const modified=structuredClone(worker);modified.vars[key]='1';
  assert.ok(productionBlockers(modified,staging).some(error=>error.includes(key)),key);
 }
 for(const key of ['BOLTUTIL_API_KEY','BOLTUTIL_WEBHOOK_SECRET','BOLTUTIL_CNY_PER_USDT_MICROS']){
  const modified=structuredClone(worker);modified.vars[key]=key.includes('MICROS')?'7000000':'fixture-only';
  assert.ok(productionBlockers(modified,staging).some(error=>error.includes(key)),key);
 }
});

test('Production PR build is SHA-pinned, all local, and artifact-verified before upload',()=>{
 assert.match(build,/pull_request:\s*\n\s*branches:\s*\n\s*- release\/production/);
 assert.match(build,/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
 assert.match(build,/github\.event\.pull_request\.head\.sha \|\| github\.sha/);
 assert.match(build,/--dry-run --outdir/);
 assert.match(build,/verify-production-artifact\.py dist\/production-ci/);
 assert.ok(build.indexOf('verify-production-artifact.py')<build.indexOf('actions/upload-artifact@v4'));
 assert.doesNotMatch(build,/wrangler pages deploy/);
 assert.doesNotMatch(build,/CLOUDFLARE_API_TOKEN|secrets\./);
 assert.match(verify,/USDT source gate unexpectedly enabled/);
 assert.match(verify,/Merchant credentials\/FX embedded in artifact/);
});

test('guarded real Production deploy still requires successful full CI and build on release branch',()=>{
 assert.match(deploy,/\.head_branch == "release\/production" and \.event == "push"/);
 assert.match(deploy,/\.path == "\.github\/workflows\/production-build\.yml"/);
 assert.match(deploy,/\.path == "\.github\/workflows\/ci\.yml"/);
 assert.match(deploy,/github\.actor == 'Xuyysy'/);
 assert.match(deploy,/github\.ref == 'refs\/heads\/main'/);
 assert.match(deploy,/CHECK_ONLY/);
 assert.match(deploy,/DEPLOY_WORKER_TO_PRODUCTION/);
});
