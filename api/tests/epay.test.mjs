import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { md5Hex, signEpay, verifyEpay, parseEpayParameters, moneyToFen, epayCheckout } from '../src/epay.js';
const key='mock-epay-key-not-a-real-credential';
const reference=(p)=>createHash('md5').update(Object.keys(p).filter(k=>!['sign','sign_type'].includes(k)&&p[k]!=='').sort().map(k=>`${k}=${p[k]}`).join('&')+key,'utf8').digest('hex');
test('Workers-compatible MD5 matches independent Node vectors including Unicode and multiple blocks',()=>{
 for(const text of ['', 'abc', '支付宝充值', 'x'.repeat(1000)])assert.equal(md5Hex(text),createHash('md5').update(text).digest('hex'));
});
test('Epay signs decoded values with ASCII sorting, excludes empty/sign fields, never exposes Key',()=>{
 const p={pid:'12345',money:'10.06',name:'400 次 & 回复',empty:'',sign:'ignored',sign_type:'MD5',out_trade_no:'XRH_test123'};
 assert.equal(signEpay(p,key),reference(p));
 assert.ok(verifyEpay({...p,sign:reference(p)},key));
 assert.equal(verifyEpay({...p,money:'0.01',sign:reference(p)},key),false);
 assert.equal(verifyEpay({...p,sign_type:'RSA',sign:reference(p)},key),false);
});
test('Epay rejects duplicate and malformed query parameters and oversized input',()=>{
 for(const query of ['pid=1&pid=2','money=%ZZ','x='+ 'x'.repeat(9000),'bad-key=x'])assert.throws(()=>parseEpayParameters(query));
 assert.equal(parseEpayParameters('name=%E4%B8%AD%E6%96%87&money=10.06').name,'中文');
});
test('Epay decimal money is parsed in integer fen without floating-point rounding',()=>{
 for(const [money,fen] of [['10.06',1006],['20.21',2021],['33.41',3341],['1.1',110],['0.01',1]])assert.equal(moneyToFen(money),fen);
 for(const money of ['1e2','1.001','-1','0','NaN',' 10.06','90071992547409.92'])assert.throws(()=>moneyToFen(money));
});
test('Checkout uses only server-controlled gateway and amount; browser receives signature but no Key',()=>{
 const c=epayCheckout({gateway:'https://gateway.example.test/',pid:'12345',key,apiOrigin:'https://api.example.test',webOrigin:'https://web.example.test'}, {outTradeNo:'XRH_test123',amountFen:1006,name:'400 次'});
 assert.equal(c.action,'https://gateway.example.test/submit.php');assert.equal(c.method,'POST');assert.equal(c.fields.money,'10.06');assert.equal(c.fields.type,'alipay');assert.equal(c.fields.sign,reference(c.fields));assert.equal(JSON.stringify(c).includes(key),false);
 assert.equal(c.fields.notify_url,'https://api.example.test/v1/payments/xiaodou/epay/notify');
 for(const gateway of ['http://gateway.example.test/','https://u:p@gateway.example.test/','https://gateway.example.test/mapi.php','https://gateway.example.test/?target=x'])assert.throws(()=>epayCheckout({gateway,pid:'12345',key,apiOrigin:'https://api.example.test',webOrigin:'https://web.example.test'},{outTradeNo:'XRH_test123',amountFen:1006,name:'400 次'}));
});
