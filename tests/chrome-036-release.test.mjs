import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../manifest.json'));
const identity = JSON.parse(read('../config/extension-store-identity.json'));

test('Chrome 0.3.6 candidate retains the existing Production Store identity and no expanded permissions', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.3.6');
  assert.equal(manifest.version_name, '0.3.6');
  assert.equal(identity.id, 'fgfjajofkapebgphfidblngcjomkbdaj');
  assert.deepEqual(manifest.permissions, ['contextMenus', 'storage', 'sidePanel', 'clipboardWrite']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://x.com/*', 'https://twitter.com/*']);

  const builder = read('../scripts/build.js');
  const packer = read('../scripts/package-production-ci.py');
  assert.match(builder, /channel === "production"/);
  assert.match(builder, /extension-store-identity\.json/);
  assert.match(builder, /manifest\.externally_connectable/);
  assert.match(packer, /https:\/\/api\.x-reply-helper\.top\/\*/);
  assert.match(packer, /https:\/\/app\.x-reply-helper\.top\/\*/);
  assert.match(packer, /reply-copilot-production-/);
  assert.match(packer, /sha256/);
});

test('0.3.6 sidepanel preserves subscription quota, free fallback and prorated upgrade entry', () => {
  const html = read('../sidepanel/sidepanel.html');
  const script = read('../sidepanel/sidepanel.js');
  for (const id of ['subscription-quota', 'subscription-remaining', 'subscription-reset',
    'subscription-overage-text', 'subscription-overage-upgrade', 'subscription-overage-action']) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(html, /先使用订阅.*免费额度.*永久付费额度/);
  assert.match(script, /sub\.remainingToday===0/);
  assert.match(script, /account\.quota\?\.freeRemaining/);
  assert.match(script, /account\.quota\?\.paidRemaining/);
  assert.match(script, /subscription-checkout\/\?upgrade=1&plan=/);
  assert.match(script, /24\*60\*60\*1000/);
  assert.match(script, /pricing\/\#permanent-credits/);
  assert.doesNotMatch(script, /支付暂未开放/);
  assert.match(script, /生成次数已用完，可前往官网查看订阅与永久额度包/);
});

test('0.3.6 keeps the Chrome 0.3.5 Creator Momentum intro cleanup', () => {
  const presenter = read('../content/momentum-presenter.js');
  assert.match(presenter, /intro\.replaceChildren\(language, story\)/);
  assert.doesNotMatch(presenter, /以下为研究与规划说明。外部榜单/);
});
