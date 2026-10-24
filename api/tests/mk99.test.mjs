import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign as nodeSign} from 'node:crypto';
import {buildSync} from 'esbuild';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const temp=mkdtempSync(path.join(tmpdir(),'mk99-test-'));
buildSync({entryPoints:['api/src/mk99.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(temp,'client.cjs')});
const {canonicalMk99,signMk99,verifyMk99,verifyAndParseMk99Notification,Mk99Client,mk99Config,parseMk99AmountFen,parseMk99Form}=createRequire(import.meta.url)(path.join(temp,'client.cjs'));
const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
const privateKey=rsa.privateKey.export({type:'pkcs8',format:'pem'}).toString(),publicKey=rsa.publicKey.export({type:'spki',format:'pem'}).toString();
const cfg={baseUrl:'https://mk99.cn',pid:'20881234567890',key:'mock-key-never-real',signType:'MD5',notifySignType:'RSA',platformPublicKey:publicKey,privateKey,currency:'CNY',cashierOrigins:['https://cashier.example.test']};
const fields={pid:cfg.pid,out_trade_no:'XRH_mock_order',trade_no:'P_mock_1',total_amount:'10.06',subject:'Mock product',paytype_code:'wxpay',channel_id:'1',trade_status:'TRADE_SUCCESS',timestamp:'1800000000'};

test('MK99 canonical matches PHP decoded form values, excludes empty/sign fields and preserves zero',async()=>{
 const p={z:'0',subject:'中文 + 空格 & x=1',empty:'',nullable:null,a:'1',sign:'ignored',sign_type:'MD5'};
 assert.equal(canonicalMk99(p),'a=1&subject=中文 + 空格 & x=1&z=0');
 const expected=createHash('md5').update('a=1&subject=中文 + 空格 & x=1&z=0&key='+cfg.key).digest('hex').toUpperCase();
 assert.equal(await signMk99(p,cfg),expected);
});
test('MK99 RSA request signature verified independently with WebCrypto',async()=>{
 const signature=await signMk99(fields,{...cfg,signType:'RSA'});
 const {verify}=await import('node:crypto');
 assert.equal(verify('RSA-SHA256',Buffer.from(canonicalMk99(fields)),publicKey,Buffer.from(signature,'base64')),true);
});
test('MK99 RSA notifications cannot downgrade to MD5 or accept tampering',async()=>{
 const p={...fields,sign_type:'RSA',sign:nodeSign('RSA-SHA256',Buffer.from(canonicalMk99(fields)),privateKey).toString('base64')};
 assert.equal(await verifyMk99(p,cfg),true);
 assert.equal(await verifyMk99({...p,total_amount:'0.01'},cfg),false);
 assert.equal(await verifyMk99({...p,sign_type:'MD5'},cfg),false);
});
test('MK99 request uses fixed HTTPS path, detached fetch, form POST, no redirects or automatic retries',async()=>{
 let calls=0;
 const c=new Mk99Client(cfg,async function(url,init){assert.equal(this,undefined);calls++;assert.equal(url,'https://mk99.cn/openapi/pay/create');assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');const p=new URLSearchParams(init.body);assert.equal(p.get('total_amount'),'10.06');assert.equal(p.get('client_ip'),'8.8.8.8');return Response.json({code:1,data:{trade_no:'P_mock_1',out_trade_no:'XRH_mock_order',pay_url:'https://cashier.example.test/pay'}});});
 const r=await c.create({outTradeNo:'XRH_mock_order',amountFen:1006,paytype:'wxpay',subject:'中文',clientIp:'8.8.8.8',notifyUrl:'https://api.example.test/notify',returnUrl:'https://web.example.test/account/'});
 assert.deepEqual(r,{provider:'mk99',tradeNo:'P_mock_1',outTradeNo:'XRH_mock_order',payUrl:'https://cashier.example.test/pay'});assert.equal(calls,1);
});
test('MK99 request failure is unknown, not payment failure; unsafe URL rejected',async()=>{
 const c=new Mk99Client(cfg,async()=>{throw new TypeError('https://secret.test/private key secret');});
 await assert.rejects(c.query('XRH_mock_order'),e=>e.code==='MK99_NETWORK_UNCERTAIN'&&!JSON.stringify(e).includes('secret.test'));
 for(const baseUrl of ['http://mk99.cn','https://mk99.cn/path','https://user:secret@mk99.cn','https://evil.test'])assert.throws(()=>new Mk99Client({...cfg,baseUrl}));
});
test('MK99 real readiness requires independently confirmed notification and exact CNY total contract',()=>{
 assert.throws(()=>mk99Config({MK99_PID:cfg.pid,MK99_KEY:cfg.key}));
});

test('MK99 has an independent exact yuan parser and rejects unverified or inexact values',()=>{
 assert.equal(parseMk99AmountFen('10.59'),1059);
 assert.equal(parseMk99AmountFen('10'),1000);
 assert.equal(parseMk99AmountFen('0.01'),1);
 assert.equal(parseMk99AmountFen(10.59,'10.59'),1059);
 for(const value of [10.59,NaN,Infinity,-1,0,'10.590','1e1',' 10.59','10.5x','0','-0.01',null,{},[]])assert.throws(()=>parseMk99AmountFen(value));
 for(const [value,token] of [[10.59,'1.059e1'],[10.59,'10.590'],[10.59,'10.58'],[1e100,'1e100']])assert.throws(()=>parseMk99AmountFen(value,token));
});

test('MK99 form decoding is independent and rejects duplicate, malformed, or unsafe fields',()=>{
 assert.deepEqual({...parseMk99Form('pid=20881234567890&total_amount=10.59&subject=%E4%B8%AD%E6%96%87+reply')},{pid:'20881234567890',total_amount:'10.59',subject:'中文 reply'});
 for(const body of ['sign=a&sign=b','%zz=1','bad key=1','a=%FF','a='+('x'.repeat(8193))])assert.throws(()=>parseMk99Form(body));
});

test('MK99 query follows documented yuan-string contract and returns a typed internal event',async()=>{
 const c=new Mk99Client(cfg,async(url,init)=>{assert.equal(url,'https://mk99.cn/openapi/pay/query');assert.equal(init.method,'POST');const p=new URLSearchParams(init.body);assert.equal(p.get('out_trade_no'),'XRH_mock_order');return Response.json({code:1,data:{trade_no:'P_mock_1',out_trade_no:'XRH_mock_order',total_amount:'10.59',trade_status:'TRADE_SUCCESS'}});});
 assert.deepEqual(await c.query('XRH_mock_order'),{provider:'mk99',verification:'authenticated_query',tradeNo:'P_mock_1',outTradeNo:'XRH_mock_order',amountFen:1059,tradeStatus:'TRADE_SUCCESS'});
});

test('MK99 query normalizes documented pending and closed statuses but rejects unknown or mismatched identity',async()=>{
 for(const [tradeStatus,expected] of [['WAIT_BUYER_PAY','WAIT_BUYER_PAY'],['TRADE_CLOSED','TRADE_CLOSED']]){
  const c=new Mk99Client(cfg,async()=>Response.json({code:1,data:{trade_no:'P_mock_1',out_trade_no:'XRH_mock_order',total_amount:'10.59',trade_status:tradeStatus}}));
  assert.equal((await c.query('XRH_mock_order')).tradeStatus,expected);
 }
 const wrongOrder=new Mk99Client(cfg,async()=>Response.json({code:1,data:{trade_no:'P_mock_1',out_trade_no:'other',total_amount:'10.59',trade_status:'TRADE_SUCCESS'}}));
 await assert.rejects(wrongOrder.query('XRH_mock_order'),e=>e.code==='MK99_ORDER_MISMATCH');
 const wrongTrade=new Mk99Client(cfg,async()=>Response.json({code:1,data:{trade_no:'bad trade',out_trade_no:'XRH_mock_order',total_amount:'10.59',trade_status:'TRADE_SUCCESS'}}));
 await assert.rejects(wrongTrade.query('XRH_mock_order'),e=>e.code==='MK99_ORDER_MISMATCH');
 const unknownStatus=new Mk99Client(cfg,async()=>Response.json({code:1,data:{trade_no:'P_mock_1',out_trade_no:'XRH_mock_order',total_amount:'10.59',trade_status:'SUCCESS'}}));
 await assert.rejects(unknownStatus.query('XRH_mock_order'),e=>e.code==='MK99_STATUS_INVALID');
});

test('MK99 notification parser emits no trusted event before signature validation and typed event after validation',async()=>{
 const notification={...fields,sign_type:'RSA',sign:nodeSign('RSA-SHA256',Buffer.from(canonicalMk99(fields)),privateKey).toString('base64')};
 assert.equal(await verifyAndParseMk99Notification({...notification,sign:'bad'},fields.out_trade_no,cfg),null);
 const event=await verifyAndParseMk99Notification(notification,fields.out_trade_no,cfg);
 assert.equal(event.verification,'verified_notification');assert.equal(event.amountFen,1006);assert.equal(event.tradeStatus,'TRADE_SUCCESS');
});

test('MK99 query accepts observed decimal-number JSON only from its exact non-exponent token',async()=>{
 const valid=new Mk99Client(cfg,async()=>new Response('{"code":1,"data":{"trade_no":"P_mock_1","out_trade_no":"XRH_mock_order","total_amount":10.59,"trade_status":"TRADE_SUCCESS"}}',{headers:{'Content-Type':'application/json'}}));
 assert.equal((await valid.query('XRH_mock_order')).amountFen,1059);
 for(const token of ['1.059e1','10.590']){
  const c=new Mk99Client(cfg,async()=>new Response(`{"code":1,"data":{"trade_no":"P_mock_1","out_trade_no":"XRH_mock_order","total_amount":${token},"trade_status":"TRADE_SUCCESS"}}`,{headers:{'Content-Type':'application/json'}}));
  await assert.rejects(c.query('XRH_mock_order'),e=>e.code==='MK99_AMOUNT_INVALID');
 }
 const different=new Mk99Client(cfg,async()=>new Response('{"code":1,"data":{"trade_no":"P_mock_1","out_trade_no":"XRH_mock_order","total_amount":10.58,"trade_status":"TRADE_SUCCESS"}}',{headers:{'Content-Type':'application/json'}}));
 assert.equal((await different.query('XRH_mock_order')).amountFen,1058);
 const missing=new Mk99Client(cfg,async()=>Response.json({code:1,data:{trade_no:'P_mock_1',out_trade_no:'XRH_mock_order',trade_status:'TRADE_SUCCESS'}}));
 await assert.rejects(missing.query('XRH_mock_order'),e=>e.code==='MK99_AMOUNT_INVALID');
 const duplicate=new Mk99Client(cfg,async()=>new Response('{"code":1,"data":{"trade_no":"P_mock_1","out_trade_no":"XRH_mock_order","total_amount":10.59,"total_amount":10.59,"trade_status":"TRADE_SUCCESS"}}',{headers:{'Content-Type':'application/json'}}));
 await assert.rejects(duplicate.query('XRH_mock_order'),e=>e.code==='MK99_RESPONSE_INVALID');
 const malformedMerchant=new Mk99Client(cfg,async()=>Response.json({code:1,data:{pid:20881234567890,trade_no:'P_mock_1',out_trade_no:'XRH_mock_order',total_amount:'10.59',trade_status:'TRADE_SUCCESS'}}));
 await assert.rejects(malformedMerchant.query('XRH_mock_order'),e=>e.code==='MK99_RESPONSE_INVALID');
});

test('MK99 abort timeout is classified distinctly and never retries',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const c=new Mk99Client(cfg,async(_url,init)=>{calls++;return await new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('private timeout message','AbortError'))));});
 const pending=c.query('XRH_mock_order');await Promise.resolve();await Promise.resolve();t.mock.timers.tick(10000);await assert.rejects(pending,e=>e.code==='MK99_TIMEOUT');assert.equal(calls,1);
});
