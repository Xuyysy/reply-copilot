import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const acceptance=readFileSync(new URL("../src/components/admin/AdminBoltMerchantAcceptancePanel.tsx",import.meta.url),"utf8");
const parent=readFileSync(new URL("../src/components/admin/AdminBoltUtilPanel.tsx",import.meta.url),"utf8");
const api=readFileSync(new URL("../../api/src/boltutil/admin.ts",import.meta.url),"utf8");
const client=readFileSync(new URL("../../api/src/boltutil/client.ts",import.meta.url),"utf8");
const router=readFileSync(new URL("../../api/src/index.ts",import.meta.url),"utf8");

test("Production five-chain merchant acceptance workbench is integrated and admin gated",()=>{
  assert.match(parent,/AdminBoltMerchantAcceptancePanel active=\{active\} language=\{language\} control=\{control\}/);
  assert.match(acceptance,/data-testid="boltutil-merchant-acceptance"/);
  for(const key of ["boltutil-merchant-key-probe","boltutil-runtime-gates",
    "boltutil-five-network-evidence","boltutil-acceptance-handoff"])
    assert.ok(acceptance.includes('data-testid="'+key+'"'),key);
  assert.match(router,/request\.method==="GET"&&path==="\/v1\/admin\/boltutil\/provider-ping"/);
  assert.match(api,/await requireAdminSession\(request,env\)/);
});

test("Merchant probe is only manually invoked and never creates USDT invoices",()=>{
  assert.match(acceptance,/onClick=\{\(\)=>void checkKey\(\)\}/);
  assert.match(acceptance,/api<PingResult>\("\/v1\/admin\/boltutil\/provider-ping"\)/);
  assert.match(acceptance,/control\?\.environment!=="production"/);
  assert.match(acceptance,/!control\.credentialsConfigured/);
  assert.match(acceptance,/generation\.current/);
  assert.match(client,/fetch\(HOST\+"\/api\/v1\/ping"/);
  assert.match(client,/method:"GET"/);
  const section=client.slice(client.indexOf("export async function boltProductionKeyProbe"));
  assert.ok(!section.includes("/order/create"));
  assert.ok(!section.includes("/order/status"));
  assert.ok(!section.includes("env.DB"));
  for(const unsafe of ['api("/v1/boltutil/orders"', 'write(', 'localStorage', 'sessionStorage',
    'BOLTUTIL_API_KEY:','BOLTUTIL_WEBHOOK_SECRET:', "adminBoltControl(request"])
    assert.ok(!acceptance.includes(unsafe),"Must not occur: "+unsafe);
});

test("Five-chain table shows token contracts as metadata, not receiving wallets",()=>{
  const expected={
    TRC20:"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    POLYGON:"0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    BEP20:"0x55d398326f99059fF775485246999027B3197955",
    ERC20:"0xdAC17F958D2ee523a2206206994597C13D831ec7",
    SOLANA:"Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
  };
  for(const [network,contract] of Object.entries(expected)){
    assert.ok(acceptance.includes('network:"'+network+'"'),network);
    assert.ok(acceptance.includes(contract),contract);
  }
  assert.match(acceptance,/NOT receiving wallet addresses/);
  assert.match(acceptance,/No API secrets, wallet addresses, customer records or provider raw response included/);
  assert.match(acceptance,/never constitute go-live approval/);
  assert.match(acceptance,/row\.blockedBy\.map/);
  assert.match(acceptance,/control\?\.readiness\.checks/);
});

test("Export contains only sanitized acceptance states, never secrets, wallet or customer data",()=>{
  assert.match(acceptance,/navigator\.clipboard\.writeText\(report\)/);
  assert.match(acceptance,/Merchant API key connectivity:/);
  assert.match(acceptance,/Wallet identity and enabled merchant routes: NOT VERIFIED/);
  assert.match(acceptance,/Signed webhook end-to-end delivery: NOT VERIFIED/);
  assert.match(acceptance,/On-chain settlement and exactly-once entitlement: NOT VERIFIED/);
  assert.doesNotMatch(acceptance,/probe\?\.merchant|probe\?\.wallet|probe\?\.raw/);
});
