import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const panel=readFileSync(new URL("../src/components/admin/AdminBoltUtilPanel.tsx",import.meta.url),"utf8");
const compact=readFileSync(new URL("../src/components/admin/AdminBoltMerchantAcceptancePanel.tsx",import.meta.url),"utf8");
test("Production dashboard prioritizes real payment and hides verbose admin areas by default",()=>{
 assert.match(panel,/USDT 真实付款验证/);
 assert.match(panel,/boltutil-advanced-controls/);
 assert.match(panel,/<details className="rounded-xl border p-3" data-testid="boltutil-history-details" onToggle=\{event=>setHistoryOpen\(event\.currentTarget\.open\)\}>/);
 assert.match(panel,/AdminBoltMerchantAcceptancePanel active=\{active\}/);
 assert.doesNotMatch(panel,/data-testid="boltutil-production-readiness"/);
 assert.match(compact,/Production 单链实付测试/);
 assert.match(compact,/data-testid="boltutil-runtime-gates"/);
 assert.match(compact,/\.blockedBy/);
 assert.doesNotMatch(panel,/BOLTUTIL_API_KEY\s*=|BOLTUTIL_WEBHOOK_SECRET\s*=/);
 assert.match(panel,/USDT 收款总开关/);
 assert.match(panel,/write\("\/v1\/admin\/boltutil\/control"/);
});
