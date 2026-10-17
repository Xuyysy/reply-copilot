import type { Env, Session } from "./types";
import { ApiFailure } from "./types";
import { requireCsrf, sessionFor } from "./auth";
import { requireAdminSession } from "./admin-auth";
import { jsonBody, nowMs, uuid } from "./security";
import { response } from "./http";
import { balance } from "./quota";
import { PayloadTooLargeError, readLimitedBytes, XiaodouClient, XiaodouProviderError } from "./xiaodou.js";

type PaymentTransaction = { id:string;order_id:string;provider:"xiaodou"|"local_mock";amount_fen:number;currency:"CNY";status:string;provider_trade_id:string|null;order_user_id?:string;order_credits?:number;order_status?:string;credited_at?:number|null };
type PaymentEvent = { eventId:string;eventType:string;amountFen:number;currency:string;bodySha256?:string };
const LOCAL_WEB_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

function isLocalMock(env:Env,request:Request):boolean {
  const host=new URL(request.url).hostname;
  return env.ENVIRONMENT==="development"&&env.AI_MOCK==="1"&&env.PAYMENT_PROVIDER==="mock"&&LOCAL_WEB_ORIGIN.test(env.WEB_ORIGIN)&&["127.0.0.1","localhost"].includes(host);
}
function realPaymentsEnabled(env:Env):boolean { return env.PAYMENTS_ENABLED==="1"&&env.PAYMENT_PROVIDER==="xiaodou"; }
function paymentClient(env:Env):InstanceType<typeof XiaodouClient> {
  if(!realPaymentsEnabled(env)||!env.XIAODOU_BASE_URL||!env.XIAODOU_APP_ID||!env.XIAODOU_KEY_ID||!env.XIAODOU_PRIVATE_KEY||!env.XIAODOU_PLATFORM_PUBLIC_KEYS) throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付暂未开放。");
  let keys:Record<string,string>;
  try { keys=JSON.parse(env.XIAODOU_PLATFORM_PUBLIC_KEYS) as Record<string,string>; } catch { throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付暂未开放。"); }
  try { return new XiaodouClient({baseUrl:env.XIAODOU_BASE_URL,appId:env.XIAODOU_APP_ID,keyId:env.XIAODOU_KEY_ID,privateKeyPem:env.XIAODOU_PRIVATE_KEY,platformPublicKeys:keys}); }
  catch { throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付暂未开放。"); }
}
async function webSession(request:Request,env:Env,write=false):Promise<Session> {
  const {session,token}=await sessionFor(request,env);
  if(session.kind!=="web") throw new ApiFailure(403,"FORBIDDEN","请在官网登录。");
  if(write) await requireCsrf(request,env,token);
  return session;
}
function cleanId(value:unknown,pattern=/^[a-z0-9_-]{6,64}$/i):string { if(typeof value!=="string"||!pattern.test(value)) throw new ApiFailure(400,"INVALID_REQUEST","请求标识无效。"); return value; }
function localOnlyError():never { throw new ApiFailure(404,"NOT_FOUND","接口不存在。"); }
function mapProviderStatus(value:unknown):"pending"|"paid"|"closed"|"failed"|"unknown" {
  if(value==="SUCCEEDED")return "paid";
  if(value==="CLOSED")return "closed";
  if(value==="FAILED")return "failed";
  if(value==="UNKNOWN")return "unknown";
  if(value==="CREATED"||value==="PAYING")return "pending";
  throw new ApiFailure(502,"INVALID_PROVIDER_STATUS","支付状态暂时无法确认。");
}
async function transactionForOrder(env:Env,orderId:string):Promise<PaymentTransaction|null> {
  return env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.order_id=?").bind(orderId).first<PaymentTransaction>();
}
async function applyPaymentEvent(env:Env,transaction:PaymentTransaction,event:PaymentEvent):Promise<{duplicate:boolean;quota:{freeRemaining:number;paidRemaining:number;totalRemaining:number};status:string}> {
  if(event.currency!=="CNY")throw new ApiFailure(409,"PAYMENT_MISMATCH","支付金额或币种与订单不符。");
  if(event.eventType==="PAYMENT_SUCCEEDED"&&event.amountFen!==transaction.amount_fen)throw new ApiFailure(409,"PAYMENT_MISMATCH","支付金额或币种与订单不符。");
  const now=nowMs(),userId=transaction.order_user_id!,orderId=transaction.order_id;
  const exists=await env.DB.prepare("SELECT 1 AS found FROM provider_payment_events WHERE provider=? AND provider_event_id=?").bind(transaction.provider,event.eventId).first();
  if(exists)return {duplicate:true,quota:await balance(env,userId),status:transaction.status};
  const target=event.eventType==="PAYMENT_SUCCEEDED"?"paid":event.eventType==="PAYMENT_CLOSED"?"closed":event.eventType==="PAYMENT_FAILED"?"failed":event.eventType==="PAYMENT_UNKNOWN"?"unknown":null;
  if(!target)throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","支付事件类型无效。");
  const eventId=uuid();
  const results=await env.DB.batch([
    env.DB.prepare("INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payment_transactions WHERE id=?) ON CONFLICT(provider,provider_event_id) DO NOTHING").bind(eventId,transaction.provider,event.eventId,transaction.id,event.eventType,event.amountFen,event.currency,event.bodySha256??null,now,transaction.id),
    env.DB.prepare("UPDATE payment_transactions SET status=?,provider_trade_id=COALESCE(provider_trade_id,?),paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,?) ELSE paid_at END,updated_at=? WHERE id=? AND status NOT IN ('paid','refunded') AND EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?)").bind(target,transaction.provider_trade_id??null,target,now,now,transaction.id,eventId),
    env.DB.prepare("UPDATE recharge_orders SET status=CASE WHEN ?='paid' THEN 'paid' WHEN ?='closed' THEN 'expired' WHEN ?='unknown' THEN 'awaiting_payment' ELSE 'failed' END,payment_method=?,provider_reference=COALESCE(provider_reference,?),paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,?) ELSE paid_at END WHERE id=? AND status IN ('pending','awaiting_payment','failed','expired') AND credited_at IS NULL AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status=?)").bind(target,target,target,transaction.provider,transaction.provider_trade_id??null,target,now,orderId,transaction.id,target),
    env.DB.prepare("UPDATE credit_accounts SET paid_balance=paid_balance+?,version=version+1,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND status='paid' AND credited_at IS NULL) AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status='paid') AND NOT EXISTS(SELECT 1 FROM credit_ledger WHERE kind='purchase_grant' AND reference_id=?)").bind(transaction.order_credits,now,userId,orderId,transaction.id,orderId),
    env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) SELECT ?,?,'purchase_grant',0,?,?,?,? WHERE EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND status='paid' AND credited_at IS NULL) AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status='paid') ON CONFLICT(kind,reference_id) DO NOTHING").bind(uuid(),userId,transaction.order_credits,orderId,"小豆支付成功到账",now,orderId,transaction.id),
    env.DB.prepare("UPDATE recharge_orders SET credited_at=? WHERE id=? AND status='paid' AND credited_at IS NULL AND EXISTS(SELECT 1 FROM credit_ledger WHERE kind='purchase_grant' AND reference_id=?)").bind(now,orderId,orderId),
  ]);
  if(results[0].meta.changes!==1) return {duplicate:true,quota:await balance(env,userId),status:(await transactionForOrder(env,orderId))?.status??transaction.status};
  const current=await transactionForOrder(env,orderId);
  return {duplicate:false,quota:await balance(env,userId),status:current?.status??target};
}
async function applyRefundEvent(env:Env,transaction:PaymentTransaction,refund:Record<string,unknown>,event:PaymentEvent):Promise<{duplicate:boolean;status:string;quota:{freeRemaining:number;paidRemaining:number;totalRemaining:number}}>{
  const refundId=String(refund.id),refundNo=String(refund.out_refund_no),amount=Number(refund.amount_fen),credits=Number(refund.credits_reserved),userId=transaction.order_user_id!;
  if(event.currency!=="CNY"||event.amountFen!==amount)throw new ApiFailure(409,"REFUND_MISMATCH","退款金额或币种与记录不符。");
  const exists=await env.DB.prepare("SELECT 1 AS found FROM provider_payment_events WHERE provider=? AND provider_event_id=?").bind(transaction.provider,event.eventId).first();
  if(exists)return {duplicate:true,status:String(refund.status),quota:await balance(env,userId)};
  if(event.eventType!=="REFUND_SUCCEEDED"&&event.eventType!=="REFUND_FAILED")throw new ApiFailure(400,"INVALID_REFUND_EVENT","退款事件类型无效。");
  const now=nowMs(),resolved=event.eventType==="REFUND_SUCCEEDED"?"succeeded":"failed",eid=uuid();
  const statements=[
    env.DB.prepare("INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payment_transactions WHERE id=?) ON CONFLICT(provider,provider_event_id) DO NOTHING").bind(eid,transaction.provider,event.eventId,transaction.id,event.eventType,event.amountFen,event.currency,event.bodySha256??null,now,transaction.id),
    env.DB.prepare("UPDATE payment_refunds SET status=?,resolved_event_id=?,updated_at=?,succeeded_at=CASE WHEN ?='succeeded' THEN COALESCE(succeeded_at,?) ELSE succeeded_at END WHERE id=? AND status IN ('requested','pending','unknown') AND resolved_event_id IS NULL AND EXISTS(SELECT 1 FROM provider_payment_events WHERE id=?)").bind(resolved,event.eventId,now,resolved,now,refundId,eid),
    env.DB.prepare("UPDATE credit_accounts SET paid_balance=paid_balance-CASE WHEN ?='succeeded' THEN ? ELSE 0 END,paid_reserved_for_refunds=paid_reserved_for_refunds-?,version=version+1,updated_at=? WHERE user_id=? AND paid_reserved_for_refunds>=? AND EXISTS(SELECT 1 FROM payment_refunds WHERE id=? AND resolved_event_id=? AND status=?)").bind(resolved,credits,credits,now,userId,credits,refundId,event.eventId,resolved),
    env.DB.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) SELECT ?,?,'purchase_reversal',0,?,?,?,? WHERE ?='succeeded' AND EXISTS(SELECT 1 FROM payment_refunds WHERE id=? AND resolved_event_id=? AND status='succeeded') ON CONFLICT(kind,reference_id) DO NOTHING").bind(uuid(),userId,-credits,refundNo,"小豆退款成功，撤销对应付费额度",now,resolved,refundId,event.eventId),
    env.DB.prepare("UPDATE payment_transactions SET status='refunded',refunded_at=COALESCE(refunded_at,?),updated_at=? WHERE id=? AND (SELECT COALESCE(sum(amount_fen),0) FROM payment_refunds WHERE transaction_id=? AND status='succeeded')>=amount_fen").bind(now,now,transaction.id,transaction.id),
    env.DB.prepare("UPDATE recharge_orders SET status='refunded' WHERE id=? AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status='refunded')").bind(transaction.order_id,transaction.id),
  ];
  const results=await env.DB.batch(statements);
  if(results[0].meta.changes!==1) return {duplicate:true,status:String(refund.status),quota:await balance(env,userId)};
  if(results[1].meta.changes===1&&results[2].meta.changes!==1)throw new ApiFailure(409,"REFUND_CREDIT_RESERVATION_INVALID","退款额度预留状态异常。");
  const current=await env.DB.prepare("SELECT status FROM payment_refunds WHERE id=?").bind(refundId).first<{status:string}>();
  return {duplicate:false,status:current?.status??resolved,quota:await balance(env,userId)};
}

