import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const config=JSON.parse(readFileSync(path.join(root,"wrangler.jsonc"),"utf8"));

test("real payment stays disabled in local, staging, and production defaults",()=>{
  assert.equal(config.vars.PAYMENTS_ENABLED,"0");
  assert.equal(config.vars.PAYMENT_PROVIDER,"mock");
  assert.equal(config.vars.XIAODOU_WEBHOOKS_ENABLED,"0");
  for(const environment of ["staging","production"]){
    assert.equal(config.env[environment].vars.PAYMENTS_ENABLED,"0",environment);
    assert.equal(config.env[environment].vars.PAYMENT_PROVIDER,"xiaodou",environment);
    assert.equal(config.env[environment].vars.XIAODOU_WEBHOOKS_ENABLED,"0",environment);
  }
});
