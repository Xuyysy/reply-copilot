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
