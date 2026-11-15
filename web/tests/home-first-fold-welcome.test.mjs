import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const home=readFileSync(new URL('../src/pages/index.astro',import.meta.url),'utf8');
test('first-fold welcome offer visibly shows 200 free replies in both languages before the hero CTA',()=>{
 const first=home.split('<div class="momentum-v2-copy">')[1]?.split('<div class="momentum-v2-device"')[0]??'';
 assert.match(first,/class="momentum-v2-trial-callout"/);
 assert.match(first,/data-zh="新用户免费体验"/);
 assert.match(first,/class="momentum-v2-trial-count">200</);
 assert.match(first,/data-zh="次 AI 回复"/);
 assert.match(first,/New users get/);
 assert.match(first,/free AI replies/);
 assert.ok(first.indexOf('momentum-v2-trial-callout')<first.indexOf('momentum-v2-actions'));
 assert.match(first,/data-reply-assistant-cta/);
});
test('welcome offer accurately discloses the existing email and extension binding requirement',()=>{
 assert.match(home,/data-zh="验证邮箱并绑定浏览器插件后领取 · 无需信用卡"/);
 assert.match(home,/Verify your email and link the browser extension to claim/);
 assert.match(home,/class="momentum-v2-trial-callout"/);
 assert.match(home,/@media\(max-width:520px\)/);
 assert.doesNotMatch(home,/\/v1\/.*(?:grant|credit-grant|simulate-payment)/);
});
