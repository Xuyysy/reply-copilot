import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,sign,verify} from "node:crypto";
import {test} from "node:test";
import {PayloadTooLargeError,readLimitedBytes,XiaodouClient,canonicalRequest,canonicalQuery,normalizeContentType,webhookSigningText,refundEventMatchesTransaction,webhookEventMatchesStatus,validateFeeProjection,reconcileFeeProjection,xiaodouPaymentOrdersAreEnabled,xiaodouWebhookIsEnabled} from "../src/xiaodou.js";

const merchantKeyId="mkid_0123456789abcdef";

function keyPair(){const pair=generateKeyPairSync("rsa",{modulusLength:2048});return {privatePem:pair.privateKey.export({type:"pkcs8",format:"pem"}).toString(),publicPem:pair.publicKey.export({type:"spki",format:"pem"}).toString(),privateKey:pair.privateKey,publicKey:pair.publicKey};}
function sha(value){return createHash("sha256").update(value).digest("hex");}
function signedResponse(pair,{status=200,body="{\"ok\":true}",requestId="req-12345678",timestamp="1792195200",nonce="response_nonce_123",keyId="platform-kid"}={}){
  const contentType="application/json";
  const text=["XD-Response-v1",String(status),contentType,requestId,timestamp,nonce,keyId,sha(body)].join("\n");
  const sig=sign("RSA-SHA256",Buffer.from(text),pair.privateKey).toString("base64");
  return new Response(body,{status,headers:{"Content-Type":`${contentType}; charset=utf-8`,"X-XD-Request-Id":requestId,"X-XD-Response-Sign":sig,"X-XD-Response-Key-Id":keyId,"X-XD-Response-Timestamp":timestamp,"X-XD-Response-Nonce":nonce}});
}

test("client retains safe HTTP error provenance before API mapping",async()=>{
  const merchant=keyPair(),platform=keyPair(),requestId="request-12345678";
  const body=JSON.stringify({code:"OPEN_API_RESOURCE_NOT_FOUND",message:"private-response-marker",requestId});
  for(const signed of [false,true]){
    const client=new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,
      privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},now:()=>1792195200000,
      fetcher:async()=>signed?signedResponse(platform,{status:404,body,requestId}):new Response(body,{status:404,headers:{"Content-Type":"application/json"}})});
    await assert.rejects(()=>client.queryPayment("order-12345678",{requestId}),error=>{
      assert.equal(error.code,"OPEN_API_RESOURCE_NOT_FOUND");
      assert.equal(error.stage,"provider_http_response");
      assert.equal(error.upstreamHttpStatus,404);
      assert.deepEqual(error.responseDiagnostic,{format:"business_json",providerCode:"OPEN_API_RESOURCE_NOT_FOUND",signatureState:signed?"verified":"absent",sourceIpReason:null});
      assert.doesNotMatch(JSON.stringify(error),/private-response-marker|merchant\.test|BEGIN .*KEY|X-XD-Response/);
      return true;
    });
  }
});

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
  assert.deepEqual(JSON.parse(captured.init.body),{outTradeNo:"order-12345678",channel:"ALIPAY_H5",amountFen:199,currency:"CNY",subject:"AI reply credits",payerClientIp:"8.8.8.8",returnUrl:"https://example.test/checkout"});
  const raw=captured.init.body;const toSign=await canonicalRequest({method:"POST",path:"/api/open/v1/payments",query:"",timestamp:headers["X-XD-Timestamp"],nonce:headers["X-XD-Nonce"],appId:headers["X-XD-App-Id"],keyId:headers["X-XD-Key-Id"],requestId:headers["X-XD-Request-Id"],contentType:headers["Content-Type"],rawBody:raw});
  assert.equal(verify("RSA-SHA256",Buffer.from(toSign),merchant.publicKey,Buffer.from(headers["X-XD-Sign"],"base64")),true);
});

test("raw webhook bytes use the dedicated event signature and tampering is rejected",async()=>{
  const platform=keyPair(),body=Buffer.from('{"eventId":"evt-12345678"}');
  const headers={"X-XD-Webhook-Event-Id":"evt-12345678","X-XD-Webhook-Event-Type":"PAYMENT_SUCCEEDED","X-XD-Webhook-Timestamp":"1792195200","X-XD-Webhook-Nonce":"abcdefghijklmnop","X-XD-Webhook-Key-Id":"platform-kid"};
  const text=await webhookSigningText({...headers,rawBody:body});
  headers["X-XD-Webhook-Signature"]=sign("RSA-SHA256",Buffer.from(text),platform.privateKey).toString("base64");
  const client=new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:keyPair().privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},now:()=>1792195200000,fetcher:async()=>{throw new Error("network not expected");}});
  assert.deepEqual(await client.verifyWebhook(headers,body),{eventId:"evt-12345678",eventType:"PAYMENT_SUCCEEDED",bodySha256:sha(body)});
  await assert.rejects(()=>client.verifyWebhook(headers,Buffer.from(`${body.toString()} `)),error=>error.code==="INVALID_WEBHOOK_SIGNATURE");
  await assert.rejects(()=>webhookSigningText({...headers,"X-XD-Webhook-Event-Id":"",rawBody:body}),/header/i);
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

