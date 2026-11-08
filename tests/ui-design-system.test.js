import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('sidepanel UI refresh preserves all live control IDs and presenter',()=>{
 const html=read('sidepanel/sidepanel.html');
 for(const id of ['momentum-control','account-refresh','quota-row','account-name','quick-style','quick-language','quick-length','quick-humor','quick-auto','quick-save-status','connect-register','connect-login','check-binding','settings','footer-settings','stat-week','stat-all','stat-copy','nav-website','nav-account','nav-pricing','nav-guide'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/design-tokens\.css/);
 assert.match(html,/class="dashboard-card pro-control"/);
 assert.match(html,/class="dashboard-card quick-settings" open/);
 assert.match(html,/class="dashboard-card usage-card"/);
 assert.match(html,/class="dashboard-card supported-flow"/);
 assert.match(html,/content\/momentum\.css/);
 const js=read('sidepanel/sidepanel.js');
 assert.match(js,/ReplyCopilotMomentumPresenter\.connect/);
 assert.doesNotMatch(js,/GENERATE_REPLY|REPLY_COPILOT_GENERATE/);
});
test('settings UI refresh preserves six panels, storage controls and tokens',()=>{
 const html=read('options/options.html');
 for(const id of ['voice-name','tone','interests','instructions','sample-input','add-sample','save-voice','reset-voice','default-style','language','length','humor','reply-style','save-replies','account-login','account-logout','account-purchase','account-manage','account-refresh','auto-generate','show-floating','show-momentum-entry','remember-position','reset-position','save-behavior','usage-summary','history-list','clear-history','clear-usage','reset-preferences'])
  assert.match(html,new RegExp('id="'+id+'"'));
 for(const key of ['voice','replies','account','behavior','data','about'])
  assert.match(html,new RegExp('data-panel="'+key+'"'));
 assert.match(html,/design-tokens\.css/);
 assert.doesNotMatch(html,/调试权限/);
});
test('brand tokens ship without external runtime dependencies',()=>{
 const css=read('content/design-tokens.css');
 for(const name of ['brand','ink','muted','canvas','surface','line','pro-surface','pro-line','focus'])
  assert.match(css,new RegExp('--xrh-'+name+':'));
 for(const path of ['sidepanel/sidepanel.css','options/options.css','content/inline-assistant.css'])
  assert.ok(read(path).length>1000);
 assert.doesNotMatch(css,/https?:\/\/|@import/);
});
