import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,sign,verify} from "node:crypto";
import {test} from "node:test";
import {PayloadTooLargeError,readLimitedBytes,XiaodouClient,canonicalRequest,canonicalQuery,normalizeContentType,webhookSigningText,refundEventMatchesTransaction,xiaodouPaymentOrdersAreEnabled,xiaodouWebhookIsEnabled} from "../src/xiaodou.js";

const merchantKeyId="mkid_0123456789abcdef";

function keyPair(){const pair=generateKeyPairSync("rsa",{modulusLength:2048});return {privatePem:pair.privateKey.export({type:"pkcs8",format:"pem"}).toString(),publicPem:pair.publicKey.export({type:"spki",format:"pem"}).toString(),privateKey:pair.privateKey,publicKey:pair.publicKey};}
function sha(value){return createHash("sha256").update(value).digest("hex");}
function signedResponse(pair,{status=200,body="{\"ok\":true}",requestId="req-12345678",timestamp="1792195200",nonce="response_nonce_123",keyId="platform-kid"}={}){
  const contentType="application/json";
  const text=["XD-Response-v1",String(status),contentType,requestId,timestamp,nonce,keyId,sha(body)].join("\n");
  const sig=sign("RSA-SHA256",Buffer.from(text),pair.privateKey).toString("base64");
  return new Response(body,{status,headers:{"Content-Type":`${contentType}; charset=utf-8`,"X-XD-Request-Id":requestId,"X-XD-Response-Sign":sig,"X-XD-Response-Key-Id":keyId,"X-XD-Response-Timestamp":timestamp,"X-XD-Response-Nonce":nonce}});
}

test("canonical request normalizes path, sorted duplicate query keys, content type, and raw body hash",async()=>{
  const body='{"z":1}';
  assert.equal(canonicalQuery("z=2&a=hello+world&a=!*'()"),"a=hello%20world&a=%21%2A%27%28%29&z=2");
  assert.equal(normalizeContentType("Application/JSON; Charset=UTF-8"),"application/json");
  assert.equal(await canonicalRequest({method:"post",path:"/api/open/v1/payments",query:"b=2&a=1",timestamp:"1",nonce:"abcdefghijklmnop",appId:"xdop_1234567890abcdef",keyId:"kid",requestId:"request-12345678",contentType:"application/json; charset=utf-8",rawBody:body}),[
    "XD-Signature-v1","POST","/api/open/v1/payments","a=1&b=2","1","abcdefghijklmnop","xdop_1234567890abcdef","kid","request-12345678","application/json",sha(body)
  ].join("\n"));
});

test("Xiaodou client signs create requests and verifies raw signed responses",async()=>{
  const merchant=keyPair(),platform=keyPair();let captured;
  const client=new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},now:()=>1792195200000,nonce:()=>"abcdefghijklmnop",fetcher:async(url,init)=>{captured={url:String(url),init};return signedResponse(platform,{requestId:"request-12345678",body:JSON.stringify({status:"PAYING",payUrl:"https://cashier.test/pay/1"})});}});
  const result=await client.createPayment({outTradeNo:"order-12345678",channel:"ALIPAY_H5",amountFen:199,currency:"CNY",subject:"AI reply credits",payerClientIp:"8.8.8.8",returnUrl:"https://example.test/checkout"},{requestId:"request-12345678"});
  assert.equal(result.status,"PAYING");assert.equal(result.payUrl,"https://cashier.test/pay/1");
  const headers=captured.init.headers;assert.equal(headers["X-XD-Request-Id"],"request-12345678");assert.equal(headers["Content-Type"],"application/json");
  const raw=captured.init.body;const toSign=await canonicalRequest({method:"POST",path:"/api/open/v1/payments",query:"",timestamp:headers["X-XD-Timestamp"],nonce:headers["X-XD-Nonce"],appId:headers["X-XD-App-Id"],keyId:headers["X-XD-Key-Id"],requestId:headers["X-XD-Request-Id"],contentType:headers["Content-Type"],rawBody:raw});
  assert.equal(verify("RSA-SHA256",Buffer.from(toSign),merchant.publicKey,Buffer.from(headers["X-XD-Sign"],"base64")),true);
});

