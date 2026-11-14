import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pricing=readFileSync(new URL('../src/pages/pricing.astro',import.meta.url),'utf8');
const checkout=readFileSync(new URL('../src/pages/usdt-checkout.astro',import.meta.url),'utf8');
const admin=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');
const panel=readFileSync(new URL('../src/components/admin/AdminBoltUtilPanel.tsx',import.meta.url),'utf8');

test('Staging pricing advertises USDT independent of unavailable merchant configuration',()=>{
 assert.match(pricing,/id="usdt-payment-method"/);
 assert.match(pricing,/TRON \/ Polygon \/ BNB Smart Chain/);
 assert.match(pricing,/href="\/usdt-checkout\/"/);
 const subs=pricing.slice(pricing.indexOf("const unavailable=document.createElement"),pricing.indexOf("box.append(card);",pricing.indexOf("const unavailable=document.createElement")));
 assert.match(subs,/const usdt=document.createElement/);
 assert.match(subs,/const upgrade=document.createElement/);
 assert.doesNotMatch(subs,/if\(boltutilAvailable\)\s*\{/);
 const packs=pricing.slice(pricing.indexOf("function render(){const box"),pricing.indexOf("async function load(){"));
 assert.match(packs,/const usdt=document.createElement/);
 assert.doesNotMatch(packs,/if\(boltutilAvailable\)\s*\{/);
});
test('three networks are visible for checkout preview, but new order buttons are gated by availability',()=>{
 for(const code of ["TRC20","POLYGON","BEP20"])assert.match(checkout,new RegExp('value="'+code+'"'));
 assert.match(checkout,/<div id="bolt-chain-picker"[^>]*>/);
 assert.doesNotMatch(checkout,/<div id="bolt-chain-picker"[^>]*\shidden\b/);
 assert.match(checkout,/chain\.disabled=true;/);
 assert.match(checkout,/if\(!availability\.available/);
 assert.match(checkout,/chain\.disabled=false;/);
 assert.match(checkout,/report\("支持 TRON \(TRC20\)、Polygon 和 BNB/);
 assert.match(checkout,/await api<\{order:Order\}>\("\/v1\/boltutil\/orders"/);
});
test('Admin V2 has visible independent USDT tab including mobile nav, not only a hidden backend API',()=>{
 assert.match(admin,/import AdminBoltUtilPanel from/);
 assert.match(admin,/\["boltutil",t\("USDT 收款","USDT payments"\)\]/);
 assert.match(admin,/<TabsContent value="boltutil"><AdminBoltUtilPanel active=\{tab==="boltutil"\}/);
 assert.match(panel,/data-testid="admin-boltutil-usdt"/);
 assert.match(panel,/\/v1\/admin\/boltutil\/orders/);
 assert.match(panel,/\/v1\/boltutil\/availability/);
 for(const code of ["TRC20","POLYGON","BEP20"])assert.match(panel,new RegExp('code:"'+code+'"'));
 assert.match(panel,/Read-only:/);
 assert.doesNotMatch(panel,/<Button[^>]*onClick=\{[^}]*post/i);
 assert.match(panel,/币种单独记录/);
});
