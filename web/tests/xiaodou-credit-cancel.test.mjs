import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=readFileSync(fileURLToPath(new URL('../src/pages/checkout.astro',import.meta.url)),'utf8');
test('old unpaid credit order can be cancelled only through user confirmation and the original API order',()=>{
 assert.match(source,/id="cancel-unpaid-order"/);
 assert.match(source,/window\.confirm\(/);
 assert.match(source,/orderId\\)\\+"\\/local-cancel"/);
 assert.match(source,/confirm:true/);
 assert.match(source,/已打开的收银台仍可能收款|之前打开的收银台仍可能收款/);
 assert.match(source,/result\.orderStatus!=="closed"/);
 assert.match(source,/detail\.order\.status!=="closed"/);
 assert.doesNotMatch(source,/v1\/orders\b.*cancel-unpaid-order.*POST/);
});