test("raw webhook bytes use the dedicated event signature and tampering is rejected",async()=>{
  const platform=keyPair(),body=Buffer.from('{"eventId":"evt-12345678"}');
  const headers={"X-XD-Webhook-Event-Id":"evt-12345678","X-XD-Webhook-Event-Type":"PAYMENT_SUCCEEDED","X-XD-Webhook-Timestamp":"1792195200","X-XD-Webhook-Nonce":"abcdefghijklmnop","X-XD-Webhook-Key-Id":"platform-kid"};
  const text=webhookSigningText({...headers,rawBody:body});
  headers["X-XD-Webhook-Signature"]=sign("RSA-SHA256",Buffer.from(text),platform.privateKey).toString("base64");
  const client=new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:keyPair().privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},now:()=>1792195200000,fetcher:async()=>{throw new Error("network not expected");}});
  assert.deepEqual(await client.verifyWebhook(headers,body),{eventId:"evt-12345678",eventType:"PAYMENT_SUCCEEDED",bodySha256:sha(body)});
  await assert.rejects(()=>client.verifyWebhook(headers,Buffer.from(`${body.toString()} `)),error=>error.code==="INVALID_WEBHOOK_SIGNATURE");
  assert.throws(()=>webhookSigningText({...headers,"X-XD-Webhook-Event-Id":"",rawBody:body}),/header/i);
});

test("invalid or unsigned successful provider responses are rejected",async()=>{
  const merchant=keyPair(),platform=keyPair();
  const client=new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},now:()=>1792195200000,nonce:()=>"abcdefghijklmnop",fetcher:async()=>new Response('{"status":"SUCCEEDED"}',{status:200,headers:{"Content-Type":"application/json"}})});
  await assert.rejects(()=>client.queryPayment("order-12345678",{requestId:"request-12345678"}),error=>error.code==="UNSIGNED_PROVIDER_SUCCESS");
});

test("a signed successful response must include its matching request id",async()=>{
  const merchant=keyPair(),platform=keyPair();
  const client=new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},now:()=>1792195200000,nonce:()=>"abcdefghijklmnop",fetcher:async()=>{const response=await signedResponse(platform,{requestId:"request-12345678"});const headers=new Headers(response.headers);headers.delete("X-XD-Request-Id");return new Response(await response.text(),{status:response.status,headers});}});
  await assert.rejects(()=>client.queryPayment("order-12345678",{requestId:"request-12345678"}),error=>error.code==="PROVIDER_REQUEST_ID_MISSING");
});

test("query, relaunch, refund creation and refund query use the documented signed endpoints",async()=>{
  const merchant=keyPair(),platform=keyPair(),calls=[];
  const client=new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},now:()=>1792195200000,nonce:()=>"abcdefghijklmnop",fetcher:async(url,init)=>{calls.push({url:String(url),method:init.method,body:init.body});return signedResponse(platform,{requestId:init.headers["X-XD-Request-Id"]});}});
  await client.queryPayment("order-12345678",{requestId:"request-query-1234"});
  await client.relaunchPayment("order-12345678",{requestId:"request-retry-1234"});
  await client.createRefund({outTradeNo:"order-12345678",outRefundNo:"refund-12345678",refundAmountFen:100,reason:"test refund"},{requestId:"request-refund-1234"});
  await client.queryRefund("refund-12345678",{requestId:"request-status-1234"});
  assert.deepEqual(calls.map(({url,method})=>[new URL(url).pathname,method]),[
    ["/api/open/v1/payments/order-12345678","GET"],
    ["/api/open/v1/payments/order-12345678/attempts","POST"],
    ["/api/open/v1/refunds","POST"],
    ["/api/open/v1/refunds/refund-12345678","GET"],
  ]);
  assert.deepEqual(JSON.parse(calls[2].body),{outTradeNo:"order-12345678",outRefundNo:"refund-12345678",refundAmountFen:100,reason:"test refund"});
});

