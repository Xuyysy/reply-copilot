import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {buildSync} from 'esbuild';
import {createHash} from 'node:crypto';

test('MK99 create/query use native Workers fetch and MD5 without Illegal invocation or real outbound access',async()=>{
 const script=buildSync({stdin:{contents:`import {Mk99Client} from './api/src/mk99.ts';export default {async fetch(){const client=new Mk99Client({baseUrl:'https://mk99.cn',pid:'20881234567890',key:'runtime-mock-key',signType:'MD5',notifySignType:'MD5',currency:'CNY',cashierOrigins:['https://cashier.example.test']});const created=await client.create({outTradeNo:'XRH_runtime_mock',amountFen:1006,subject:'中文 + 回复',paytype:'wxpay',clientIp:'8.8.8.8',notifyUrl:'https://api.example.test/notify',returnUrl:'https://web.example.test/checkout/'});const queried=await client.query('XRH_runtime_mock');return Response.json({trade:created.tradeNo,state:queried.tradeStatus});}};`,resolveDir:process.cwd(),sourcefile:'mk99-runtime.ts'},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'}).outputFiles[0].text;
 let outbound=0;const mf=new Miniflare({workers:[{config:{name:'mk99-runtime-test',compatibilityDate:'2026-10-14',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:script}}}},dev:{outboundService:{type:'fetcher',handler:async request=>{outbound++;assert.equal(new URL(request.url).origin,'https://mk99.cn');assert.equal(request.method,'POST');const p=Object.fromEntries(new URLSearchParams(await request.text()));const actual=p.sign;delete p.sign;delete p.sign_type;const canonical=Object.keys(p).sort().map(k=>`${k}=${p[k]}`).join('&');assert.equal(actual,createHash('md5').update(canonical+'&key=runtime-mock-key').digest('hex').toUpperCase());return Response.json({code:1,data:{trade_no:'RUNTIME1',out_trade_no:p.out_trade_no,pay_url:'https://cashier.example.test/pay',total_amount:'10.06',trade_status:'WAIT_BUYER_PAY'}});}}}}]});
 try{const r=await mf.dispatchFetch('https://local.test/');assert.deepEqual(await r.json(),{trade:'RUNTIME1',state:'WAIT_BUYER_PAY'});assert.equal(outbound,2);}finally{await mf.dispose();}
});
