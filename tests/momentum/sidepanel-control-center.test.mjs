import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('side panel is a control center and contains no duplicate AI generation or result pipeline',()=>{
 const js=readFileSync(new URL('../../sidepanel/sidepanel.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../../sidepanel/sidepanel.html',import.meta.url),'utf8');
 assert.doesNotMatch(js,/ReplyEngine|REPLY_COPILOT_CLAIM_PENDING|REPLY_COPILOT_GENERATE|recoverGeneration\(|async function generate\(/);
 assert.doesNotMatch(html,/id="(?:result|reply-cards|source-text|recover-generation|abandon-generation|regenerate)"|原帖内容|自然回复卡片/);
 assert.match(js,/remove\(PENDING_REQUEST_KEY\)/,'stale legacy selected-text work is explicitly discarded');
 assert.match(html,/侧栏只负责账户、设置和互动势能，不会在后台生成回复/);
 assert.match(js,/momentumControl\.refresh\(\{ensure:true\}\)/,'control center still recovers momentum state');
});
