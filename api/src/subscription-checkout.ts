import type { Env } from './types';
import { ApiFailure } from './types';
import { sessionFor, requireCsrf, takeRate } from './auth';
import { requireWebOrigin, jsonBody, nowMs, uuid } from './security';
import { response } from './http';
import { paymentControl, type PaymentChannel } from './payment-policy';
import { Mk99Client, Mk99Error, mk99Config, type Mk99Config } from './mk99';
import { subscriptionsEnabled } from './subscription-account';

// Explicit third switch: the subscription catalog and existing-order paid
// reconciliation can be tested WITHOUT allowing a single new real checkout.
const checkoutEnabled=(env:Env)=>subscriptionsEnabled(env)
  && env.SUBSCRIPTION_PURCHASES_ENABLED==='1'
  && env.SUBSCRIPTION_CHECKOUT_ENABLED==='1';

type Catalog={id:string;plan_code:string;name_zh:string;price_fen:number;daily_limit:number;duration_days:number};
type Pending={
 id:string;user_id:string;operation_id:string|null;kind:string;
 plan_version_id:string;plan_code:string;amount_fen:number;payment_channel:string;
 status:string;transaction_status:string;risk_state:string;checkout_state:string;
 cashier_url:string|null;provider_trade_id:string;provider_payment_id:string|null;
 merchant_account:string|null;notification_sign_type:string|null;paid_at:number|null;
 verified_paid:number;
};
const RESULT_FIELDS=`o.id,o.user_id,o.operation_id,o.kind,o.plan_version_id,v.plan_code,o.amount_fen,t.payment_channel,o.status,t.status transaction_status,t.risk_state,t.checkout_state,t.cashier_url,t.provider_trade_id,t.provider_payment_id,t.merchant_account,t.notification_sign_type,o.paid_at,CASE WHEN
   o.status='paid' AND o.paid_at IS NOT NULL AND o.applied_at IS NOT NULL
   AND t.status='paid' AND t.paid_at IS NOT NULL AND t.risk_state='clear'
   AND t.merchant_provider='mk99' AND t.currency='CNY' AND t.amount_fen=o.amount_fen
   AND EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id AND p.user_id=o.user_id
     AND p.daily_limit=v.daily_limit AND p.status IN ('active','queued','expired'))
   AND EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id
     AND e.merchant_provider='mk99' AND e.event_type='PAYMENT_SUCCEEDED'
     AND e.amount_fen=t.amount_fen AND e.body_sha256 IS NOT NULL)
   THEN 1 ELSE 0 END verified_paid`;
async function existingFor(env:Env,userId:string,operationId:string):Promise<Pending|null>{
 return env.DB.prepare("SELECT "+RESULT_FIELDS+" FROM subscription_orders o JOIN subscription_plan_versions v ON v.id=o.plan_version_id JOIN subscription_payment_transactions t ON t.order_id=o.id WHERE o.user_id=? AND (o.operation_id=? OR o.status IN ('pending','unknown')) ORDER BY CASE WHEN o.operation_id=? THEN 0 ELSE 1 END,o.created_at DESC LIMIT 1")
   .bind(userId,operationId,operationId).first<Pending>();
}
async function orderFor(env:Env,orderId:string):Promise<Pending|null>{
 return env.DB.prepare("SELECT "+RESULT_FIELDS+" FROM subscription_orders o JOIN subscription_plan_versions v ON v.id=o.plan_version_id JOIN subscription_payment_transactions t ON t.order_id=o.id WHERE o.id=?")
   .bind(orderId).first<Pending>();
}
function cachedCashier(row:Pending,config:Mk99Config):string|null{
 if(row.checkout_state!=='ready'||row.status!=='pending'||row.transaction_status!=='pending'||row.risk_state!=='clear'||!row.cashier_url)return null;
 try{const url=new URL(row.cashier_url);
  if(url.protocol!=='https:'||url.username||url.password||!config.cashierOrigins.includes(url.origin))return null;
  return row.cashier_url;
 }catch{return null;}
}
function snapshot(row:Pending,config:Mk99Config){
 const paymentUrl=cachedCashier(row,config);
 return {id:row.id,planCode:row.plan_code,kind:row.kind,amountFen:row.amount_fen,currency:'CNY',
  channel:row.payment_channel,status:row.status,checkout:{
   outcome:paymentUrl?'ready':row.verified_paid===1?'confirmed':'unknown',paymentUrl,
   // MK99 cashier creation is never a payment fact.
   paymentConfirmed:row.verified_paid===1
  }};
}
function sameOrder(row:Pending,planId:string,channel:PaymentChannel,kind:string,merchantAccount:string,signType:string):boolean{
 return row.plan_version_id===planId&&row.payment_channel===channel&&
   row.kind===kind&&row.merchant_account===merchantAccount&&row.notification_sign_type===signType;
}

/**
 * Creates one immutable user-owned order + transaction for a new 30-day
 * subscription purchase or a single queued renewal. It does NOT grant any
 * subscription days. Only authenticated, verified MK99 settlement may do that.
 *
 * Duplicate client submissions return their original *local* order and cached
 * cashier. Unknown provider create results cannot trigger another MK99 create.
 */
