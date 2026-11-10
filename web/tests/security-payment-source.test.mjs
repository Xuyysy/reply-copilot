import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const panel=await readFile(new URL('../src/components/admin/SecurityPaymentPanel.tsx',import.meta.url),'utf8');
const router=await readFile(new URL('../../api/src/index.ts',import.meta.url),'utf8');
test('security payment panel uses the exact registered API paths',()=>{
 const paths=[...panel.matchAll(/(?:read|write)\('(\/[^']+)'/g)].map(m=>m[1]);
 assert.equal(paths.length,6);
 for(const path of paths){assert.ok(path.startsWith('/v1/admin/'),path);assert.ok(router.includes(`"${path}"`),path);}
});
test('security mutations lock synchronously, clear password inputs, and show confirmation and feedback',()=>{
 assert.match(panel,/if\(busy\|\|mutationGuard\.current\)return/);
 assert.match(panel,/mutationGuard\.current=true;setPending\(true\)/);
 assert.match(panel,/finally\{mutationGuard\.current=false;setPending\(false\)/);
 assert.match(panel,/setOld\(''\);setNew\(''\);setConfirm\(''\)/);
 assert.match(panel,/setConfirmEnable\(true\)/);
 assert.match(panel,/onClick=\{\(\)=>void togglePurchase\(true\)\}/);
 assert.match(panel,/role="status"/);
 assert.ok(panel.includes('已开启')&&panel.includes('已关闭'));
 assert.doesNotMatch(panel,/String\(control\./);
});

test('RSA2 read-only check supplies its own audit reason and reports errors next to the button',()=>{
 assert.match(panel,/write\('\/v1\/admin\/payment-platform-check',\{reason:'Xiaodou RSA2 read-only connectivity diagnostic'\}\)/);
 assert.match(panel,/platformChecking\?t\('正在检查小豆 RSA2/);
 assert.match(panel,/platformCheckError&&<p role="alert"/);
 assert.match(panel,/setPlatformCheck\(null\);setPlatformCheckError\(''\)/);
 assert.match(panel,/disabled=\{locked\} aria-busy=\{platformChecking\}/);
 assert.doesNotMatch(panel,/disabled=\{locked\|\|!control\.providers\.rsa2\.credentialsConfigured\}/);
});
