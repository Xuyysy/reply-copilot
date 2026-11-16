import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const acceptance=readFileSync(new URL("../src/components/admin/AdminBoltMerchantAcceptancePanel.tsx",import.meta.url),"utf8");
const parent=readFileSync(new URL("../src/components/admin/AdminBoltUtilPanel.tsx",import.meta.url),"utf8");
const api=readFileSync(new URL("../../api/src/boltutil/admin.ts",import.meta.url),"utf8");
const client=readFileSync(new URL("../../api/src/boltutil/client.ts",import.meta.url),"utf8");
const router=readFileSync(new URL("../../api/src/index.ts",import.meta.url),"utf8");
test("Compact Production acceptance retains authenticated read-only provider access",()=>{
 assert.match(parent,/AdminBoltMerchantAcceptancePanel active=\{active\} language=\{language\} control=\{control\}/);
 assert.match(acceptance,/data-testid="boltutil-merchant-acceptance"/);
 assert.match(acceptance,/data-testid="boltutil-merchant-key-probe"/);
 assert.match(router,/request\.method==="GET"&&path==="\/v1\/admin\/boltutil\/provider-ping"/);
 assert.match(api,/await requireAdminSession\(request,env\)/);
 assert.match(acceptance,/onClick=\{\(\)=>void checkKey\(\)\}/);
 assert.match(acceptance,/api<PingResult>\("\/v1\/admin\/boltutil\/provider-ping"\)/);
 assert.match(acceptance,/control\?\.environment!=="production"/);
 assert.match(acceptance,/!control\.credentialsConfigured/);
 assert.match(acceptance,/generation\.current/);
 assert.match(client,/fetch\(HOST\+"\/api\/v1\/ping"/);
 const probe=client.slice(client.indexOf("export async function boltProductionKeyProbe"));
 for(const unexpected of ["/order/create","/order/status","env.DB"])assert.ok(!probe.includes(unexpected));
});
test("Five-chain real-test UI remains fail-closed and small",()=>{
 assert.match(acceptance,/data-testid="boltutil-five-network-evidence"/);
 for(const chain of ["TRC20","POLYGON","BEP20","ERC20","SOLANA"])assert.ok(acceptance.includes('"'+chain+'"'));
 assert.match(acceptance,/chain\?\.acceptingNewOrders/);
 assert.match(acceptance,/real checkout \(subject to backend gate\)/i);
 assert.match(acceptance,/blockedBy/);
 assert.match(acceptance,/A return redirect is not payment proof/);
 assert.doesNotMatch(acceptance,/navigator\.clipboard|localStorage|sessionStorage/);
 for(const unsafe of ['write(', '/v1/boltutil/orders"', 'BOLTUTIL_API_KEY:', 'BOLTUTIL_WEBHOOK_SECRET:',
   'AdminBoltReconciliationPanel', '/api/v1/order/create'])
   assert.ok(!acceptance.includes(unsafe),unsafe);
});