async function stagingFetchFailure({baseUrl="https://merchant.test",ownApiOrigin="https://api-staging.x-reply-helper.top",error=new TypeError("private message with url and signature"),ticks=[100,100.126]}={}){
  const merchant=keyPair(),platform=keyPair(),events=[];
  const client=new XiaodouClient({baseUrl,ownApiOrigin,appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},environment:"staging",now:()=>1792195200000,monotonicNow:()=>ticks.shift()??100.126,logger:event=>events.push(event),fetcher:async()=>{throw error;}});
  await assert.rejects(()=>client.queryPayment("order-12345678",{requestId:"request-staging-1234"}),error=>error.code==="NETWORK_UNCERTAIN");
  assert.equal(events.length,1);
  return events[0];
}

test("Staging fetch rejection logs safe cause, URL shape, event and fractional timing",async()=>{
  const event=await stagingFetchFailure({error:Object.assign(new TypeError("private message with url and signature"),{cause:new Error("private nested cause")})});
  assert.deepEqual(event,{event:"xiaodou_provider_fetch_failed",requestId:"request-staging-1234",stage:"provider_fetch",elapsedMs:0.13,exceptionName:"TypeError",causeName:"Error",causeCode:"unknown",category:"fetch_rejected",isHttps:true,baseHasPathPrefix:false,baseHasQueryOrFragment:false,hasUnexpectedPort:false,paymentPathMatchesExpected:true,targetMatchesOwnApiOrigin:false,targetUnderOwnDomainZone:"unknown"});
  assert.doesNotMatch(JSON.stringify(event),/merchant\.test|signature|private message|nested cause|order-12345678/);
});

test("Staging fetch rejection exposes only an explicitly allowlisted cause code",async()=>{
  const event=await stagingFetchFailure({error:Object.assign(new TypeError("must not be logged"),{cause:Object.assign(new Error("nested secret"),{code:"ECONNRESET"})})});
  assert.equal(event.exceptionName,"TypeError");assert.equal(event.causeName,"Error");assert.equal(event.causeCode,"ECONNRESET");
  const unknown=await stagingFetchFailure({error:Object.assign(new TypeError("secret"),{cause:{name:"CredentialError",code:"secret-value"}})});
  assert.equal(unknown.causeName,"unknown");assert.equal(unknown.causeCode,"unknown");
  const malformed=await stagingFetchFailure({error:new Proxy(new TypeError("hidden"),{get(target,key,receiver){if(key==="cause")throw new Error("malformed cause getter");return Reflect.get(target,key,receiver);}})});
  assert.equal(malformed.causeName,"unknown");assert.equal(malformed.causeCode,"unknown");
  assert.doesNotMatch(JSON.stringify([event,unknown]),/must not be logged|nested secret|CredentialError|secret-value|merchant\.test/);
});

test("V2 rejects path-prefixed configuration before any fetch or diagnostic logging",()=>{
  const merchant=keyPair(),platform=keyPair();let calls=0;
  assert.throws(()=>new XiaodouClient({baseUrl:"https://merchant.test/api/open/v1",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},fetcher:()=>{calls++;}}),/clean HTTPS origin/);
  assert.equal(calls,0);
});

test("Staging URL diagnostics detect the configured API origin exactly",async()=>{
  const origin="https://api-staging.x-reply-helper.top";
  const event=await stagingFetchFailure({baseUrl:origin,ownApiOrigin:origin});
  assert.equal(event.targetMatchesOwnApiOrigin,true);assert.equal(event.targetUnderOwnDomainZone,true);
  assert.equal(event.isHttps,true);assert.equal(event.paymentPathMatchesExpected,true);
  assert.doesNotMatch(JSON.stringify(event),/api-staging|x-reply-helper/);
});

test("a normal signed provider response does not produce a fetch failure diagnostic",async()=>{
  const merchant=keyPair(),platform=keyPair(),events=[];
  const client=new XiaodouClient({baseUrl:"https://merchant.test",ownApiOrigin:"https://api-staging.x-reply-helper.top",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},environment:"staging",now:()=>1792195200000,nonce:()=>"abcdefghijklmnop",logger:event=>events.push(event),fetcher:async()=>signedResponse(platform,{requestId:"request-12345678",body:"{\"status\":\"PAYING\"}"})});
  const result=await client.queryPayment("order-12345678",{requestId:"request-12345678"});
  assert.equal(result.status,"PAYING");assert.deepEqual(events,[]);
});