test("provider failures and timeouts stay generic and do not disclose the response body",async()=>{
  const merchant=keyPair(),platform=keyPair();
  const makeClient=fetcher=>new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},now:()=>1792195200000,fetcher});
  const tooMany=makeClient(async()=>new Response('{"code":"RATE_LIMITED","message":"credential-example"}',{status:429,headers:{"Content-Type":"application/json"}}));
  await assert.rejects(()=>tooMany.queryPayment("order-12345678",{requestId:"request-ratelimit-123"}),error=>error.code==="RATE_LIMITED"&&error.status===409&&error.message==="小豆支付暂时无法处理请求。");
  const failed=makeClient(async()=>new Response('{"code":"UPSTREAM_FAILURE"}',{status:500,headers:{"Content-Type":"application/json"}}));
  await assert.rejects(()=>failed.queryPayment("order-12345678",{requestId:"request-upstream-123"}),error=>error.code==="UPSTREAM_FAILURE"&&error.status===502);
  const timedOut=makeClient(async()=>{throw new Error("credential-example body-example");});
  await assert.rejects(()=>timedOut.queryPayment("order-12345678",{requestId:"request-timeout-123"}),error=>error.code==="NETWORK_UNCERTAIN"&&error.message==="小豆支付暂时无法处理请求。");
});

test("provider and webhook bodies are bounded while streaming",async()=>{
  const overLimit=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(64*1024+1));controller.close();}});
  await assert.rejects(()=>readLimitedBytes(overLimit,64*1024),PayloadTooLargeError);
  const merchant=keyPair(),platform=keyPair(),oversized=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(64*1024+1));controller.close();}});
  const client=new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},now:()=>1792195200000,fetcher:async()=>new Response(oversized,{status:200,headers:{"Content-Type":"application/json"}})});
  await assert.rejects(()=>client.queryPayment("order-12345678",{requestId:"request-12345678"}),error=>error.code==="RESPONSE_TOO_LARGE");
});

test("merchant key id must use the merchant mkid format and reject platform key ids",()=>{
  const common={baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",privateKeyPem:keyPair().privatePem,platformPublicKeys:{}};
  assert.doesNotThrow(()=>new XiaodouClient({...common,keyId:merchantKeyId}));
  for(const keyId of ["platform-kid","mkid_0123456789abcdeF","mkid_0123456789abcde","mkid_0123456789abcdef00"])
    assert.throws(()=>new XiaodouClient({...common,keyId}),/credential configuration/i);
});

test("refund envelope binds refund id, original trade id, gross order amount, and per-refund amount",()=>{
  const transaction={provider_trade_id:"XRH_trade_123",amount_fen:2021};
  const refund={out_refund_no:"XRH_refund_123",amount_fen:1990};
  const ordinaryPartial={outRefundNo:"XRH_refund_123",outTradeNo:"XRH_trade_123",grossAmountFen:2021,eventAmountFen:1990};
  const specialFeePartial={...ordinaryPartial,outRefundNo:"XRH_fee_refund",eventAmountFen:20};
  assert.equal(refundEventMatchesTransaction(ordinaryPartial,refund,transaction),true);
  assert.equal(refundEventMatchesTransaction({...specialFeePartial}, {...refund,out_refund_no:"XRH_fee_refund",amount_fen:20},transaction),true);
  assert.equal(refundEventMatchesTransaction({...ordinaryPartial,outRefundNo:"XRH_other_refund"},refund,transaction),false);
  assert.equal(refundEventMatchesTransaction({...ordinaryPartial,outTradeNo:"XRH_other_trade"},refund,transaction),false);
  assert.equal(refundEventMatchesTransaction({...ordinaryPartial,grossAmountFen:1990},refund,transaction),false);
  assert.equal(refundEventMatchesTransaction({...ordinaryPartial,eventAmountFen:1991},refund,transaction),false);
});

test("webhook intake can be enabled for Xiaodou while payment order creation remains disabled",()=>{
  const webhookOnly={PAYMENT_PROVIDER:"xiaodou",XIAODOU_WEBHOOKS_ENABLED:"1",PAYMENTS_ENABLED:"0"};
  assert.equal(xiaodouWebhookIsEnabled(webhookOnly),true);
  assert.equal(xiaodouPaymentOrdersAreEnabled(webhookOnly),false);
  assert.equal(xiaodouPaymentOrdersAreEnabled({...webhookOnly,PAYMENTS_ENABLED:"1"}),true);
  assert.equal(xiaodouWebhookIsEnabled({PAYMENT_PROVIDER:"xiaodou",XIAODOU_WEBHOOKS_ENABLED:"0",PAYMENTS_ENABLED:"1"}),false);
  assert.equal(xiaodouWebhookIsEnabled({PAYMENT_PROVIDER:"mock",XIAODOU_WEBHOOKS_ENABLED:"1",PAYMENTS_ENABLED:"0"}),false);
});
