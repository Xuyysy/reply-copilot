import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const policy=readFileSync(new URL('../.github/workflows/staging-reply-qa-worker-guarded.yml',import.meta.url),'utf8');

test('Staging Reply QA release requires owner, protected environment and exact CI-approved PR #223 source',()=>{
 for(const needle of [
  "workflow_dispatch:",
  "github.ref == 'refs/heads/main'",
  "github.actor == 'Xuyysy'",
  'environment: staging',
  'pull-requests: read',
  'repos/$GITHUB_REPOSITORY/pulls/223',
  '.head.sha == $sha',
  'd7a7a62de0430e9e2c8ea870067f55ed7f0e96c1',
  '.head_branch == "qa/staging-five-remaining-verified-20261121"',
  '.event == "push"',
  '.status == "completed" and .conclusion == "success"',
  'check:CHECK_ONLY|upload:UPLOAD_STAGING_VERSION_ONLY|deploy:DEPLOY_STAGING_WORKER'
 ])assert.ok(policy.includes(needle),'missing safety gate: '+needle);
 assert.doesNotMatch(policy,/head_branch == "release\/production"/);
});

test('Staging Reply QA release preserves D1 and all Worker bindings and never runs remote SQL',()=>{
 for(const needle of [
  "reply-copilot-api-staging",
  'cd44bb44-b525-42c4-b286-2cc84dae7fdb',
  "EXPECTED_DEPLOYMENT",
  "staging-settings-immediate.json",
  "staging-bindings-before.fingerprint",
  "staging-bindings-after.fingerprint",
  "--keep-vars --strict",
  "--dry-run",
  "STAGING_QA_SUBSCRIPTION_FIVE",
  "STAGING_QA_SUBSCRIPTION_USER_ID",
  "https://api-staging.x-reply-helper.top/health",
  "Staging admin auth guard changed"
 ])assert.ok(policy.includes(needle),'missing preservation guard: '+needle);
 assert.doesNotMatch(policy,/wrangler\s+d1\s+execute/i);
 assert.doesNotMatch(policy,/api\.cloudflare\.com\/client\/v4\/.*\/d1\/database\/.*\/query/i);
 assert.doesNotMatch(policy,/reply-copilot-api-production/);
});