test("Production fetch rejection emits no diagnostic log",async()=>{
  const merchant=keyPair(),platform=keyPair(),events=[];
  const client=new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},environment:"production",logger:event=>events.push(event),fetcher:async()=>{throw new TypeError("private provider detail");}});
  await assert.rejects(()=>client.queryPayment("order-12345678",{requestId:"request-production-1234"}),error=>error.code==="NETWORK_UNCERTAIN");
  assert.deepEqual(events,[]);
});

test("Staging diagnostics are passed to console as a structured object",async()=>{
  const merchant=keyPair(),platform=keyPair(),originalWarn=console.warn,logged=[];
  const client=new XiaodouClient({baseUrl:"https://merchant.test",ownApiOrigin:"https://api-staging.x-reply-helper.top",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},environment:"staging",now:()=>1792195200000,fetcher:async()=>{throw new TypeError("private provider detail");}});
  console.warn=(...args)=>logged.push(args);
  try { await assert.rejects(()=>client.queryPayment("order-12345678",{requestId:"request-console-1234"}),error=>error.code==="NETWORK_UNCERTAIN"); }
  finally { console.warn=originalWarn; }
  assert.equal(logged.length,1);
  assert.equal(typeof logged[0][0],"object");
  assert.equal(logged[0][0].event,"xiaodou_provider_fetch_failed");
  assert.equal(logged[0][0].requestId,"request-console-1234");
  assert.doesNotMatch(JSON.stringify(logged[0]),/private provider detail|merchant\.test|order-12345678/);
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

test("webhook event status must match the event type and amount semantics",()=>{
  for(const [eventType,status,eventAmountFen] of [
    ["PAYMENT_SUCCEEDED","SUCCEEDED",1006],
    ["PAYMENT_CLOSED","CLOSED",0],
    ["PAYMENT_FAILED","FAILED",0],
    ["REFUND_SUCCEEDED","SUCCEEDED",990],
    ["REFUND_FAILED","FAILED",990],
  ]) assert.equal(webhookEventMatchesStatus({eventType,status,eventAmountFen}),true);
  for(const event of [
    {eventType:"PAYMENT_SUCCEEDED",status:"CLOSED",eventAmountFen:1006},
    {eventType:"PAYMENT_CLOSED",status:"SUCCEEDED",eventAmountFen:0},
    {eventType:"PAYMENT_FAILED",status:"FAILED",eventAmountFen:1},
    {eventType:"REFUND_SUCCEEDED",status:"FAILED",eventAmountFen:990},
    {eventType:"REFUND_FAILED",status:"SUCCEEDED",eventAmountFen:990},
    {eventType:"REFUND_SUCCEEDED",status:"SUCCEEDED",eventAmountFen:"990"},
  ]) assert.equal(webhookEventMatchesStatus(event),false);
});

test("feeProjection validates the signed provider settlement snapshot without recomputing rates",()=>{
  const projection={ruleVersion:"2026-10",thresholdFen:0,tier:"STANDARD",merchantRateBps:250,companyServiceFeeRateBps:100,merchantSettlementFen:976,companyServiceFeeFen:30};
  assert.deepEqual(validateFeeProjection(projection,1006),projection);
  for(const invalid of [
    {...projection,merchantSettlementFen:975},
    {...projection,companyServiceFeeRateBps:10001},
    {...projection,merchantSettlementFen:976.5},
    {...projection,thresholdFen:"0"},
    {...projection,ruleVersion:""},
    {...projection,companyServiceFeeFen:29},
    {...projection,merchantRateBps:-1},
  ]) assert.equal(validateFeeProjection(invalid,1006),null);
  assert.equal(validateFeeProjection(null,1006),null);
});

test("fee projection reconciliation preserves verified snapshots and flags missing or conflicting data",()=>{
  const projection={ruleVersion:"2026-10",thresholdFen:0,tier:"STANDARD",merchantRateBps:250,companyServiceFeeRateBps:100,merchantSettlementFen:976,companyServiceFeeFen:30};
  assert.deepEqual(reconcileFeeProjection("pending",null,projection,1006),{status:"verified",json:JSON.stringify(projection),issue:null});
  assert.deepEqual(reconcileFeeProjection("pending",null,null,1006),{status:"review",json:null,issue:"missing"});
  assert.equal(reconcileFeeProjection("verified",JSON.stringify(projection),null,1006).status,"verified");
  assert.equal(reconcileFeeProjection("verified",JSON.stringify(projection),{...projection,merchantSettlementFen:975},1006).status,"review");
  assert.equal(reconcileFeeProjection("verified",JSON.stringify(projection),{...projection,merchantSettlementFen:975,companyServiceFeeFen:31},1006).issue,"conflict");
});

test("webhook intake can be enabled for Xiaodou while payment order creation remains disabled",()=>{
  const webhookOnly={PAYMENT_PROVIDER:"xiaodou",XIAODOU_WEBHOOKS_ENABLED:"1",PAYMENTS_ENABLED:"0"};
  assert.equal(xiaodouWebhookIsEnabled(webhookOnly),true);
  assert.equal(xiaodouPaymentOrdersAreEnabled(webhookOnly),false);
  assert.equal(xiaodouPaymentOrdersAreEnabled({...webhookOnly,PAYMENTS_ENABLED:"1"}),true);
  assert.equal(xiaodouWebhookIsEnabled({PAYMENT_PROVIDER:"xiaodou",XIAODOU_WEBHOOKS_ENABLED:"0",PAYMENTS_ENABLED:"1"}),false);
  assert.equal(xiaodouWebhookIsEnabled({PAYMENT_PROVIDER:"mock",XIAODOU_WEBHOOKS_ENABLED:"1",PAYMENTS_ENABLED:"0"}),false);
});


test("signed API requests disable redirects and never forward incoming identity headers", async () => {
  const merchant=keyPair(),platform=keyPair();let calls=0;
  const client=new XiaodouClient({baseUrl:"https://merchant.test",appId:"xdop_1234567890abcdef",keyId:merchantKeyId,
    privateKeyPem:merchant.privatePem,platformPublicKeys:{"platform-kid":platform.publicPem},fetcher:async(url,init)=>{
      calls++;assert.equal(init.redirect,"manual");
      const headers=new Headers(init.headers);
      for(const name of ["Host","Forwarded","X-Forwarded-For","CF-Connecting-IP","X-Real-IP","Cookie","Authorization"])assert.equal(headers.has(name),false);
      return new Response(null,{status:302,headers:{Location:"https://other.test/"}});
    }});
  await assert.rejects(()=>client.queryPayment("order-12345678"),error=>error.stage==="provider_http_response"&&error.upstreamHttpStatus===302);
  assert.equal(calls,1);
});

test('V2 API configuration accepts only an HTTPS root origin',()=>{
 const merchant=keyPair(),platform=keyPair();
 for(const baseUrl of ['https://merchant.test/?','https://merchant.test/#','https://merchant.test/api/open/v1','https://merchant.test:8443/','https://merchant.test/?a=1','https://user:pass@merchant.test/'])
  assert.throws(()=>new XiaodouClient({baseUrl,appId:'xdop_1234567890abcdef',keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{'platform-kid':platform.publicPem}}));
});

test('V2 request timeout aborts once and remains uncertain without retries',async()=>{
 const merchant=keyPair(),platform=keyPair();let aborted=false,calls=0;
 const client=new XiaodouClient({baseUrl:'https://merchant.test/',appId:'xdop_1234567890abcdef',keyId:merchantKeyId,privateKeyPem:merchant.privatePem,platformPublicKeys:{'platform-kid':platform.publicPem},timeoutMs:5,
 fetcher:async(url,init)=>{calls++;return new Promise((resolve,reject)=>{
  const fallback=setTimeout(()=>reject(new TypeError('mock-fallback')),50);
  init.signal?.addEventListener('abort',()=>{aborted=true;clearTimeout(fallback);reject(new DOMException('private timeout','AbortError'));},{once:true});
 });}});
 await assert.rejects(()=>client.queryPayment('order-12345678'),error=>error.code==='NETWORK_UNCERTAIN');
 assert.equal(aborted,true);assert.equal(calls,1);
});

test('official webhook canonical vector hashes raw bytes rather than hex-encoding them',async()=>{
 const rawBody=Buffer.from(' {"eventId":"evt-vector","text":"中文"}\n');
 const headers={'X-XD-Webhook-Event-Id':'evt-vector','X-XD-Webhook-Event-Type':'PAYMENT_SUCCEEDED','X-XD-Webhook-Timestamp':'1792195200','X-XD-Webhook-Nonce':'abcdefghijklmnop','X-XD-Webhook-Key-Id':'platform-kid'};
 const canonical=await webhookSigningText({...headers,rawBody});
 assert.equal(canonical,['XD-Webhook-v1','evt-vector','PAYMENT_SUCCEEDED','1792195200','abcdefghijklmnop','platform-kid',sha(rawBody)].join('\n'));
 assert.equal(canonical.split('\n')[6].length,64);
});
