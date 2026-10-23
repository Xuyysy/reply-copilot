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
const {canonicalMk99,signMk99,verifyMk99,Mk99Client,mk99Config}=createRequire(import.meta.url)(path.join(temp,'client.cjs'));
const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
const privateKey=rsa.privateKey.export({type:'pkcs8',format:'pem'}).toString(),publicKey=rsa.publicKey.export({type:'spki',format:'pem'}).toString();
const cfg={baseUrl:'https://mk99.cn',pid:'20881234567890',key:'mock-key-never-real',signType:'MD5',notifySignType:'RSA',platformPublicKey:publicKey,privateKey,currency:'CNY',cashierOrigins:['https://cashier.example.test']};
const fields={pid:cfg.pid,out_trade_no:'XRH_mock_order',trade_no:'P_mock_1',total_amount:'10.06',paytype_code:'wxpay',trade_status:'TRADE_SUCCESS',timestamp:'1800000000'};

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
 assert.equal(r.trade_no,'P_mock_1');assert.equal(calls,1);
});
test('MK99 request failure is unknown, not payment failure; unsafe URL rejected',async()=>{
 const c=new Mk99Client(cfg,async()=>{throw new TypeError('https://secret.test/private key secret');});
 await assert.rejects(c.query('XRH_mock_order'),e=>e.code==='MK99_NETWORK_UNCERTAIN'&&!JSON.stringify(e).includes('secret.test'));
 for(const baseUrl of ['http://mk99.cn','https://mk99.cn/path','https://user:secret@mk99.cn','https://evil.test'])assert.throws(()=>new Mk99Client({...cfg,baseUrl}));
});
test('MK99 real readiness requires independently confirmed notification and exact CNY total contract',()=>{
 assert.throws(()=>mk99Config({MK99_PID:cfg.pid,MK99_KEY:cfg.key}));
});

test('MK99 abort timeout is classified distinctly and never retries',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const c=new Mk99Client(cfg,async(_url,init)=>{calls++;return await new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('private timeout message','AbortError'))));});
 const pending=c.query('XRH_mock_order');await Promise.resolve();await Promise.resolve();t.mock.timers.tick(10000);await assert.rejects(pending,e=>e.code==='MK99_TIMEOUT');assert.equal(calls,1);
});
