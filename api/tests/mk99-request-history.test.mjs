import test from 'node:test';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';import{mkdtempSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import path from'node:path';import{createRequire}from'node:module';import{buildSync}from'esbuild';import{generateKeyPairSync}from'node:crypto';
const root=new URL('../..',import.meta.url).pathname,api=new URL('..',import.meta.url).pathname;
test('historical and current MK99 create preserve the official endpoint, complete signed parameter shape and raw pay_url for both channels',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-mk99-contract-'));const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 try{
 const historical=execFileSync('git',['show','97071fca9dd24fff025aaeefe8f75b52400477ca:api/src/mk99.ts'],{cwd:root,encoding:'utf8'}),current=readFileSync(new URL('../src/mk99.ts',import.meta.url),'utf8');
 const createBody=source=>source.slice(source.indexOf(' async create(order:'),source.indexOf(' async query('));assert.equal(createBody(current),createBody(historical),'actual create adapter is unchanged');const early=execFileSync('git',['show','4fac11675b971190b00e222bfea1a72da4c2dba3:api/src/mk99.ts'],{cwd:root,encoding:'utf8'});
 for(const [name,source]of [['early',early],['historical',historical],['current',current]])buildSync({stdin:{contents:source,resolveDir:path.join(api,'src'),loader:'ts'},outfile:path.join(dir,name+'.cjs'),bundle:true,platform:'node',format:'cjs'});
 const require=createRequire(import.meta.url),Early=require(path.join(dir,'early.cjs')).Mk99Client,Old=require(path.join(dir,'historical.cjs')).Mk99Client,Current=require(path.join(dir,'current.cjs')).Mk99Client;
 for(const signType of ['RSA','MD5'])for(const paytype of ['alipay','wxpay']){
 const bodies=[];const payUrl='https://mk99.cn/process/next?trade_no=SYNTHETIC%2BONLY&x=1';
 for(const Client of [Early,Old,Current]){
 const config={baseUrl:'https://mk99.cn',pid:'20881234567890',key:'mock-only',privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),signType,notifySignType:'RSA',currency:'CNY',cashierOrigins:['https://mk99.cn']};
 const client=new Client(config,async(url,options)=>{assert.equal(url,'https://mk99.cn/openapi/pay/create');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');const body=Object.fromEntries(new URLSearchParams(options.body));bodies.push(body);return Response.json({code:1,data:{trade_no:'SYNTHETIC_ONLY',out_trade_no:body.out_trade_no,pay_url:payUrl}});});
 const result=await client.create({outTradeNo:'XRH_synthetic_order',amountFen:1059,subject:'Reply Copilot 400',paytype,clientIp:'203.0.113.5',notifyUrl:'https://api-staging.x-reply-helper.top/v1/payments/mk99/notify',returnUrl:'https://staging.x-reply-helper.top/checkout/?order=synthetic'});assert.equal(result.payUrl??result.pay_url,payUrl);
 }
 const comparable=b=>Object.fromEntries(Object.entries(b).filter(([k])=>!['sign','timestamp'].includes(k)));for(const b of bodies)assert.deepEqual(comparable(bodies[0]),comparable(b));
 for(const b of bodies){assert.equal(b.paytype_code,paytype);assert.equal('channel_id' in b,false,'gateway remains platform-assigned');assert.equal(b.total_amount,'10.59');assert.equal(b.client_ip,'203.0.113.5');assert.ok(b.sign);}
 }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