test('strict deployment reconciles known Dashboard vars and exact staging route without relaxing release safety',()=>{
 for (const needle of [
  'extra<=allowed',
  'assert len(domains)==1',
  'assert domain["hostname"]=="api-staging.x-reply-helper.top"',
  'assert domain["enabled"] is True and domain["previews_enabled"] is False',
  'st["preview_urls"]=False',
  'st["vars"]=plain',
  'assert subdomain=={"enabled":False,"previews_enabled":False}',
  'staging-domains-immediate.json',
  'staging-domains-after.json',
  'staging-subdomain-after.json',
  'deploy --config api/.wrangler-staging-strict.json --env staging --keep-vars --strict',
  'rm -f api/.wrangler-staging-strict.json'
 ]) assert.ok(policy.includes(needle),'missing parity guard: '+needle);
 assert.ok(policy.includes("assert 'STAGING_QA_SUBSCRIPTION_FIVE' not in st['vars']"));
 assert.doesNotMatch(policy,/--strict=false|--no-strict|wrangler deploy[^\n]*--force/);
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('ephemeral configuration mirrors only known live vars and exact route; unknown or mismatched data fails closed',()=>{
 const python=policy.split("python3 - <<'PARITY_PY'\n")[1].split('\n          PARITY_PY')[0].split('\n').map(line=>line.slice(10)).join('\n');
 const dir=mkdtempSync(join(tmpdir(),'qa-config-parity-'));
 try{
  mkdirSync(join(dir,'api'));
  const db='cd44bb44-b525-42c4-b286-2cc84dae7fdb';
  const cfg={compatibility_date:'2026-10-14',env:{staging:{name:'reply-copilot-api-staging',workers_dev:false,vars:{ENVIRONMENT:'staging',PAYMENTS_ENABLED:'1'},d1_databases:[{binding:'DB',database_name:'reply-copilot-staging',database_id:db,migrations_dir:'migrations'}]},production:{sentinel:'untouched'}}};
  const bindings=[{name:'ENVIRONMENT',type:'plain_text',text:'staging'},{name:'PAYMENTS_ENABLED',type:'plain_text',text:'1'},{name:'AI_PERFORMANCE_DIAGNOSTICS',type:'plain_text',text:'1'},{name:'STAGING_QA_SUBSCRIPTION_FIVE',type:'plain_text',text:'1'},{name:'DB',type:'d1',id:db},...Array.from({length:27},(_,i)=>({name:'SECRET_'+i,type:'secret_text'}))];
  const domain={hostname:'api-staging.x-reply-helper.top',service:'reply-copilot-api-staging',environment:'production',zone_name:'x-reply-helper.top',enabled:true,previews_enabled:false};
  const original=JSON.stringify(cfg);
  writeFileSync(join(dir,'api/wrangler.jsonc'),original);
  const json=(file,result)=>writeFileSync(join(dir,file),JSON.stringify({success:true,result}));
  const run=(b=bindings,d=domain,u={enabled:false,previews_enabled:false},candidate='v4')=>{
    json('bindings.json',{compatibility_date:'2026-10-14',compatibility_flags:[],bindings:b});
    json('staging-domains-before.json',[d]);
    json('staging-subdomain-before.json',u);
    return spawnSync('python3',['-c',python],{cwd:dir,env:{...process.env,RUNNER_TEMP:dir,CANDIDATE:candidate},encoding:'utf8'});
  };
  const valid=run(); assert.equal(valid.status,0,valid.stderr);
  const v5=run(bindings,domain,{enabled:false,previews_enabled:false},'v5'); assert.equal(v5.status,0,v5.stderr);
  const overridden=[...bindings,{name:'STAGING_REPLY_PROMPT_VERSION',type:'plain_text',text:'v4'}];
  assert.equal(run(overridden,domain,{enabled:false,previews_enabled:false},'v4').status,0);
  assert.notEqual(run(overridden,domain,{enabled:false,previews_enabled:false},'v5').status,0);
  assert.equal(run(bindings,domain,{enabled:false,previews_enabled:false},'v5.1').status,0);
  assert.notEqual(run(overridden,domain,{enabled:false,previews_enabled:false},'v5.1').status,0);
  assert.equal(run(bindings,domain,{enabled:false,previews_enabled:false},'v5.2').status,0);
  assert.notEqual(run(overridden,domain,{enabled:false,previews_enabled:false},'v5.2').status,0);
  assert.equal(run(bindings,domain,{enabled:false,previews_enabled:false},'v5.3').status,0);
  assert.notEqual(run(overridden,domain,{enabled:false,previews_enabled:false},'v5.3').status,0);
  assert.equal(run(bindings,domain,{enabled:false,previews_enabled:false},'v5.4').status,0);
  assert.notEqual(run(overridden,domain,{enabled:false,previews_enabled:false},'v5.4').status,0);
  assert.equal(run().status,0);
  const merged=JSON.parse(readFileSync(join(dir,'api/.wrangler-staging-strict.json'),'utf8'));
  assert.equal(merged.env.staging.vars.AI_PERFORMANCE_DIAGNOSTICS,'1');
  assert.equal(merged.env.staging.vars.STAGING_QA_SUBSCRIPTION_FIVE,'1');
  assert.equal(merged.env.staging.vars.SECRET_0,undefined);
  assert.equal(merged.env.staging.routes[0].pattern,domain.hostname);
  assert.equal(merged.env.staging.preview_urls,false);
  assert.deepEqual(merged.env.staging.d1_databases,[{binding:'DB',database_id:db}]);
  assert.equal(merged.env.staging.d1_databases[0].database_name,undefined);
  assert.equal(merged.env.staging.d1_databases[0].migrations_dir,undefined);
  assert.deepEqual(merged.env.production,cfg.env.production);
  assert.equal(readFileSync(join(dir,'api/wrangler.jsonc'),'utf8'),original);
  assert.notEqual(run([...bindings,{name:'UNEXPECTED_VAR',type:'plain_text',text:'1'}]).status,0);
  assert.notEqual(run(bindings,{...domain,hostname:'api.example.invalid'}).status,0);
  assert.notEqual(run(bindings,domain,{enabled:false,previews_enabled:true}).status,0);
  assert.notEqual(run(bindings.map(b=>b.name==='PAYMENTS_ENABLED'?{...b,text:'0'}:b)).status,0);
  assert.notEqual(run(bindings.map(b=>b.name==='DB'?{...b,id:'wrong'}:b)).status,0);
  assert.notEqual(run(bindings.map(b=>b.name==='DB'?{...b,name:'WRONG_DB'}:b)).status,0);
  assert.notEqual(run([...bindings,{name:'OTHER_DB',type:'d1',id:db}]).status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('V5 release has separate explicit authorization, fixed V4 baseline, exact source scope and no prompt flag mutation',()=>{
 for(const needle of ['options: ["v4", "v5", "v5.1", "v5.2", "v5.3", "v5.4"]','default: "v4"','check:CHECK_V5_ONLY|upload:UPLOAD_STAGING_V5_VERSION_ONLY|deploy:DEPLOY_STAGING_V5_WORKER','20c4eaa6-85a1-4b2b-a5fa-8648dfeebdf5','27b23ad7-37f9-4fab-9ce4-587f1f760ed0','repos/$GITHUB_REPOSITORY/pulls/228','experiment/staging-reply-v5-examples-20261122','829b8596251d004126d4bc1a244925201f0cd3a1','.changed_files == 9','pulls/228/files?per_page=100','V5 requires absent prompt override','--keep-vars --strict'])assert.ok(policy.includes(needle),needle);
 assert.doesNotMatch(policy,/wrangler\s+secret\s+(?:put|delete)|wrangler\s+d1\s+execute|--strict=false|--no-strict/);
});

test('V5.1 release is separately authorized and pins exact friendly-tone source, deployed V5 base, and three changed files',()=>{
 for(const needle of ['check:CHECK_V51_ONLY|upload:UPLOAD_STAGING_V51_VERSION_ONLY|deploy:DEPLOY_STAGING_V51_WORKER','913ca29f-0784-445d-8cfe-9ada1d817276','4861c716-5534-435b-891a-8693ca1150b9','14a11ce423b07aa78a34aee2d93b6eac32377e6f','7228639b163a7a1cffba4f5bb7373185cdb232ea','repos/$GITHUB_REPOSITORY/pulls/230','experiment/staging-v5-friendly-tone-20261122','.changed_files == 3','pulls/230/files?per_page=100','all(.[]; .status == "modified")','V5 requires absent prompt override','--keep-vars --strict'])assert.ok(policy.includes(needle),needle);
 assert.doesNotMatch(policy,/wrangler\s+secret\s+(?:put|delete)|wrangler\s+d1\s+execute|--strict=false|--no-strict/);
});

test('V5.2 release separately authorizes exact retrieval source, deployed V5.1 base and four modified files',()=>{
 for(const needle of ['check:CHECK_V52_ONLY|upload:UPLOAD_STAGING_V52_VERSION_ONLY|deploy:DEPLOY_STAGING_V52_WORKER','a78318e8-aeab-4147-a4f4-54a8ef4f93e7','6c811259-165e-4e2a-a635-114b0970966b','d811d4b85d6c84f20c8afecf364d6f83fd558473','14a11ce423b07aa78a34aee2d93b6eac32377e6f','repos/$GITHUB_REPOSITORY/pulls/232','experiment/staging-v52-retrieval-20261122','.changed_files == 4','pulls/232/files?per_page=100','all(.[]; .status == "modified")','V5 requires absent prompt override','--keep-vars --strict'])assert.ok(policy.includes(needle),needle);
 assert.doesNotMatch(policy,/wrangler\s+secret\s+(?:put|delete)|wrangler\s+d1\s+execute|--strict=false|--no-strict/);
});

test('V5.3 release pins narrow natural-openings source, deployed V5.2 base and three modified files',()=>{
 for(const needle of ['check:CHECK_V53_ONLY|upload:UPLOAD_STAGING_V53_VERSION_ONLY|deploy:DEPLOY_STAGING_V53_WORKER','9fb255d7-b580-4f74-8305-e4e5954c53eb','d6188337-fc52-44b7-9dcc-4f14f807d140','ed5f5d602d9c1d100589bc338ff38acb013bec29','d811d4b85d6c84f20c8afecf364d6f83fd558473','repos/$GITHUB_REPOSITORY/pulls/234','experiment/staging-v53-natural-openings-20261122','.changed_files == 3','pulls/234/files?per_page=100','all(.[]; .status == "modified")','V5 requires absent prompt override','--keep-vars --strict'])assert.ok(policy.includes(needle),needle);
 assert.doesNotMatch(policy,/wrangler\s+secret\s+(?:put|delete)|wrangler\s+d1\s+execute|--strict=false|--no-strict/);
});

test('V5.4 release pins the 200-example candidate, deployed V5.3 base, and three modified files',()=>{
 for(const needle of ['check:CHECK_V54_ONLY|upload:UPLOAD_STAGING_V54_VERSION_ONLY|deploy:DEPLOY_STAGING_V54_WORKER','67eec240-dd19-405e-aedc-0af2143e9a38','292da9f1-327d-4654-bc26-be2ce5bc3563','fe583fa8be4acb867b2830fc843a5fdd59969866','ed5f5d602d9c1d100589bc338ff38acb013bec29','repos/$GITHUB_REPOSITORY/pulls/236','experiment/staging-v54-curated-corpus-20261122','.changed_files == 3','pulls/236/files?per_page=100','all(.[]; .status == "modified")','V5 requires absent prompt override','--keep-vars --strict'])assert.ok(policy.includes(needle),needle);
 assert.doesNotMatch(policy,/wrangler\s+secret\s+(?:put|delete)|wrangler\s+d1\s+execute|--strict=false|--no-strict/);
});
test('postflight waits only for exact Wrangler-returned version without re-deploying',()=>{
 const block=policy.slice(policy.indexOf('      - name: Guard and deploy only'),policy.indexOf('      - name: Delete ephemeral deployment config'));
 for(const needle of ['Current Version ID:','for attempt in {1..10}; do','--arg version "$deployed_version"','Unexpected deployment after upload; STOP','[[ "$observed" == 1 ]]','staging-bindings-after.fingerprint','/health','/v1/admin/dashboard'])assert.ok(block.includes(needle),needle);
 assert.equal((block.match(/wrangler deploy --config/g)||[]).length,1);
 assert.ok(block.indexOf('[[ "$observed" == 1 ]]')<block.indexOf('fingerprint "$RUNNER_TEMP/staging-new-settings.json"'));
});
