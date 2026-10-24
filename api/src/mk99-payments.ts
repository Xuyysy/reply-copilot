import type {Env} from './types';
import {ApiFailure} from './types';
import {response} from './http';
import {balance} from './quota';
import {applyPaymentEvent,type PaymentTransaction} from './payments';
import {Mk99Client,Mk99Error,mk99Config,mk99Amount,parseMk99Form,verifyMk99,mk99States,canonicalMk99} from './mk99';
import {readLimitedBytes} from './xiaodou.js';
import {requireAdminSession} from './admin-auth';
import {nowMs,uuid} from './security';

function client(env:Env){try{return new Mk99Client(mk99Config(env));}catch{throw new ApiFailure(503,'MK99_NOT_READY','支付协议或金额规则尚未确认，暂不可付款。');}}
function safeProviderError(error:unknown):never{throw new ApiFailure(502,error instanceof Mk99Error?error.code:'MK99_UNCONFIRMED','支付平台暂时无法确认订单，请保留原订单并稍后核对。');}
export async function createMk99Checkout(request:Request,env:Env,t:PaymentTransaction,snapshot:{attemptId:string;requestId:string;packageName:string;credits:number;displayPriceCents:number;[key:string]:unknown}):Promise<Response>{
 const returnUrl=new URL('/checkout/',env.WEB_ORIGIN);returnUrl.searchParams.set('order',t.order_id);
 let data:Record<string,any>|null=null,issue='MK99_NETWORK_UNCERTAIN';
 try{data=await client(env).create({outTradeNo:t.provider_trade_id!,amountFen:t.amount_fen,subject:`Reply Copilot ${snapshot.credits}`,paytype:t.payment_channel==='WECHAT_H5'?'wxpay':'alipay',clientIp:request.headers.get('cf-connecting-ip')??'',notifyUrl:env.API_ORIGIN+'/v1/payments/mk99/notify',returnUrl:returnUrl.href});}catch(e){if(e instanceof Mk99Error)issue=e.code;}
 // The batch cannot downgrade a success notification that arrived during create.
 await env.DB.batch([
  env.DB.prepare("UPDATE payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),cashier_url=?,status=?,updated_at=? WHERE id=? AND status IN ('pending','unknown') AND (provider_payment_id IS NULL OR provider_payment_id=?)").bind(data?.trade_no??null,data?.pay_url??null,data?'pending':'unknown',nowMs(),t.id,data?.trade_no??null),
  env.DB.prepare("UPDATE payment_attempts SET state=?,cashier_url=?,provider_code=?,updated_at=? WHERE id=?").bind(data?'pending':'unknown',data?.pay_url??null,data?'ready:MK99_PAY_URL_READY':'unknown:'+issue,nowMs(),snapshot.attemptId),
 ]);
 const current=await env.DB.prepare('SELECT t.status,t.risk_state,t.provider_payment_id,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.id=?').bind(t.id).first<{status:string;risk_state:string;provider_payment_id:string|null;credited_at:number|null}>();
 const ready=!!data&&current?.status==='pending'&&current.risk_state==='clear'&&current.provider_payment_id===data.trade_no;
 return response({ok:ready||current?.status==='paid',paymentProvider:'mk99',requestId:snapshot.requestId,...(!ready&&current?.status!=='paid'?{code:'PAYMENT_CHECKOUT_UNAVAILABLE',message:'付款链接未生成，订单结果待核对，请勿重复下单。'}:{}),order:{...snapshot,id:t.order_id,amountFen:t.amount_fen,currency:'CNY',displayCurrency:'USD',paymentProvider:'mk99',paymentProtocol:'mk99',paymentChannel:t.payment_channel,riskState:current?.risk_state??'unknown',status:current?.status??'unknown',creditedAt:current?.credited_at??null,paymentUrl:ready?data?.pay_url:null,checkout:{outcome:ready?'ready':'unknown',issue:ready?'MK99_PAY_URL_READY':current?.risk_state!=='clear'?'MK99_MANUAL_REVIEW':issue}}},ready||current?.status==='paid'?201:502,env,request);
}
function validateMatch(t:PaymentTransaction,p:Record<string,any>,env:Env,notification:boolean){
 const config=mk99Config(env);
 if(notification&&(['pid','trade_no','out_trade_no','total_amount','subject','paytype_code','channel_id','trade_status','timestamp'].some(k=>typeof p[k]!=='string'||!p[k])||!/^\d{1,20}$/.test(p.channel_id)||!/^\d{1,12}$/.test(p.timestamp)))throw new ApiFailure(400,'INVALID_PAYMENT_EVENT','支付通知缺少有效必要字段。');
 if(t.merchant_provider!=='mk99'||t.merchant_account!==config.pid||t.notification_sign_type!==config.notifySignType||t.amount_contract!=='CNY_EXACT_BUYER_TOTAL'||t.currency!=='CNY'||p.out_trade_no!==t.provider_trade_id||typeof p.trade_no!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(p.trade_no)||(t.provider_payment_id&&t.provider_payment_id!==p.trade_no)||mk99Amount(p.total_amount)!==t.amount_fen||(p.currency!==undefined&&p.currency!=='CNY')||(notification&&p.pid!==t.merchant_account)||(p.paytype_code!==undefined&&p.paytype_code!==(t.payment_channel==='WECHAT_H5'?'wxpay':'alipay'))||(p.pid!==undefined&&p.pid!==t.merchant_account)||!mk99States.includes(p.trade_status))throw new ApiFailure(409,'PAYMENT_MISMATCH','支付结果与原订单不符。');
}
async function riskEvent(env:Env,t:PaymentTransaction,p:Record<string,any>,hash:string,source:'notification'|'query'){
 const timestamp=source==='notification'?Number(p.timestamp):Math.floor(Date.now()/1000);if(!Number.isSafeInteger(timestamp)||timestamp<1||timestamp>Math.floor(Date.now()/1000)+300)throw new ApiFailure(400,'INVALID_PAYMENT_EVENT','支付事件时间格式无效。');
 const id=`mk99-risk:${t.id}:${hash}`,now=nowMs(),reason=`mk99_risk:${t.id}`;
 // Never auto-unlock a financial risk hold from an out-of-order event. Unfreeze
 // is audited and enters manual review too until refund/freeze semantics are confirmed.
 await env.DB.batch([
  env.DB.prepare('INSERT INTO mk99_risk_events(id,transaction_id,source,trade_status,event_timestamp,body_sha256,received_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(id,t.id,source,p.trade_status,timestamp,hash,now),
  env.DB.prepare("UPDATE payment_transactions SET risk_state='manual_review',updated_at=? WHERE id=? AND merchant_provider='mk99'").bind(now,t.id),
  env.DB.prepare("UPDATE credit_batches SET status='manual_review',manual_review_reason=? WHERE source_order_id=? AND status='active'").bind(reason,t.order_id),
 ]);
}
async function reconcile(env:Env,t:PaymentTransaction,p:Record<string,any>,notification=false,hash=''){
 validateMatch(t,p,env,notification);
 if(['TRADE_FREEZE','TRADE_UNFREEZE','TRADE_REFUND'].includes(p.trade_status)){
  if(p.trade_status==='TRADE_REFUND'&&p.refund_amount!==undefined&&mk99Amount(p.refund_amount)>t.amount_fen)throw new ApiFailure(409,'PAYMENT_MISMATCH','退款金额与订单不符。');
  const riskHash=hash||Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`query:${t.id}:${p.trade_status}`))),x=>x.toString(16).padStart(2,'0')).join('');
  await riskEvent(env,t,p,riskHash,notification?'notification':'query');return {status:t.status,quota:await balance(env,t.order_user_id!)};
 }
 const eventId=`mk99:paid:${p.trade_no}`;
 t.provider_payment_id=p.trade_no;
 if(p.trade_status==='TRADE_SUCCESS'){
  // Platform identity is asserted in the same atomic batch as the ledger.
  return await applyPaymentEvent(env,t,{eventId,eventType:'PAYMENT_SUCCEEDED',amountFen:t.amount_fen,currency:'CNY',bodySha256:hash||undefined});
 }
 // Pending/closed observations cannot downgrade credited orders. Closed state
 // is recorded only from a signed notification or trusted fixed-endpoint query.
 if(p.trade_status==='TRADE_CLOSED')return await applyPaymentEvent(env,t,{eventId:`mk99:closed:${p.trade_no}`,eventType:'PAYMENT_CLOSED',amountFen:0,currency:'CNY',bodySha256:hash||undefined});
 return {status:t.status,quota:await balance(env,t.order_user_id!)};
}
export async function refreshMk99Order(request:Request,env:Env,t:PaymentTransaction,diagnosticOnly=false){
 if(diagnosticOnly){
  if(env.ENVIRONMENT!=='staging')throw new ApiFailure(404,'NOT_FOUND','接口不存在。');
  let diagnostic;try{diagnostic=await client(env).queryAmountDiagnostic(t.provider_trade_id!);}catch(e){safeProviderError(e);}
  return response({ok:true,requestId:`mk99-shape-${uuid()}`,diagnostic:{amount:diagnostic!.amount,tradeStatus:diagnostic!.tradeStatus}},200,env,request);
 }
 let data;try{data=await client(env).query(t.provider_trade_id!);}catch(e){safeProviderError(e);}
 const result=await reconcile(env,t,data!);return response({ok:true,requestId:`mk99-q-${uuid()}`,orderStatus:result.status,verificationSource:'authenticated_https_query',quota:result.quota},200,env,request);
}
export async function mk99Notify(request:Request,env:Env){
 // Independent of new-sales and active-merchant switches: historical callbacks survive a switch.
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded'))throw new ApiFailure(415,'INVALID_PAYMENT_NOTIFY','支付通知格式无效。');
 let p:Record<string,string>,hash:string;
 try{const body=await readLimitedBytes(request.body,16384);p=parseMk99Form(new TextDecoder('utf-8',{fatal:true}).decode(body));const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalMk99(p))));hash=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');}catch{throw new ApiFailure(400,'INVALID_PAYMENT_NOTIFY','支付通知格式无效。');}
 let config;try{config=mk99Config(env);}catch{throw new ApiFailure(503,'MK99_NOT_READY','支付通知暂时无法验证。');}
 if(!await verifyMk99(p,config))throw new ApiFailure(401,'INVALID_PAYMENT_SIGNATURE','支付通知签名无效。');
 const t=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.merchant_provider='mk99' AND t.provider_trade_id=?").bind(p.out_trade_no??'').first<PaymentTransaction>();
 if(!t)throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');
 await reconcile(env,t,p,true,hash!);
 return new Response('success',{status:200,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
}
export async function adminMk99Check(request:Request,env:Env){
 await requireAdminSession(request,env,true);try{await client(env).balance();return response({ok:true,operation:'merchant_balance_query',trust:'authenticated_https',paymentChannelApproved:false},200,env,request);}catch(e){return response({ok:false,code:e instanceof Mk99Error?e.code:'MK99_NOT_READY'},503,env,request);}
}
