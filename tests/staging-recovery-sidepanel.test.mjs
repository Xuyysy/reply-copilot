import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Staging sidebar exposes opt-in multi-Reply recovery without editor insertion or automatic posting',()=>{
  const html=read('sidepanel/sidepanel.html');
  const ui=read('sidepanel/sidepanel.js');
  const worker=read('background/service-worker.js');
  for(const id of ['pending-replies','pending-replies-list','pending-replies-status','pending-replies-drafts'])
    assert.ok(html.includes('id="'+id+'"'),'missing '+id);
  assert.match(html,/点击后才会请求服务端恢复/);
  assert.match(ui,/REPLY_COPILOT_LIST_PENDING_GENERATIONS/);
  assert.match(ui,/REPLY_COPILOT_RECOVER_GENERATION',abandon:false,requestId/);
  assert.match(ui,/result\.state==='ready'&&result\.requestId===requestId/);
  assert.match(ui,/navigator\.clipboard\.writeText\(value\)/);
  assert.match(ui,/paragraph\.textContent=label\+'：'\+value/);
  assert.doesNotMatch(ui,/innerHTML\s*=\s*.*repl(?:ies|y)/);
  assert.match(worker,/if\(message\?\.type === "REPLY_COPILOT_LIST_PENDING_GENERATIONS"\)/);
  assert.match(worker,/if\(!fromExtensionPage\)\{sendResponse\(\{ok:false\}\);return false;\}/);
  assert.match(worker,/deliveryCoordinator\.listPending\(\)/);
  assert.match(worker,/recoverPending\(\{abandon:message\.abandon,\.\.\./);
});

test('Staging recovery sidebar invalidates stale account-bound list and result on token rotation',()=>{
  const ui=read('sidepanel/sidepanel.js');
  assert.match(ui,/if\(area==='local'&&changes\.replyCopilotAccountToken\)\{\s*pendingListEpoch\+\+;\s*recoveredReplies=null/);
  assert.match(ui,/const epoch=\+\+pendingListEpoch/);
  assert.match(ui,/if\(epoch!==pendingListEpoch\)return/);
  assert.match(ui,/const epoch=pendingListEpoch/);
  assert.match(ui,/section\.classList\.toggle\('hidden',list\.children\.length===0&&!recoveredReplies\)/);
});
