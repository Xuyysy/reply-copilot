import test from 'node:test';import assert from 'node:assert/strict';
import {navigateVerifiedCashier}from '../src/lib/cashier-navigation.mjs';
test('verified cashier uses unchanged HTTPS URL with native privacy attributes in the same tab',()=>{
 const href='https://cashier.example.test/process/next?trade_no=synthetic%2Bonly&x=1';let anchor,clicked=false,removed=false;
 const document={createElement(tag){assert.equal(tag,'a');return anchor={click(){clicked=true;},remove(){removed=true;}};},body:{append(e){assert.equal(e,anchor);}}};
 navigateVerifiedCashier(href,{allowedOrigin:'https://cashier.example.test',document});assert.equal(anchor.href,href);assert.equal(anchor.target,'_self');assert.equal(anchor.rel,'noopener noreferrer');assert.ok(clicked&&removed);
});
test('cashier navigation refuses non-HTTPS, credentials, foreign origins and malformed allowlist values',()=>{
 for(const [url,allowedOrigin]of [['javascript:alert(1)','https://cashier.example.test'],['http://cashier.example.test/x','https://cashier.example.test'],['https://user:pass@cashier.example.test/x','https://cashier.example.test'],['https://evil.example/x','https://cashier.example.test'],['https://cashier.example.test:8443/x','https://cashier.example.test'],['https://cashier.example.test/x','https://cashier.example.test/path']])assert.throws(()=>navigateVerifiedCashier(url,{allowedOrigin,document:{createElement:()=>assert.fail('must not navigate')}}));
});