export async function packages(request:Request,env:Env):Promise<Response>{
  const rows=await env.DB.prepare("SELECT id,name_zh,name_en,credits,price_cents,promo_price_cents,currency,price_cny_fen,sort_order FROM recharge_packages WHERE active=1 ORDER BY sort_order,id").all();
  const paymentAvailable=isLocalMock(env,request)||realPaymentsEnabled(env);
  return response({packages:rows.results,paymentAvailable,paymentProvider:isLocalMock(env,request)?"local_mock":realPaymentsEnabled(env)?"xiaodou":null},200,env,request);
}
export async function createOrder(request:Request,env:Env):Promise<Response>{
  const session=await webSession(request,env,true),body=await jsonBody(request,1024),packageId=cleanId(body.packageId,/^[a-z0-9_-]{1,64}$/i),mock=isLocalMock(env,request),real=realPaymentsEnabled(env);
  if(!mock&&!real)throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付尚未开放，暂不能创建订单。");
  const pkg=await env.DB.prepare("SELECT id,name_zh,credits,price_cents,promo_price_cents,currency,price_cny_fen FROM recharge_packages WHERE id=? AND active=1").bind(packageId).first<{id:string;name_zh:string;credits:number;price_cents:number;promo_price_cents:number|null;currency:string;price_cny_fen:number|null}>();
  if(!pkg)throw new ApiFailure(404,"PACKAGE_NOT_FOUND","套餐不存在或已下架。");
  const amountFen=pkg.price_cny_fen??(mock?1:null);
  if(amountFen===null||amountFen<1)throw new ApiFailure(503,"PACKAGE_PRICE_NOT_CONFIGURED","该套餐尚未配置人民币价格。");
  const client=real?paymentClient(env):null;
  const id=uuid(),now=nowMs(),amountCents=pkg.promo_price_cents??pkg.price_cents,provider=mock?"local_mock":"xiaodou",outTradeNo=`XRH_${id.replaceAll("-","")}`,transactionId=uuid(),attemptId=uuid(),requestId=`xrh-${uuid()}`;
  const created=await env.DB.batch([
    env.DB.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,payment_method,provider_reference,created_at) SELECT ?,?,?,?, ?,?,'USD','awaiting_payment',?,?,? WHERE NOT EXISTS(SELECT 1 FROM recharge_orders WHERE user_id=? AND status IN ('pending','awaiting_payment'))").bind(id,session.user_id,pkg.id,pkg.name_zh,pkg.credits,amountCents,provider,outTradeNo,now,session.user_id),
    env.DB.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,status,provider_trade_id,created_at,updated_at) SELECT ?,?,?,'CNY',?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM recharge_orders WHERE id=? AND user_id=?)").bind(transactionId,id,provider,amountFen,outTradeNo,now,now,id,session.user_id),
    env.DB.prepare("INSERT INTO payment_attempts(id,transaction_id,attempt_number,provider_request_id,state,created_at,updated_at) SELECT ?,?,1,?,'prepared',?,? WHERE EXISTS(SELECT 1 FROM payment_transactions WHERE id=?)").bind(attemptId,transactionId,requestId,now,now,transactionId),
  ]);
  if(created[0].meta.changes!==1)throw new ApiFailure(409,"UNRESOLVED_ORDER_EXISTS","你已有一笔待支付或待确认订单，请先查看该订单状态，不要重复下单。");
  if(mock)return response({paymentAvailable:true,paymentProvider:"local_mock",order:{id,packageName:pkg.name_zh,credits:pkg.credits,displayPriceCents:amountCents,displayCurrency:"USD",amountFen,currency:"CNY",status:"pending",paymentMode:"mock",message:"本地模拟订单，不会产生真实扣款。"}},201,env,request);
  try {
    const providerResult=await client!.createPayment({outTradeNo,channel:"ALIPAY_H5",amountFen,currency:"CNY",subject:`x-Reply-Helper ${pkg.name_zh} ${pkg.credits}次`,payerClientIp:request.headers.get("cf-connecting-ip")||"",...(env.XIAODOU_RETURN_URL?{returnUrl:env.XIAODOU_RETURN_URL}:{})},{requestId});
    const state=mapProviderStatus(providerResult.status),payUrl=typeof providerResult.payUrl==="string"?providerResult.payUrl:null;
    if(payUrl){const url=new URL(payUrl);if(url.protocol!=="https:"||url.username||url.password)throw new ApiFailure(502,"INVALID_PROVIDER_CASHIER","收银链接暂时无法使用。");}
    const storedState=state==="paid"?"pending":state;
    const orderStatus=storedState==="closed"?"expired":storedState==="failed"?"failed":"awaiting_payment";
    await env.DB.batch([
      env.DB.prepare("UPDATE payment_attempts SET state=?,cashier_url=?,updated_at=? WHERE id=?").bind(storedState==="pending"?"pending":storedState,storedState==="pending"?payUrl:null,nowMs(),attemptId),
      env.DB.prepare("UPDATE payment_transactions SET status=?,cashier_url=?,updated_at=? WHERE id=?").bind(storedState,storedState==="pending"?payUrl:null,nowMs(),transactionId),
      env.DB.prepare("UPDATE recharge_orders SET status=? WHERE id=? AND credited_at IS NULL").bind(orderStatus,id),
    ]);
    return response({paymentAvailable:true,paymentProvider:"xiaodou",order:{id,packageName:pkg.name_zh,credits:pkg.credits,displayPriceCents:amountCents,displayCurrency:"USD",amountFen,currency:"CNY",status:storedState,paymentUrl:storedState==="pending"?payUrl:null}},201,env,request);
  } catch(error) {
    // Once the provider request has been attempted, any response or persistence
    // error is ambiguous. Keep the order queryable and prevent a duplicate order
    // until a signed provider query or webhook resolves its state.
    await env.DB.batch([
      env.DB.prepare("UPDATE payment_attempts SET state='unknown',provider_code=?,updated_at=? WHERE id=?").bind(error instanceof XiaodouProviderError?error.code:"PROVIDER_ERROR",nowMs(),attemptId),
      env.DB.prepare("UPDATE payment_transactions SET status='unknown',updated_at=? WHERE id=?").bind(nowMs(),transactionId),
      env.DB.prepare("UPDATE recharge_orders SET status='awaiting_payment' WHERE id=? AND credited_at IS NULL").bind(id),
    ]);
    return response({paymentAvailable:true,paymentProvider:"xiaodou",order:{id,packageName:pkg.name_zh,credits:pkg.credits,displayPriceCents:amountCents,displayCurrency:"USD",amountFen,currency:"CNY",status:"unknown",paymentUrl:null},message:"支付结果确认中，请刷新订单状态；请不要重复下单。"},201,env,request);
  }
}
export async function getOrder(request:Request,env:Env,orderId:string):Promise<Response>{
  const session=await webSession(request,env),row=await env.DB.prepare("SELECT o.id,o.package_name,o.credits,o.amount_cents,o.currency,o.status,o.created_at,o.paid_at,o.credited_at,t.provider,t.amount_fen,t.currency payment_currency,t.status payment_status,t.cashier_url FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id WHERE o.id=? AND o.user_id=?").bind(orderId,session.user_id).first<Record<string,unknown>>();
  if(!row)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
  return response({order:{id:row.id,packageName:row.package_name,credits:row.credits,displayPriceCents:row.amount_cents,displayCurrency:row.currency,amountFen:row.amount_fen,currency:row.payment_currency,status:row.payment_status,createdAt:row.created_at,paidAt:row.paid_at,creditedAt:row.credited_at,paymentUrl:row.provider==="xiaodou"&&row.payment_status==="pending"?row.cashier_url:null},quota:await balance(env,session.user_id)},200,env,request);
}
async function paymentTransactionForOwner(env:Env,orderId:string,userId:string):Promise<PaymentTransaction>{
  const txn=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE o.id=? AND o.user_id=?").bind(orderId,userId).first<PaymentTransaction>();
  if(!txn)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
  return txn;
}
export async function simulatePayment(request:Request,env:Env,orderId:string):Promise<Response>{
  if(!isLocalMock(env,request))localOnlyError();
  const session=await webSession(request,env,true),transaction=await paymentTransactionForOwner(env,orderId,session.user_id),body=await jsonBody(request,1024);
  if(transaction.provider!=="local_mock")throw new ApiFailure(404,"NOT_FOUND","接口不存在。");
  const eventId=cleanId(body.eventId,/^[A-Za-z0-9_-]{8,80}$/),eventType=body.eventType??"PAYMENT_SUCCEEDED";
  if(!["PAYMENT_SUCCEEDED","PAYMENT_FAILED","PAYMENT_CLOSED","PAYMENT_UNKNOWN"].includes(String(eventType)))throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","模拟支付状态无效。");
  const amountFen=body.amountFen===undefined?transaction.amount_fen:Number(body.amountFen);
  if(!Number.isSafeInteger(amountFen)||amountFen<0)throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","模拟支付金额无效。");
  const result=await applyPaymentEvent(env,transaction,{eventId,eventType:String(eventType),amountFen:eventType==="PAYMENT_SUCCEEDED"?amountFen:0,currency:"CNY"});
  return response({ok:true,alreadyProcessed:result.duplicate,orderStatus:result.status,quota:result.quota},200,env,request);
}
export async function refreshOrder(request:Request,env:Env,orderId:string):Promise<Response>{
  const session=await webSession(request,env,true),transaction=await paymentTransactionForOwner(env,orderId,session.user_id);
  if(transaction.provider!=="xiaodou"||!realPaymentsEnabled(env))throw new ApiFailure(404,"NOT_FOUND","接口不存在。");
  const result=await paymentClient(env).queryPayment(transaction.provider_trade_id!,{requestId:`xrh-q-${uuid()}`});
  if(result.outTradeNo!==transaction.provider_trade_id||result.currency!=="CNY"||result.amountFen!==transaction.amount_fen)throw new ApiFailure(409,"PAYMENT_MISMATCH","查询结果与订单不匹配。");
  const state=mapProviderStatus(result.status);
  if(state==="paid"){
    const applied=await applyPaymentEvent(env,transaction,{eventId:`query-${uuid()}`,eventType:"PAYMENT_SUCCEEDED",amountFen:Number(result.amountFen),currency:"CNY"});
    return response({ok:true,orderStatus:applied.status,quota:applied.quota},200,env,request);
  }
  const orderStatus=state==="closed"?"expired":state==="failed"?"failed":"awaiting_payment",now=nowMs();
  await env.DB.batch([
    env.DB.prepare("UPDATE payment_transactions SET status=?,updated_at=? WHERE id=? AND status NOT IN ('paid','refunded')").bind(state,now,transaction.id),
    env.DB.prepare("UPDATE recharge_orders SET status=? WHERE id=? AND credited_at IS NULL AND status IN ('pending','awaiting_payment','failed','expired') AND EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status=?)").bind(orderStatus,transaction.order_id,transaction.id,state),
  ]);
  return response({ok:true,orderStatus:state,quota:await balance(env,session.user_id)},200,env,request);
}
export async function relaunchPayment(request:Request,env:Env,orderId:string):Promise<Response>{
  const session=await webSession(request,env,true),transaction=await paymentTransactionForOwner(env,orderId,session.user_id);
  if(transaction.provider!=="xiaodou"||!realPaymentsEnabled(env)||["paid","refunded","unknown"].includes(transaction.status))throw new ApiFailure(409,"ORDER_NOT_PAYABLE","当前订单不能重新拉起支付。");
  const client=paymentClient(env),next=await env.DB.prepare("SELECT COALESCE(max(attempt_number),0)+1 n FROM payment_attempts WHERE transaction_id=?").bind(transaction.id).first<{n:number}>(),attempt=Number(next?.n||1),now=nowMs(),attemptId=uuid(),requestId=`xrh-a-${uuid()}`;
  await env.DB.prepare("INSERT INTO payment_attempts(id,transaction_id,attempt_number,provider_request_id,state,created_at,updated_at) VALUES(?,?,?,?,'prepared',?,?)").bind(attemptId,transaction.id,attempt,requestId,now,now).run();
  try{
    const result=await client.relaunchPayment(transaction.provider_trade_id!,{requestId});
    const state=mapProviderStatus(result.status),payUrl=typeof result.payUrl==="string"?result.payUrl:null;
    if(payUrl){const target=new URL(payUrl);if(target.protocol!=="https:"||target.username||target.password)throw new ApiFailure(502,"INVALID_PROVIDER_CASHIER","收银链接暂时无法使用。");}
    const storedState=state==="paid"?"pending":state,now=nowMs(),orderStatus=storedState==="closed"?"expired":storedState==="failed"?"failed":"awaiting_payment";
    await env.DB.batch([env.DB.prepare("UPDATE payment_attempts SET state=?,cashier_url=?,updated_at=? WHERE id=?").bind(storedState==="pending"?"pending":storedState,payUrl,now,attemptId),env.DB.prepare("UPDATE payment_transactions SET status=?,cashier_url=?,updated_at=? WHERE id=?").bind(storedState,payUrl,now,transaction.id),env.DB.prepare("UPDATE recharge_orders SET status=? WHERE id=? AND credited_at IS NULL AND status IN ('pending','awaiting_payment','failed','expired')").bind(orderStatus,transaction.order_id)]);
    return response({ok:true,orderStatus:state==="paid"?"pending":state,paymentUrl:payUrl},200,env,request);
  }catch(error){await env.DB.prepare("UPDATE payment_attempts SET state='unknown',provider_code=?,updated_at=? WHERE id=?").bind(error instanceof XiaodouProviderError?error.code:"PROVIDER_ERROR",nowMs(),attemptId).run();await env.DB.prepare("UPDATE payment_transactions SET status='unknown',updated_at=? WHERE id=? AND status<>'paid'").bind(nowMs(),transaction.id).run();throw new ApiFailure(503,"PAYMENT_STATUS_UNKNOWN","支付尝试结果不确定，请先查询订单状态。");}
}
export async function xiaodouWebhook(request:Request,env:Env):Promise<Response>{
  if(!realPaymentsEnabled(env)||env.PAYMENT_PROVIDER!=="xiaodou")localOnlyError();
  let bytes:Uint8Array;try{bytes=await readLimitedBytes(request.body,64*1024);}catch(error){if(error instanceof PayloadTooLargeError)throw new ApiFailure(413,"PAYMENT_EVENT_TOO_LARGE","支付事件过大。");throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","支付事件格式无效。");}
  const client=paymentClient(env),verified=await client.verifyWebhook(request.headers,bytes);
  let event:Record<string,unknown>;try{event=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as Record<string,unknown>;}catch{throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","支付事件格式无效。");}
  if(event.eventId!==verified.eventId||event.eventType!==verified.eventType||event.appId!==env.XIAODOU_APP_ID)throw new ApiFailure(400,"INVALID_PAYMENT_EVENT","支付事件格式无效。");
  const type=String(event.eventType),outTradeNo=String(event.outTradeNo??"");
  if(type.startsWith("PAYMENT_")){
    const transaction=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.provider='xiaodou' AND t.provider_trade_id=?").bind(outTradeNo).first<PaymentTransaction>();
    if(!transaction)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
    const amount=Number(event.eventAmountFen),gross=Number(event.grossAmountFen);
    if(gross!==transaction.amount_fen||(type==="PAYMENT_SUCCEEDED"&&amount!==transaction.amount_fen)||(type!=="PAYMENT_SUCCEEDED"&&amount!==0))throw new ApiFailure(409,"PAYMENT_MISMATCH","支付事件金额不匹配。");
    await applyPaymentEvent(env,transaction,{eventId:verified.eventId,eventType:type,amountFen:amount,currency:String(event.currency??"CNY"),bodySha256:verified.bodySha256});
  }else{
    const refundNo=String(event.outRefundNo??""),refund=await env.DB.prepare("SELECT r.* FROM payment_refunds r JOIN payment_transactions t ON t.id=r.transaction_id WHERE t.provider='xiaodou' AND r.out_refund_no=?").bind(refundNo).first<Record<string,unknown>>();
    if(!refund)throw new ApiFailure(404,"REFUND_NOT_FOUND","退款记录不存在。");
    const transaction=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.id=?").bind(refund.transaction_id).first<PaymentTransaction>();
    if(!transaction)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
    await applyRefundEvent(env,transaction,refund,{eventId:verified.eventId,eventType:type,amountFen:Number(event.eventAmountFen),currency:"CNY",bodySha256:verified.bodySha256});
  }
  return new Response("success",{status:200,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
}

export async function requestRefund(request:Request,env:Env,orderId:string):Promise<Response>{
  const actor=await requireAdminSession(request,env,true),body=await jsonBody(request,1024),outRefundNo=cleanId(body.outRefundNo,/^[A-Za-z0-9_-]{6,64}$/),amountFen=Number(body.amountFen),reason=typeof body.reason==="string"?body.reason.trim():"";
  if(body.confirm!==true||!Number.isSafeInteger(amountFen)||amountFen<1||reason.length<4||reason.length>256)throw new ApiFailure(400,"INVALID_REFUND","退款需要金额、原因和二次确认。");
  const transaction=await transactionForOrder(env,orderId);
  if(!transaction||transaction.order_status!=="paid"||transaction.status!=="paid"||!transaction.credited_at)throw new ApiFailure(409,"ORDER_NOT_REFUNDABLE","只有已支付到账订单才能申请退款。");
  const existing=await env.DB.prepare("SELECT id,transaction_id,amount_fen,status,credits_reserved FROM payment_refunds WHERE out_refund_no=?").bind(outRefundNo).first<{id:string;transaction_id:string;amount_fen:number;status:string;credits_reserved:number}>();
  if(existing){if(existing.transaction_id!==transaction.id||existing.amount_fen!==amountFen)throw new ApiFailure(409,"REFUND_IDEMPOTENCY_CONFLICT","同一退款编号不能用于不同订单或金额。");return response({ok:true,refund:existing,alreadyExists:true},200,env,request);}
  if(transaction.provider==="xiaodou"&&!realPaymentsEnabled(env))throw new ApiFailure(503,"PAYMENT_UNAVAILABLE","支付暂未开放。");
  if(transaction.provider==="local_mock"&&!isLocalMock(env,request))localOnlyError();
  const totals=await env.DB.prepare("SELECT COALESCE(sum(CASE WHEN status='succeeded' THEN amount_fen ELSE 0 END),0) refunded,COALESCE(sum(CASE WHEN status IN ('requested','pending','unknown') THEN amount_fen ELSE 0 END),0) reserved FROM payment_refunds WHERE transaction_id=?").bind(transaction.id).first<{refunded:number;reserved:number}>();
  if((totals?.refunded??0)+(totals?.reserved??0)+amountFen>transaction.amount_fen)throw new ApiFailure(409,"REFUND_LIMIT_EXCEEDED","累计退款金额不能超过实付金额。");
  const prior=Number(totals?.refunded??0)+Number(totals?.reserved??0),creditsReserved=Math.ceil(((prior+amountFen)*Number(transaction.order_credits))/transaction.amount_fen)-Math.ceil((prior*Number(transaction.order_credits))/transaction.amount_fen);
  const now=nowMs(),refundId=uuid();
  const created=await env.DB.batch([
    env.DB.prepare("INSERT INTO payment_refunds(id,transaction_id,out_refund_no,amount_fen,status,reason,credits_reserved,created_at,updated_at) SELECT ?,?,?,?,'requested',?,?,?,? WHERE EXISTS(SELECT 1 FROM payment_transactions WHERE id=? AND status='paid') AND EXISTS(SELECT 1 FROM credit_accounts WHERE user_id=? AND paid_balance-paid_reserved_for_refunds>=?)").bind(refundId,transaction.id,outRefundNo,amountFen,reason,creditsReserved,now,now,transaction.id,transaction.order_user_id,creditsReserved),
    env.DB.prepare("UPDATE credit_accounts SET paid_reserved_for_refunds=paid_reserved_for_refunds+?,updated_at=? WHERE user_id=? AND EXISTS(SELECT 1 FROM payment_refunds WHERE id=? AND status='requested') AND paid_balance-paid_reserved_for_refunds>=?").bind(creditsReserved,now,transaction.order_user_id,refundId,creditsReserved),
  ]);
  if(created[0].meta.changes!==1||created[1].meta.changes!==1)throw new ApiFailure(409,"REFUND_CREDIT_RESERVATION_FAILED","当前可用付费额度不足，无法安全申请退款。");
  if(transaction.provider==="local_mock")return response({ok:true,refund:{id:refundId,outRefundNo,amountFen,status:"pending",creditsReserved},message:"本地模拟退款已建立，尚未改变余额。"},201,env,request);
  try{
    const result=await paymentClient(env).createRefund({outTradeNo:transaction.provider_trade_id!,outRefundNo,refundAmountFen:amountFen,reason},{requestId:`xrh-r-${uuid()}`});
    const state=String(result.status??"PENDING").toLowerCase();
    await env.DB.prepare("UPDATE payment_refunds SET status=?,updated_at=? WHERE id=? AND status='requested'").bind(state==="unknown"?"unknown":"pending",nowMs(),refundId).run();
  }catch{
    // A transport or response-validation failure cannot prove the provider did
    // not accept a refund. Keep credits reserved until a verified event/query
    // resolves it; releasing here could let refunded credits be spent again.
    await env.DB.prepare("UPDATE payment_refunds SET status='unknown',updated_at=? WHERE id=? AND status='requested'").bind(nowMs(),refundId).run();
  }
  const current=await env.DB.prepare("SELECT id,out_refund_no,amount_fen,status,credits_reserved FROM payment_refunds WHERE id=?").bind(refundId).first();
  return response({ok:true,refund:current},201,env,request);
}
export async function simulateRefund(request:Request,env:Env,outRefundNo:string):Promise<Response>{
  if(!isLocalMock(env,request))localOnlyError();
  await requireAdminSession(request,env,true);
  const body=await jsonBody(request,1024),eventId=cleanId(body.eventId,/^[A-Za-z0-9_-]{8,80}$/),eventType=body.eventType??"REFUND_SUCCEEDED";
  if(eventType!=="REFUND_SUCCEEDED"&&eventType!=="REFUND_FAILED")throw new ApiFailure(400,"INVALID_REFUND_EVENT","模拟退款状态无效。");
  const refund=await env.DB.prepare("SELECT r.* FROM payment_refunds r WHERE r.out_refund_no=?").bind(outRefundNo).first<Record<string,unknown>>();
  if(!refund)throw new ApiFailure(404,"REFUND_NOT_FOUND","退款记录不存在。");
  const transaction=await env.DB.prepare("SELECT t.*,o.user_id order_user_id,o.credits order_credits,o.status order_status,o.credited_at FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.id=?").bind(refund.transaction_id).first<PaymentTransaction>();
  if(!transaction||transaction.provider!=="local_mock")localOnlyError();
  const result=await applyRefundEvent(env,transaction,refund,{eventId,eventType:String(eventType),amountFen:Number(refund.amount_fen),currency:"CNY"});
  return response({ok:true,alreadyProcessed:result.duplicate,refundStatus:result.status,quota:result.quota},200,env,request);
}
