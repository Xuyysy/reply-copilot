import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
test('Epay MD5, Unicode signing and form creation run in real Workers workerd without Node crypto or outbound requests',async()=>{
 const key='runtime-test-epay-key',p={pid:'12345',money:'10.06',name:'支付宝 400 次',out_trade_no:'XRH_runtime123'};
 const expected=createHash('md5').update(Object.keys(p).sort().map(k=>`${k}=${p[k]}`).join('&')+key).digest('hex');
 let outbound=0;
 const mf=new Miniflare({workers:[{config:{name:'epay-runtime-test',compatibilityDate:'2026-10-14',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:`import {signEpay,epayCheckout} from './epay.js';export default {fetch(){return Response.json({signature:signEpay(${JSON.stringify(p)},${JSON.stringify(key)}),form:epayCheckout({gateway:'https://epay.example.test/',pid:'12345',key:${JSON.stringify(key)},apiOrigin:'https://api.example.test',webOrigin:'https://web.example.test'},{outTradeNo:'XRH_runtime123',amountFen:1006,name:'400 次'})});}};`},'epay.js':{type:'esm',contents:await readFile(new URL('../src/epay.js',import.meta.url),'utf8')},'md5.js':{type:'esm',contents:await readFile(new URL('../src/md5.js',import.meta.url),'utf8')}}}},dev:{outboundService:{type:'fetcher',handler:()=>{outbound++;throw Error('No outbound access expected');}}}}]});
 try{const r=await mf.dispatchFetch('http://local.test/'),data=await r.json();assert.equal(r.status,200);assert.equal(data.signature,expected);assert.equal(data.form.fields.money,'10.06');assert.equal(JSON.stringify(data).includes(key),false);assert.equal(outbound,0);}finally{await mf.dispose();}
});
