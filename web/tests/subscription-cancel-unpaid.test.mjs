import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/components/account/SubscriptionCheckout.tsx',import.meta.url),'utf8');
test('subscription cancel needs explicit confirmation and merchant status before buy-again link',()=>{
 assert.match(source,/window\.confirm\(/);
 assert.match(source,/\/'\+id\+'\/cancel'/);
 assert.match(source,/order\.merchantProvider==='xiaodou'&&order\.status==='pending'/);
 assert.match(source,/\['closed','failed'\]\.includes\(order\.status\)/);
});