export async function createSubscriptionCheckout(request:Request,env:Env):Promise<Response>{
 if(!checkoutEnabled(env))throw new ApiFailure(404,'NOT_FOUND','接口不存在。');
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=='web')throw new ApiFailure(403,'WEB_SESSION_REQUIRED','请在官网登录后操作。');
 requireWebOrigin(request,env);
 await requireCsrf(request,env,token);
 const body=await jsonBody(request,1024);
 const planCode=body.planCode,channel=body.channel,idempotencyKey=body.idempotencyKey;
 if(typeof planCode!=='string'||!['basic','pro','max','ultra'].includes(planCode))
   throw new ApiFailure(400,'SUBSCRIPTION_PLAN_INVALID','订阅套餐无效。');
 if(channel!=='ALIPAY_H5'&&channel!=='WECHAT_H5')
   throw new ApiFailure(400,'PAYMENT_CHANNEL_INVALID','支付渠道无效。');
 if(typeof idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey))
   throw new ApiFailure(400,'IDEMPOTENCY_KEY_INVALID','请求标识无效。');
 if(Object.keys(body).some(key=>!['planCode','channel','idempotencyKey'].includes(key)))
   throw new ApiFailure(400,'INVALID_REQUEST','请勿提交客户端金额或附加付款参数。');

 const now=nowMs(),operationId='sub-checkout:'+session.user_id+':'+idempotencyKey;
 if(!await takeRate(env,'subscription-checkout:'+session.user_id,8,60_000,now))
   throw new ApiFailure(429,'TOO_MANY_REQUESTS','订阅付款操作过于频繁。');
 const control=await paymentControl(env);
 if(control.activeMerchant!=='mk99'||!control.methods.some(m=>m.provider==='mk99'&&m.channel===channel))
   throw new ApiFailure(503,'SUBSCRIPTION_PAYMENT_UNAVAILABLE','此支付渠道尚未开放。');
 const config=mk99Config(env);
 const plan=await env.DB.prepare("SELECT id,plan_code,name_zh,price_fen,daily_limit,duration_days FROM subscription_plan_versions WHERE plan_code=? AND current=1 AND active=1")
   .bind(planCode).first<Catalog>();
 if(!plan||plan.duration_days!==30||plan.price_fen<1)
   throw new ApiFailure(404,'SUBSCRIPTION_PLAN_UNAVAILABLE','订阅档位暂时不可购买。');

 const anyActive=await env.DB.prepare("SELECT id FROM subscription_periods WHERE user_id=? AND status='active' AND start_at<=? AND end_at>? LIMIT 1").bind(session.user_id,now,now).first();
 const queued=await env.DB.prepare("SELECT id FROM subscription_periods WHERE user_id=? AND status='queued' LIMIT 1").bind(session.user_id).first();
 const kind=anyActive?'renewal':'purchase';

 // Resolve existing/ambiguous checkout before creating anything new. A new
 // idempotency key never bypasses a pending or UNKNOWN provider transaction.
 const existing=await existingFor(env,session.user_id,operationId);
 if(existing){
   if(!sameOrder(existing,plan.id,channel,existing.operation_id===operationId?existing.kind:kind,config.pid,config.notifySignType))
     throw new ApiFailure(409,'SUBSCRIPTION_PENDING_ORDER','已有未核对的订阅订单，请先查询原订单。');
   const result=snapshot(existing,config);
   const body={ok:true,order:result,resumed:true};
   if(existing.status==='paid'&&!result.checkout.paymentConfirmed)
     return response({...body,ok:false,code:'SUBSCRIPTION_PAYMENT_UNCONFIRMED'},409,env,request);
   if(!result.checkout.paymentConfirmed&&(existing.checkout_state==='unknown'||existing.checkout_state==='preparing'||existing.checkout_state==='unprepared'))
     return response({...body,ok:false,code:'SUBSCRIPTION_CHECKOUT_UNCONFIRMED'},409,env,request);
   return response(body,200,env,request);
 }
 if(queued)throw new ApiFailure(409,'SUBSCRIPTION_RENEWAL_QUEUED','已有待生效的续购，请先使用该周期。');

 const clientIp=request.headers.get('cf-connecting-ip')??'';
 if(!/^[0-9a-fA-F:.]{3,64}$/.test(clientIp))
   throw new ApiFailure(503,'CLIENT_IP_UNAVAILABLE','付款网络信息暂不可用。');
 const id=uuid(),transactionId=uuid(),tradeNo='XRHS_'+id.replaceAll('-',''),claim=uuid();
 const quoteExpires=now+30*60_000;
 const statements=[
  env.DB.prepare(
   "INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,operation_id) "+
   "SELECT ?,?,?,?,?,'pending',?,?,?,?,? FROM subscription_plan_versions v "+
   "WHERE v.id=? AND v.current=1 AND v.active=1 AND v.price_fen=? AND v.duration_days=30 "+
   "AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.status='active' AND u.archived_at IS NULL) "+
   "AND NOT EXISTS(SELECT 1 FROM subscription_orders x WHERE x.user_id=? AND x.status IN ('pending','unknown')) "+
   "AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.user_id=? AND p.status='queued') "+
   "AND ((?='renewal' AND EXISTS(SELECT 1 FROM subscription_periods p WHERE p.user_id=? AND p.status='active' AND p.start_at<=? AND p.end_at>?)) "+
   "OR (?='purchase' AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.user_id=? AND p.status='active' AND p.start_at<=? AND p.end_at>?)))"
  ).bind(id,session.user_id,plan.id,kind,plan.price_fen,now,quoteExpires,now,now,operationId,
    plan.id,plan.price_fen,session.user_id,session.user_id,session.user_id,
    kind,session.user_id,now,now,kind,session.user_id,now,now),
  env.DB.prepare(
   "INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,status,risk_state,created_at,updated_at,checkout_state,checkout_attempted_at) "+
   "SELECT ?,o.id,'mk99',?, ?, ?,o.amount_fen,?,'pending','clear',?,?,'preparing',? "+
   "FROM subscription_orders o WHERE o.id=? AND o.user_id=? AND o.operation_id=? AND o.status='pending'"
  ).bind(transactionId,config.pid,tradeNo,channel,config.notifySignType,now,now,now,id,session.user_id,operationId),
  env.DB.prepare(
   "INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN "+
   "EXISTS(SELECT 1 FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id "+
   "WHERE o.id=? AND o.user_id=? AND o.operation_id=? AND o.status='pending' AND "+
   "o.plan_version_id=? AND o.amount_fen=? AND t.id=? AND t.checkout_state='preparing' "+
   "AND t.merchant_provider='mk99' AND t.merchant_account=? AND t.provider_trade_id=? AND t.amount_fen=o.amount_fen) "+
   "AND (SELECT COUNT(*) FROM subscription_orders x WHERE x.user_id=? AND x.status IN ('pending','unknown'))=1 THEN 1 ELSE 0 END"
  ).bind(claim,id,session.user_id,operationId,plan.id,plan.price_fen,transactionId,config.pid,tradeNo,session.user_id),
  env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(claim)
 ];
 try{await env.DB.batch(statements);}
 catch{
   const recent=await existingFor(env,session.user_id,operationId);
   if(recent)throw new ApiFailure(409,'SUBSCRIPTION_PENDING_ORDER','已有订阅付款订单，请先核对原订单。');
   throw new ApiFailure(409,'SUBSCRIPTION_ORDER_CONFLICT','订阅状态已变化，请重新查看账户。');
 }
 let issued:{tradeNo:string;payUrl:string}|null=null;
 let problem='MK99_NETWORK_UNCERTAIN';
 try{
   issued=await new Mk99Client(config).create({
     outTradeNo:tradeNo,amountFen:plan.price_fen,subject:'Reply Copilot '+planCode.toUpperCase()+' 30 days',
     paytype:channel==='WECHAT_H5'?'wxpay':'alipay',clientIp,
     notifyUrl:env.API_ORIGIN+'/v1/payments/mk99/subscriptions/notify',
     returnUrl:new URL('/pricing/?subscriptionOrder='+encodeURIComponent(id),env.WEB_ORIGIN).href
   });
 }catch(error){if(error instanceof Mk99Error)problem=error.code;}
 if(issued){
   await env.DB.prepare(
    "UPDATE subscription_payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),cashier_url=?,cashier_ready_at=?,checkout_state='ready',updated_at=? "+
    "WHERE id=? AND checkout_state='preparing' AND status='pending' AND risk_state='clear' "+
    "AND (provider_payment_id IS NULL OR provider_payment_id=?)"
   ).bind(issued.tradeNo,issued.payUrl,nowMs(),nowMs(),transactionId,issued.tradeNo).run();
 }else{
   await env.DB.batch([
    env.DB.prepare("UPDATE subscription_payment_transactions SET checkout_state='unknown',status=CASE WHEN status='pending' THEN 'unknown' ELSE status END,updated_at=? WHERE id=? AND checkout_state='preparing' AND status IN ('pending','unknown')").bind(nowMs(),transactionId),
    env.DB.prepare("UPDATE subscription_orders SET status='unknown',updated_at=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=subscription_orders.id AND t.checkout_state='unknown' AND t.status='unknown')").bind(nowMs(),id)
   ]);
 }
 const current=await orderFor(env,id);
 if(!current)throw new ApiFailure(503,'SUBSCRIPTION_ORDER_UNCONFIRMED','订单状态暂无法确认。');
 const result=snapshot(current,config);
 if(result.checkout.outcome==='ready')
   return response({ok:true,order:result,resumed:false},201,env,request);
 if(result.checkout.outcome==='confirmed')
   return response({ok:true,order:result,resumed:false},201,env,request);
 return response({ok:false,order:result,code:'SUBSCRIPTION_CHECKOUT_UNCONFIRMED',message:'原订单创建结果待确认，请先查询原订单，不要重复付款。',providerIssue:problem},502,env,request);
}
