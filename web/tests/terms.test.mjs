import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=()=>readFileSync(new URL('../dist/terms/index.html',import.meta.url),'utf8');
test('public terms contain bilingual service rules without internal launch placeholders',()=>{
 const html=page();
 assert.match(html,/data-zh="服务条款">Terms of Service/);
 assert.doesNotMatch(html,/内测使用说明|Beta terms|草案|Draft:|pending operator review|尚待经营者/);
 assert.match(html,/200 次免费生成额度/);
 assert.match(html,/200 free generations/);
 assert.match(html,/不会替你自动发布/);
 assert.match(html,/does not automatically publish X replies/);
 assert.match(html,/人民币售价已包含支付渠道成本，收银台不再额外加收/);
 assert.match(html,/Payment processing costs are included in the displayed CNY price/);
 assert.doesNotMatch(html,/¥\d|5\.00%|由商家承担/);
});
test('terms offer public support and retain refund and privacy routes',()=>{
 const html=page();
 for(const href of ['mailto:zake6678@outlook.com','/refunds/','/privacy/','/feedback/']) assert.ok(html.includes(`href="${href}"`));
 assert.match(html,/不限制消费者依法享有的权利/);
 assert.match(html,/does not limit statutory consumer rights/);
 assert.match(html,/反馈页面（需登录）/);
});
