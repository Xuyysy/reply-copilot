import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AccountClient} from '../../services/account-client.js';

test('side panel is a control center and contains no duplicate AI generation or result pipeline',()=>{
 const js=readFileSync(new URL('../../sidepanel/sidepanel.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../../sidepanel/sidepanel.html',import.meta.url),'utf8');
 assert.doesNotMatch(js,/ReplyEngine|REPLY_COPILOT_CLAIM_PENDING|REPLY_COPILOT_GENERATE|recoverGeneration\(|async function generate\(/);
 assert.doesNotMatch(html,/id="(?:result|reply-cards|source-text|recover-generation|abandon-generation|regenerate)"|原帖内容|自然回复卡片/);
 assert.match(js,/remove\(PENDING_REQUEST_KEY\)/,'stale legacy selected-text work is explicitly discarded');
 assert.match(html,/侧栏只负责账户、设置和互动势能，不会在后台生成回复/);
 assert.match(js,/momentumControl\.refresh\(\{ensure:true\}\)/,'control center still recovers momentum state');
});

test('partner navigation uses the existing same-origin website opener for both channels',async()=>{
 const html=readFileSync(new URL('../../sidepanel/sidepanel.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../../sidepanel/sidepanel.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../../sidepanel/sidepanel.css',import.meta.url),'utf8');
 assert.equal((html.match(/id="nav-partners"/g)||[]).length,1);
 assert.match(html,/<div class="dashboard-card quick-links"><h2>快捷入口<\/h2><div class="dashboard-actions"><button id="nav-partners" type="button" class="button partner-nav-button">推广合伙人/);
 assert.match(css,/\.quick-links \.partner-nav-button\s*\{[^}]*grid-column:1\/-1/);
 const raw=js.match(/'nav-partners':'([^']+)'/);
 assert.ok(raw);
 assert.equal(raw[1],'/partners');
 assert.match(js,/accountClient\.openWebsite\(destinations\[button\.id\]\)/);
 for(const [channel,websiteUrl] of [['staging','https://staging.x-reply-helper.top'],['production','https://app.x-reply-helper.top']]){
  const opened=[];
  const client=new AccountClient({config:{channel,websiteUrl,allowedHttpHosts:[]},storage:{get(){throw Error('navigation must not access credentials');}},fetchImpl(){throw Error('navigation must not call APIs');},openTab:async url=>{opened.push(url);}});
  await client.openWebsite(raw[1]);
  assert.deepEqual(opened,[websiteUrl+'/partners']);
  await assert.rejects(client.openWebsite('https://untrusted.example/partners'));
  assert.equal(opened.length,1);
 }
});
