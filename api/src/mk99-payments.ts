import type {Env} from './types';
import {ApiFailure} from './types';
import {response} from './http';
import {balance} from './quota';
import {applyPaymentEvent,type PaymentTransaction} from './payments';
import {Mk99Client,Mk99Error,mk99Config,parseMk99Form,verifyAndParseMk99Notification,canonicalMk99,type Mk99PaymentEvent,type Mk99NotifyField,type Mk99NotifyFieldCheck} from './mk99';
import {requireAdminSession} from './admin-auth';
import {nowMs,uuid} from './security';

function client(env:Env){try{return new Mk99Client(mk99Config(env));}catch{throw new ApiFailure(503,'MK99_NOT_READY','支付协议或金额规则尚未确认，暂不可付款。');}}
function safeProviderError(error:unknown):never{throw new ApiFailure(502,error instanceof Mk99Error?error.code:'MK99_UNCONFIRMED','支付平台暂时无法确认订单，请保留原订单并稍后核对。');}
async function readMk99Body(body:ReadableStream<Uint8Array>|null,limit:number):Promise<Uint8Array>{
 if(!body)throw new Error('Missing body');const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Body too large');}chunks.push(value);}
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result;
}
export async function createMk99Checkout(request:Request,env:Env,t:PaymentTransaction,snapshot:{attemptId:string;requestId:string;packageName:string;credits:number;displayPriceCents:number;[key:string]:unknown}):Promise<Response>{
 const returnUrl=new URL('/checkout/',env.WEB_ORIGIN);returnUrl.searchParams.set('order',t.order_id);
 let data:Awaited<ReturnType<Mk99Client['create']>>|null=null,issue='MK99_NETWORK_UNCERTAIN';
 try{data=await client(env).create({outTradeNo:t.provider_trade_id!,amountFen:t.amount_fen,subject:`Reply Copilot ${snapshot.credits}`,paytype:t.payment_channel==='WECHAT_H5'?'wxpay':'alipay',clientIp:request.headers.get('cf-connecting-ip')??'',notifyUrl:env.API_ORIGIN+'/v1/payments/mk99/notify',returnUrl:returnUrl.href});}catch(e){if(e instanceof Mk99Error)issue=e.code;}
 // The batch cannot downgrade a success notification that arrived during create.
 await env.DB.batch([
  env.DB.prepare("UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),cashier_url=?,status=?,updated_at=? WHERE id=? AND status IN ('pending','unknown') AND (provider_payment_id IS NULL OR provider_payment_id=?)").bind(data?.tradeNo??null,data?.payUrl??null,data?'pending':'unknown',nowMs(),t.id,data?.tradeNo??null),
  env.DB.prepare("UPDATE payment_attempts SET state=?,cashier_url=?,provider_code=?,updated_at=? WHERE id=?").bind(data?'pending':'unknown',data?.payUrl??null,data?'ready:MK99_PAY_URL_READY':'unknown:'+issue,nowMs(),snapshot.attemptId),
 ]);
 const current=await env.DB.prepare('SELECT t.status,t.risk_state,t.provider_payment_id,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.id=?').bind(t.id).first<{status:string;risk_state:string;provider_payment_id:string|null;credited_at:number|null}>();
 const ready=!!data&&current?.status==='pending'&&current.risk_state==='clear'&&current.provider_payment_id===data.tradeNo;
 return response({ok:ready||current?.status==='paid',paymentProvider:'mk99',requestId:snapshot.requestId,...(!ready&&current?.status!=='paid'?{code:'PAYMENT_CHECKOUT_UNAVAILABLE',message:'付款链接未生成，订单结果待核对，请勿重复下单。'}:{}),order:{...snapshot,id:t.order_id,amountFen:t.amount_fen,currency:'CNY',displayCurrency:'USD',paymentProvider:'mk99',paymentProtocol:'mk99',paymentChannel:t.payment_channel,riskState:current?.risk_state??'unknown',status:current?.status??'unknown',creditedAt:current?.credited_at??null,paymentUrl:ready?data?.payUrl:null,checkout:{outcome:ready?'ready':'unknown',issue:ready?'MK99_PAY_URL_READY':current?.risk_state!=='clear'?'MK99_MANUAL_REVIEW':issue}}},ready||current?.status==='paid'?201:502,env,request);
}
function validateMatch(t:PaymentTransaction,p:Mk99PaymentEvent,env:Env,notification:boolean){
 const config=mk99Config(env),expectedPaytype=t.payment_channel==='WECHAT_H5'?'wxpay':'alipay';
 if(p.provider!=='mk99'||p.verification!==(notification?'verified_notification':'authenticated_query')||t.merchant_provider!=='mk99'||t.merchant_account!==config.pid||t.notification_sign_type!==config.notifySignType||t.amount_contract!=='CNY_EXACT_BUYER_TOTAL'||t.currency!=='CNY'||p.outTradeNo!==t.provider_trade_id||!p.tradeNo||(t.provider_payment_id&&t.provider_payment_id!==p.tradeNo)||p.amountFen!==t.amount_fen||(p.currency!==undefined&&p.currency!=='CNY')||(p.merchantId!==undefined&&p.merchantId!==t.merchant_account)||(p.paytypeCode!==undefined&&p.paytypeCode!==expectedPaytype))throw new ApiFailure(409,'PAYMENT_MISMATCH','支付结果与订单不符。');
}
async function riskEvent(env:Env,t:PaymentTransaction,p:Mk99PaymentEvent,hash:string,source:'notification'|'query'){
 const timestamp=source==='notification'?p.timestamp:Math.floor(Date.now()/1000);if(timestamp===undefined||!Number.isSafeInteger(timestamp)||timestamp<1||timestamp>Math.floor(Date.now()/1000)+300)throw new ApiFailure(400,'INVALID_PAYMENT_EVENT','支付事件时间格式无效。');
 const id=`mk99-risk:${t.id}:${hash}`,now=nowMs(),reason=`mk99_risk:${t.id}`;
 // Never auto-unlock a financial risk hold from an out-of-order event. Unfreeze
 // is audited and enters manual review too until refund/freeze semantics are confirmed.
 await env.DB.batch([
  env.DB.prepare('INSERT INTO mk99_risk_events(id,transaction_id,source,trade_status,event_timestamp,body_sha256,received_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(id,t.id,source,p.tradeStatus,timestamp,hash,now),
  env.DB.prepare("UPDATE payment_transactions SET risk_state='manual_review',updated_at=? WHERE id=? AND merchant_provider='mk99'").bind(now,t.id),
  env.DB.prepare("UPDATE credit_batches SET status='manual_review',manual_review_reason=? WHERE source_order_id=? AND status='active'").bind(reason,t.order_id),
 ]);
}
async function reconcile(env:Env,t:PaymentTransaction,p:Mk99PaymentEvent,notification=false,hash=''){
 validateMatch(t,p,env,notification);
 if(['TRADE_FREEZE','TRADE_UNFREEZE','TRADE_REFUND'].includes(p.tradeStatus)){
  if(p.tradeStatus==='TRADE_REFUND'&&p.refundAmountFen!==undefined&&p.refundAmountFen>t.amount_fen)throw new ApiFailure(409,'PAYMENT_MISMATCH','退款金额与订单不符。');
  const riskHash=hash||Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`query:${t.id}:${p.tradeStatus}`))),x=>x.toString(16).padStart(2,'0')).join('');
  await riskEvent(env,t,p,riskHash,notification?'notification':'query');return {status:t.status,quota:await balance(env,t.order_user_id!)};
 }
 const eventId=`mk99:paid:${p.tradeNo}`;
 t.provider_payment_id=p.tradeNo;
 if(p.tradeStatus==='TRADE_SUCCESS'){
  // Platform identity is asserted in the same atomic batch as the ledger.
  return await applyPaymentEvent(env,t,{eventId,eventType:'PAYMENT_SUCCEEDED',amountFen:t.amount_fen,currency:'CNY',bodySha256:hash||undefined});
 }
 // Pending/closed observations cannot downgrade credited orders. Closed state
 // is recorded only from a signed notification or trusted fixed-endpoint query.
 if(p.tradeStatus==='TRADE_CLOSED')return await applyPaymentEvent(env,t,{eventId:`mk99:closed:${p.tradeNo}`,eventType:'PAYMENT_CLOSED',amountFen:0,currency:'CNY',bodySha256:hash||undefined});
 return {status:t.status,quota:await balance(env,t.order_user_id!)};
}
export async function refreshMk99Order(request:Request,env:Env,t:PaymentTransaction){
 let data;try{data=await client(env).query(t.provider_trade_id!);}catch(e){safeProviderError(e);}
 const result=await reconcile(env,t,data!);return response({ok:true,requestId:`mk99-q-${uuid()}`,orderStatus:result.status,verificationSource:'authenticated_https_query',quota:result.quota},200,env,request);
}
type Mk99NotifyStage='received'|'content_type'|'body_read'|'utf8_decode'|'form_parse'|'canonicalize'|'configuration'|'signature_verify'|'signed_fields'|'order_lookup'|'reconcile'|'acknowledged';
type Mk99NotifyReason='content_type_rejected'|'body_read_failed'|'utf8_invalid'|'form_invalid'|'canonicalization_failed'|'configuration_unavailable'|'signature_invalid'|'signed_event_invalid'|'order_not_found'|'identity_or_amount_mismatch'|'event_conflict'|'internal_error';
function notifyContentTypeClass(value:string|null):'missing'|'form_urlencoded'|'json'|'multipart'|'other'{
 if(!value)return 'missing';const mediaType=value.split(';',1)[0].trim().toLowerCase();
 if(mediaType==='application/x-www-form-urlencoded')return 'form_urlencoded';
 if(mediaType==='application/json'||mediaType.endsWith('+json'))return 'json';
 if(mediaType==='multipart/form-data')return 'multipart';
 return 'other';
}
async function parseMk99MultipartForm(body:Uint8Array,contentType:string,requestUrl:string):Promise<Record<string,string>>{
 const copy=new ArrayBuffer(body.byteLength);new Uint8Array(copy).set(body);
 const replay=new Request(requestUrl,{method:'POST',headers:{'Content-Type':contentType},body:copy});
 const form=await replay.formData(),result=Object.create(null) as Record<string,string>;let count=0;
 form.forEach((value,key)=>{
  count++;
  if(count>64||typeof value!=='string'||!/^[A-Za-z0-9_]{1,64}$/.test(key)||Object.hasOwn(result,key)||value.includes('\uFFFD')||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Invalid multipart fields');
  result[key]=value;
 });
 return result;
}
function auditMk99Notify(env:Env,entry:{requestId:string;stage:Mk99NotifyStage;httpStatus:number|null;contentTypeClass:string;bodyBytes:number|null;reason?:Mk99NotifyReason;duplicate?:boolean;fieldCheck?:Mk99NotifyFieldCheck;field?:Mk99NotifyField}){
 if(env.ENVIRONMENT==='staging'&&env.MK99_NOTIFY_DIAGNOSTICS_ENABLED==='1'){
  // This record intentionally contains no callback values or caller-controlled strings.
  console.log({event:'mk99_notify_diagnostic',...entry});return;
 }
 if(entry.httpStatus!==null&&entry.httpStatus>=400)console.warn({event:'mk99_notify_rejected',requestId:entry.requestId,stage:entry.stage,httpStatus:entry.httpStatus,reason:entry.reason??'internal_error'});
}
export async function mk99Notify(request:Request,env:Env){
 // Independent of new-sales and active-merchant switches: historical callbacks survive a switch.
 const requestId=uuid(),contentType=request.headers.get('content-type'),contentTypeClass=notifyContentTypeClass(contentType);let bodyBytes:number|null=null;
 const audit=(stage:Mk99NotifyStage,httpStatus:number|null,reason?:Mk99NotifyReason,duplicate?:boolean)=>auditMk99Notify(env,{requestId,stage,httpStatus,contentTypeClass,bodyBytes,...(reason?{reason}:{}),...(duplicate===undefined?{}:{duplicate})});
 audit('received',null);
 if(contentTypeClass!=='form_urlencoded'&&contentTypeClass!=='multipart'){audit('content_type',415,'content_type_rejected');throw new ApiFailure(415,'INVALID_PAYMENT_NOTIFY','支付通知格式无效。');}
 let body:Uint8Array;try{body=await readMk99Body(request.body,16384);bodyBytes=body.byteLength;}catch{audit('body_read',400,'body_read_failed');throw new ApiFailure(400,'INVALID_PAYMENT_NOTIFY','支付通知格式无效。');}
 let p:Record<string,string>;
 try{
  if(contentTypeClass==='multipart')p=await parseMk99MultipartForm(body,contentType!,request.url);
  else{let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{audit('utf8_decode',400,'utf8_invalid');throw new ApiFailure(400,'INVALID_PAYMENT_NOTIFY','支付通知格式无效。');}p=parseMk99Form(text);}
 }catch(error){if(error instanceof ApiFailure)throw error;audit('form_parse',400,'form_invalid');throw new ApiFailure(400,'INVALID_PAYMENT_NOTIFY','支付通知格式无效。');}
 let hash:string;try{const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalMk99(p))));hash=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');}catch{audit('canonicalize',400,'canonicalization_failed');throw new ApiFailure(400,'INVALID_PAYMENT_NOTIFY','支付通知格式无效。');}
 let config;try{config=mk99Config(env);}catch{audit('configuration',503,'configuration_unavailable');throw new ApiFailure(503,'MK99_NOT_READY','支付通知暂时无法验证。');}
 let event:Mk99PaymentEvent|null;try{event=await verifyAndParseMk99Notification(p,p.out_trade_no??'',config);}catch(error){if(error instanceof Mk99Error){if(env.ENVIRONMENT==='staging'&&env.MK99_NOTIFY_DIAGNOSTICS_ENABLED==='1'){const errorCode=['MK99_RESPONSE_INVALID','MK99_ORDER_MISMATCH','MK99_STATUS_INVALID','MK99_AMOUNT_INVALID'].includes(error.code)?error.code:'MK99_RESPONSE_INVALID';console.log({event:'mk99_notify_field_check',requestId,stage:'signed_fields',fieldCheck:error.notifyFieldCheck??'unclassified',field:error.notifyField??null,errorCode});}audit('signed_fields',409,'signed_event_invalid');throw new ApiFailure(409,'PAYMENT_MISMATCH','支付结果与订单不符。');}audit('signature_verify',500,'internal_error');throw error;}
 if(!event){audit('signature_verify',401,'signature_invalid');throw new ApiFailure(401,'INVALID_PAYMENT_SIGNATURE','支付通知签名无效。');}
 let t:PaymentTransaction|null;try{t=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.merchant_provider='mk99' AND t.provider_trade_id=?").bind(p.out_trade_no??'').first<PaymentTransaction>();}catch{audit('order_lookup',500,'internal_error');throw new ApiFailure(500,'SERVER_UNAVAILABLE','暂时无法处理支付通知。');}
 if(!t){audit('order_lookup',404,'order_not_found');throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');}
 if(event.outTradeNo!==t.provider_trade_id){audit('signed_fields',409,'identity_or_amount_mismatch');throw new ApiFailure(409,'PAYMENT_MISMATCH','支付结果与订单不符。');}
 let result:Awaited<ReturnType<typeof reconcile>>;try{result=await reconcile(env,t,event,true,hash);}catch(error){const status=error instanceof ApiFailure?error.status:500;const reason=error instanceof ApiFailure&&error.code==='PAYMENT_MISMATCH'?'identity_or_amount_mismatch':error instanceof ApiFailure&&error.code==='PAYMENT_EVENT_CONFLICT'?'event_conflict':'internal_error';audit('reconcile',status,reason);throw error;}
 audit('acknowledged',200,undefined,'duplicate' in result?result.duplicate:false);
 return new Response('success',{status:200,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
}
export async function adminMk99Check(request:Request,env:Env){
 await requireAdminSession(request,env,true);try{await client(env).balance();return response({ok:true,operation:'merchant_balance_query',trust:'authenticated_https',paymentChannelApproved:false},200,env,request);}catch(e){return response({ok:false,code:e instanceof Mk99Error?e.code:'MK99_NOT_READY'},503,env,request);}
}
