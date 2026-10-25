import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveStagingApiBase } from '../scripts/staging-build-config.mjs';
import { resolveProductionApiBase, resolveProductionTurnstileSiteKey } from '../scripts/production-build-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('Staging Pages build defaults to the Staging API when no build variable is inherited', () => {
  assert.equal(resolveStagingApiBase(undefined), 'https://api-staging.x-reply-helper.top');
});

test('Staging Pages build accepts the exact Staging API origin', () => {
  assert.equal(resolveStagingApiBase('https://api-staging.x-reply-helper.top'), 'https://api-staging.x-reply-helper.top');
});

test('Staging Pages build rejects Production or other API origins', () => {
  assert.throws(() => resolveStagingApiBase('https://api.x-reply-helper.top'), /Staging API/);
  assert.throws(() => resolveStagingApiBase('https://attacker.invalid'), /Staging API/);
});

test('Staging Pages build rejects malformed and non-HTTPS API origins', () => {
  assert.throws(() => resolveStagingApiBase('http://api-staging.x-reply-helper.top'), /HTTPS origin/);
  assert.throws(() => resolveStagingApiBase('not-a-url'), /valid URL/);
  assert.throws(() => resolveStagingApiBase(''), /valid URL/);
  assert.throws(() => resolveStagingApiBase('https://user:pass@api-staging.x-reply-helper.top'), /Staging API/);
  assert.throws(() => resolveStagingApiBase('https://api-staging.x-reply-helper.top/v1'), /Staging API/);
  assert.throws(() => resolveStagingApiBase('https://api-staging.x-reply-helper.top/?debug=1'), /Staging API/);
  assert.throws(() => resolveStagingApiBase('https://api-staging.x-reply-helper.top/#fragment'), /Staging API/);
});

test('Production Pages build requires the exact HTTPS Production API origin', () => {
  assert.equal(resolveProductionApiBase('https://api.x-reply-helper.top'), 'https://api.x-reply-helper.top');
  assert.throws(() => resolveProductionApiBase(undefined), /valid URL/);
  assert.throws(() => resolveProductionApiBase(''), /valid URL/);
  assert.throws(() => resolveProductionApiBase('https://api-staging.x-reply-helper.top'), /Production API/);
  assert.throws(() => resolveProductionApiBase('http://api.x-reply-helper.top'), /HTTPS origin/);
  assert.throws(() => resolveProductionApiBase('https://user:pass@api.x-reply-helper.top'), /Production API/);
  assert.throws(() => resolveProductionApiBase('https://api.x-reply-helper.top/custom'), /Production API/);
});

test('Production Pages build requires a non-test public Turnstile Site Key', () => {
  assert.equal(resolveProductionTurnstileSiteKey('AbCdEfGhIjKlMnOpQrStUvWxYz_123456'), 'AbCdEfGhIjKlMnOpQrStUvWxYz_123456');
  for (const value of [undefined, '', 'too-short', '1x00000000000000000000AA', '2x00000000000000000000AB', 'contains spaces and symbols!!']) {
    assert.throws(() => resolveProductionTurnstileSiteKey(value), /PUBLIC_TURNSTILE_SITE_KEY/);
  }
});

test('test and deploy scripts use the guarded Staging Pages build', async () => {
  const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const webPackage = JSON.parse(await readFile(path.join(root, 'web/package.json'), 'utf8'));
  const deployScript = await readFile(path.join(root, 'scripts/deploy-staging-pages.mjs'), 'utf8');
  const productionDeployScript = await readFile(path.join(root, 'scripts/deploy-production.mjs'), 'utf8');
  const productionBuildScript = await readFile(path.join(root, 'web/scripts/build-production.mjs'), 'utf8');
  assert.match(rootPackage.scripts.test, /build:staging/);
  assert.match(rootPackage.scripts['deploy:pages:staging'], /deploy-staging-pages/);
  assert.match(webPackage.scripts.test, /build:staging/);
  assert.match(webPackage.scripts['build:production'], /build-production/);
  assert.match(deployScript, /x-reply-helper-staging/);
  assert.match(deployScript, /codex\/v0\.4-credits/);
  assert.match(productionDeployScript, /build:production/);
  assert.match(productionBuildScript, /resolveProductionApiBase/);
  assert.match(productionBuildScript, /resolveProductionTurnstileSiteKey/);
  assert.match(productionBuildScript, /page\.includes\(turnstileSiteKey\)/);
});
