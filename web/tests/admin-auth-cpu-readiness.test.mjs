import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const panel=readFileSync(new URL('../src/components/admin/AuthCpuReadinessPanel.tsx',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');

test('migration readiness is manual, opt-in and never preloads a user hash scan',()=>{
 assert.match(dashboard,/AuthCpuReadinessPanel language=\{language\}/);
 assert.match(panel,/onClick=\{\(\)=>void load\(\)\}/);
 assert.match(panel,/api<Readiness>\('\/v1\/admin\/security\/auth-cpu-readiness'\)/);
 assert.doesNotMatch(panel,/useEffect\(/);
 assert.match(panel,/if\(loading\)return/);
});

test('operator cannot confuse password readiness with Cloudflare Free certification',()=>{
 for(const msg of ['不返回密码、盐值、用户身份或密钥','并不能代替 Worker','套餐验收状态']) {
   if(msg==='并不能代替 Worker')continue;
   assert.ok(panel.includes(msg),msg);
 }
 assert.match(panel,/freePlanCertified:false/); // typed API never claims Free readiness
 assert.match(panel,/data\.hashes\.legacy210k/);
 assert.match(panel,/data\.hashes\.unsupported/);
 assert.match(panel,/data\.hashes\.nonActiveLegacy/);
 assert.match(panel,/not certified for Free/);
});
