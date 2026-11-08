import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const content = readFileSync(new URL('../../content/content-script.js', import.meta.url), 'utf8');

test('reply preparation resolves a pending momentum gate before dispatching generation', () => {
  const prepare = content.slice(content.indexOf('async function prepareCurrent'), content.indexOf('async function refreshAccount'));
  assert.ok(prepare.indexOf('account.momentumGatePending===true') >= 0);
  assert.ok(prepare.indexOf('showMomentumGate') < prepare.indexOf('generateActive(requestId)'));
  assert.match(prepare, /if\(gate\?\.reminder\)[\s\S]*?showMomentumGate[\s\S]*?return;/);
  const generate = content.slice(content.indexOf('async function generateActive'), content.indexOf('function handleAction'));
  assert.match(generate, /current\.momentumGate\) return/);
});

test('dismissing a real gate confirms it before resuming the same bound editor; staging simulation never generates', () => {
  const handler = content.slice(content.indexOf("if(action==='momentum_gate_dismiss'"), content.indexOf('if (action === "toggle_auto_generate")'));
  assert.ok(handler.indexOf('REPLY_COPILOT_MOMENTUM') < handler.indexOf('generateActive(current.requestId)'));
  assert.match(handler, /matchedComposer\(current\.post\)\.editor!==current\.editor/);
  assert.match(handler, /current\.userTouchedComposer\|\|api\.composerAdapter\.hasContent/);
  const staging = handler.slice(handler.indexOf('if(current.stagingMomentumGate)'), handler.indexOf('void safeSend'));
  assert.doesNotMatch(staging, /generateActive|REPLY_COPILOT_GENERATE|insertOnce/);
});
