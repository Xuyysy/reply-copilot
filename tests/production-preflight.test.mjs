import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productionBlockers,verifyFreshMigrations} from '../scripts/production-preflight.mjs';
const config=JSON.parse(readFileSync(new URL('../api/deploy/production.wrangler.json',import.meta.url))),staging=JSON.parse(readFileSync(new URL('../api/wrangler.jsonc',import.meta.url))).env.staging;
test('production preparation accepts the isolated D1 UUID and fixed store identity',()=>{
 const errors=productionBlockers(config,staging);assert.equal(errors.length,0);assert.ok(!errors.some(e=>e.includes('Extension ID')));
 const bad=structuredClone(config);bad.d1_databases[0].database_id=staging.d1_databases[0].database_id;assert.ok(productionBlockers(bad,staging).some(e=>e.includes('D1')));
});
test('all fresh Production migrations preserve empty business data and closed purchases',()=>{
 const result=verifyFreshMigrations();assert.equal(result.migrationCount,17);assert.equal(result.businessTablesEmpty,true);assert.equal(result.purchaseEnabled,false);
});
