import type { Env } from './types';
import { ApiFailure } from './types';
import { sessionFor, requireCsrf, takeRate } from './auth';
import { requireWebOrigin, jsonBody, nowMs, uuid } from './security';
import { response } from './http';
import { paymentControl, type PaymentChannel } from './payment-policy';
import { Mk99Client, Mk99Error, mk99Config, type Mk99Config } from './mk99';
import { configuredXiaodouMerchant } from './xiaodou-merchant';
import { inspectCheckoutResponse,CheckoutValidationError } from './payment-checkout';
import { subscriptionRetryableSql,subscriptionBlocksNewCheckoutSql } from './subscription-retry-release.js';
import {reconcileClosedBoltSubscriptionsForUser} from './boltutil/terminal';
import {closeExpiredUnpaidBoltOrdersForUser} from './boltutil/expiry';
import { quoteSubscriptionUpgrade, SUBSCRIPTION_DAY_MS } from '../../domain/subscription-policy.js';
import { subscriptionAccount, subscriptionsEnabled } from './subscription-account';
import { orderById, querySubscriptionPayment, reconcileUnpaidXiaodouTerminal } from './subscription-settlement';

// Explicit third switch: the subscription catalog and existing-order paid
// reconciliation can be tested WITHOUT allowing a single new real checkout.
export const checkoutEnabled=(env:Env)=>subscriptionsEnabled(env)
  && env.SUBSCRIPTION_PURCHASES_ENABLED==='1'
  && env.SUBSCRIPTION_CHECKOUT_ENABLED==='1';

type Catalog={id:string;plan_code:string;name_zh:string;price_fen:number;daily_limit:number;duration_days:number};
type UpgradeQuote={id:string;user_id:string;period_id:string;from_version_id:string;to_version_id:string;
 amount_fen:number;quoted_at:number;expires_at:number;period_end_at:number;order_id:string|null};
type Pending={
 id:string;user_id:string;operation_id:string|null;kind:string;
 plan_version_id:string;plan_code:string;amount_fen:number;payment_channel:string;
 status:string;transaction_status:string;risk_state:string;checkout_state:string;
 cashier_url:string|null;provider_trade_id:string;provider_payment_id:string|null;
 merchant_account:string|null;notification_sign_type:string|null;merchant_provider:string;paid_at:number|null;
 verified_paid:number;checkout_retryable:number;quote_id:string|null;period_status:string|null;
};
const RESULT_FIELDS=`(SELECT id FROM subscription_upgrade_quotes WHERE order_id=o.id) quote_id,${subscriptionRetryableSql('o')} checkout_retryable,(SELECT p.status FROM subscription_periods p WHERE p.source_order_id=o.id AND p.user_id=o.user_id LIMIT 1) period_status,o.id,o.user_id,o.operation_id,o.kind,o.plan_version_id,v.plan_code,o.amount_fen,t.payment_channel,o.status,t.status transaction_status,t.risk_state,t.checkout_state,t.cashier_url,t.provider_trade_id,t.provider_payment_id,t.merchant_account,t.notification_sign_type,t.merchant_provider,o.paid_at,CASE WHEN
   o.status='paid' AND o.paid_at IS NOT NULL AND o.applied_at IS NOT NULL
   AND t.status='paid' AND t.paid_at IS NOT NULL AND t.risk_state='clear'
   AND t.merchant_provider IN ('mk99','xiaodou') AND t.currency='CNY' AND t.amount_fen=o.amount_fen
   AND (EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id AND p.user_id=o.user_id
     AND p.status IN ('active','queued','expired'))
     OR EXISTS(SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=o.id AND c.period_id=o.target_period_id))
   AND EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id
     AND e.merchant_provider=t.merchant_provider AND e.event_type='PAYMENT_SUCCEEDED'
     AND e.amount_fen=t.amount_fen AND e.body_sha256 IS NOT NULL)
   THEN 1 ELSE 0 END verified_paid`;
async function existingFor(env:Env,userId:string,operationId:string):Promise<Pending|null>{
 return env.DB.prepare("SELECT "+RESULT_FIELDS+` FROM subscription_orders o JOIN subscription_plan_versions v ON v.id=o.plan_version_id JOIN subscription_payment_transactions t ON t.order_id=o.id WHERE o.user_id=? AND (o.operation_id=? OR ${subscriptionBlocksNewCheckoutSql('o')}) ORDER BY CASE WHEN o.operation_id=? THEN 0 ELSE 1 END,o.created_at DESC LIMIT 1`)
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
function snapshot(row:Pending,config:Mk99Config|null){
 let paymentUrl:string|null=null;
 if(row.merchant_provider==='mk99'&&config&&row.merchant_account===config.pid&&row.notification_sign_type===config.notifySignType)paymentUrl=cachedCashier(row,config);
 else if(row.merchant_provider==='xiaodou'&&row.checkout_state==='ready'&&row.status==='pending'&&row.transaction_status==='pending'&&row.risk_state==='clear'&&row.cashier_url){
   try{const url=new URL(row.cashier_url);if(url.protocol==='https:'&&!url.username&&!url.password&&row.cashier_url.length<=8192)paymentUrl=row.cashier_url;}catch{/* Ignore invalid historical URL. */}
 }
 return {id:row.id,planCode:row.plan_code,kind:row.kind,merchantProvider:row.merchant_provider,periodStatus:row.verified_paid===1?row.period_status:null,retryAvailable:Number(row.checkout_retryable)===1,amountFen:row.amount_fen,currency:'CNY',
  channel:row.payment_channel,status:row.status,riskState:row.risk_state,checkout:{
   outcome:paymentUrl?'ready':row.verified_paid===1?'confirmed':'unknown',paymentUrl,
   // MK99 cashier creation is never a payment fact.
   paymentConfirmed:row.verified_paid===1
  }};
}
export async function subscriptionOrders(request:Request,env:Env,id?:string):Promise<Response>{
 if(!subscriptionsEnabled(env))throw new ApiFailure(404,'NOT_FOUND','接口不存在。');
 const {session}=await sessionFor(request,env);
 if(session.kind!=='web')throw new ApiFailure(403,'WEB_SESSION_REQUIRED','请在官网登录后操作。');
 if(id){
   const row=await orderFor(env,id);
   if(!row||row.user_id!==session.user_id)throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');
   let config:Mk99Config|null=null;
   if(row.merchant_provider==='mk99')try{config=mk99Config(env);}catch{/* Preserve historical order visibility. */}
   return response({order:snapshot(row,config)},200,env,request);
 }
 // On an authenticated pricing/account read, reconcile at most one original
 // Xiaodou OR MK99 attempt with the appropriate authenticated merchant query.
 // No expiry-time guess,
 // no new charge, and no automatic release on timeout or network failure.
 const unresolved=await env.DB.prepare(
   "SELECT o.id FROM subscription_orders o "+
   "JOIN subscription_payment_transactions t ON t.order_id=o.id "+
   "WHERE o.user_id=? AND o.status IN ('pending','unknown') AND t.merchant_provider IN ('xiaodou','mk99') "+
   "AND t.status IN ('pending','unknown') AND t.risk_state='clear' "+
   "AND NOT ("+subscriptionRetryableSql('o')+") "+
   "ORDER BY o.created_at ASC LIMIT 1").bind(session.user_id).first<{id:string}>();
 if(unresolved){
   try{
     if(await takeRate(env,'subscription-list-reconcile:'+session.user_id,2,60_000,nowMs())){
       const original=await orderById(env,unresolved.id);
       if(original?.user_id===session.user_id)await querySubscriptionPayment(env,original);
     }
   }catch{/* Provider failures leave the original blocking state intact. */}
 }
 const rows=await env.DB.prepare(`SELECT ${RESULT_FIELDS} FROM subscription_orders o
   JOIN subscription_plan_versions v ON v.id=o.plan_version_id JOIN subscription_payment_transactions t ON t.order_id=o.id
   WHERE o.user_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 50`).bind(session.user_id).all<Pending>();
 return response({orders:(rows.results??[]).map(row=>snapshot(row,null))},200,env,request);
}
function sameOrder(row:Pending,planId:string,channel:PaymentChannel,kind:string,merchantProvider:string,merchantAccount:string,signType:string):boolean{
 return row.merchant_provider===merchantProvider&&row.plan_version_id===planId&&row.payment_channel===channel&&
   row.kind===kind&&row.merchant_account===merchantAccount&&row.notification_sign_type===signType;
}

export async function createSubscriptionUpgradeQuote(request:Request,env:Env):Promise<Response>{
 if(!checkoutEnabled(env))throw new ApiFailure(404,'NOT_FOUND','接口不存在。');
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=='web')throw new ApiFailure(403,'WEB_SESSION_REQUIRED','请在官网登录后操作。');
 requireWebOrigin(request,env);
 await requireCsrf(request,env,token);
 const body=await jsonBody(request,1024);
 if(Object.keys(body).length!==1||typeof body.planCode!=='string'||!['basic','pro','max','ultra'].includes(body.planCode))
   throw new ApiFailure(400,'SUBSCRIPTION_PLAN_INVALID','订阅套餐无效。');
 const now=nowMs();
 if(!await takeRate(env,'subscription-upgrade-quote:'+session.user_id,8,60_000,now))
   throw new ApiFailure(429,'TOO_MANY_REQUESTS','报价操作过于频繁。');
 const account=await subscriptionAccount(env,session.user_id,now);
 if(account.status!=='active')throw new ApiFailure(409,'SUBSCRIPTION_UPGRADE_UNAVAILABLE','当前无可升级的订阅。');
 const row=await env.DB.prepare(`SELECT p.id,p.start_at,p.end_at,
    a.id from_version_id,a.plan_code current_code,a.price_fen current_price,
    b.id to_version_id,b.plan_code target_code,b.price_fen target_price
   FROM subscription_periods p JOIN subscription_plan_versions a ON a.id=p.plan_version_id
   JOIN subscription_plan_versions b ON b.plan_code=? AND b.active=1 AND b.current=1
   WHERE p.user_id=? AND p.status='active' AND p.start_at<=? AND p.end_at>?`)
   .bind(body.planCode,session.user_id,now,now).first<{id:string;start_at:number;end_at:number;
     from_version_id:string;current_code:string;current_price:number;to_version_id:string;target_code:string;target_price:number}>();
 if(!row)throw new ApiFailure(409,'SUBSCRIPTION_UPGRADE_UNAVAILABLE','当前套餐暂不可升级。');
 if(row.end_at-now<SUBSCRIPTION_DAY_MS)
   throw new ApiFailure(409,'SUBSCRIPTION_UPGRADE_FINAL_DAY','剩余不足 24 小时，请购买下一期。');
 let price;
 try{price=quoteSubscriptionUpgrade({currentPlan:row.current_code,targetPlan:row.target_code,
   periodStartAt:row.start_at,expiresAt:row.end_at,now,currentPriceFen:row.current_price,targetPriceFen:row.target_price});}
 catch{throw new ApiFailure(409,'SUBSCRIPTION_UPGRADE_UNAVAILABLE','当前套餐暂不可升级。');}
 const id=uuid(),expiresAt=Math.min(now+5*60_000,row.end_at-SUBSCRIPTION_DAY_MS+1);
 await env.DB.batch([
   env.DB.prepare(`DELETE FROM subscription_upgrade_quotes WHERE id IN
      (SELECT id FROM subscription_upgrade_quotes WHERE order_id IS NULL AND expires_at<=? ORDER BY expires_at LIMIT 20)`).bind(now),
   env.DB.prepare(`INSERT INTO subscription_upgrade_quotes
     (id,user_id,period_id,from_version_id,to_version_id,amount_fen,quoted_at,expires_at,period_end_at)
     VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,session.user_id,row.id,row.from_version_id,row.to_version_id,price.amountFen,now,expiresAt,row.end_at)
 ]);
 return response({quote:{id,planCode:row.target_code,amountFen:price.amountFen,currency:'CNY',expiresAt,periodEndsAt:row.end_at}},200,env,request);
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
 const planCode=body.planCode,channel=body.channel,idempotencyKey=body.idempotencyKey,quoteId=body.quoteId;
 if(typeof planCode!=='string'||!['basic','pro','max','ultra'].includes(planCode))
   throw new ApiFailure(400,'SUBSCRIPTION_PLAN_INVALID','订阅套餐无效。');
 if(channel!=='ALIPAY_H5'&&channel!=='WECHAT_H5')
   throw new ApiFailure(400,'PAYMENT_CHANNEL_INVALID','支付渠道无效。');
 if(typeof idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey))
   throw new ApiFailure(400,'IDEMPOTENCY_KEY_INVALID','请求标识无效。');
 if(quoteId!==undefined&&(typeof quoteId!=='string'||!/^[a-f0-9-]{36}$/i.test(quoteId)))
   throw new ApiFailure(400,'SUBSCRIPTION_QUOTE_INVALID','订阅报价无效。');
 if(Object.keys(body).some(key=>!['planCode','channel','idempotencyKey','quoteId'].includes(key)))
   throw new ApiFailure(400,'INVALID_REQUEST','请勿提交客户端金额或附加付款参数。');

 const now=nowMs(),operationId='sub-checkout:'+session.user_id+':'+idempotencyKey;
 if(!await takeRate(env,'subscription-checkout:'+session.user_id,8,60_000,now))
   throw new ApiFailure(429,'TOO_MANY_REQUESTS','订阅付款操作过于频繁。');
 const control=await paymentControl(env);
 if(!['mk99','xiaodou'].includes(control.activeMerchant)||!control.methods.some(m=>m.provider===control.activeMerchant&&m.channel===channel))
   throw new ApiFailure(503,'SUBSCRIPTION_PAYMENT_UNAVAILABLE','此支付渠道尚未开放。');
 const isXiaodou=control.activeMerchant==='xiaodou';
 if(isXiaodou&&channel!=='ALIPAY_H5')throw new ApiFailure(503,'XIAODOU_WECHAT_NOT_APPROVED','小豆微信尚未开通。');
 const config=isXiaodou?null:mk99Config(env);
 const merchantAccount=isXiaodou?(env.XIAODOU_APP_ID??''):config!.pid;
 const signType=isXiaodou?(env.XIAODOU_KEY_ID??''):config!.notifySignType;
 const merchantProvider=isXiaodou?'xiaodou':'mk99';
 if(!merchantAccount||!signType)throw new ApiFailure(503,'SUBSCRIPTION_PAYMENT_UNAVAILABLE','当前商家凭据尚未就绪。');
 const plan=await env.DB.prepare("SELECT id,plan_code,name_zh,price_fen,daily_limit,duration_days FROM subscription_plan_versions WHERE plan_code=? AND current=1 AND active=1")
   .bind(planCode).first<Catalog>();
 if(!plan||plan.duration_days!==30||plan.price_fen<1)
   throw new ApiFailure(404,'SUBSCRIPTION_PLAN_UNAVAILABLE','订阅档位暂时不可购买。');

 const hasPredecessor=await env.DB.prepare("SELECT id FROM subscription_periods WHERE user_id=? AND status IN ('active','refund_pending','revoked') AND start_at<=? AND end_at>? LIMIT 1").bind(session.user_id,now,now).first();
 const queued=await env.DB.prepare("SELECT id FROM subscription_periods WHERE user_id=? AND status='queued' AND EXISTS(SELECT 1 FROM subscription_orders o WHERE o.id=subscription_periods.source_order_id AND o.status<>'refunded') LIMIT 1").bind(session.user_id).first();
 const kind=quoteId?'upgrade':hasPredecessor?'renewal':'purchase';

 // A trusted BoltUtil terminal result may close only the old unpaid USDT invoice.
 // This runs before existingFor and the atomic SQL overlap guard; inconclusive states remain blocked.
 await closeExpiredUnpaidBoltOrdersForUser(env,session.user_id);
 await reconcileClosedBoltSubscriptionsForUser(env,session.user_id);

 // An idempotency key never re-drives the same provider transaction. A fresh
 // key only bypasses linkless first-attempt UNKNOWNs with no financial proof.
 const existing=await existingFor(env,session.user_id,operationId);
 if(existing){
   if(existing.quote_id!==(quoteId??null)||!sameOrder(existing,plan.id,channel,existing.operation_id===operationId?existing.kind:kind,merchantProvider,merchantAccount,signType))
     throw new ApiFailure(409,'SUBSCRIPTION_PENDING_ORDER','已有未核对的订阅订单，请先查询原订单。');
   if(existing.operation_id!==operationId&&!['pending','unknown'].includes(existing.status))
     throw new ApiFailure(409,'SUBSCRIPTION_PENDING_ORDER','已有订阅订单待复核，请先查看原订单。');
   const result=snapshot(existing,config);
   const body={ok:true,order:result,resumed:true};
   if(existing.status==='paid'&&!result.checkout.paymentConfirmed)
     return response({...body,ok:false,code:'SUBSCRIPTION_PAYMENT_UNCONFIRMED'},409,env,request);
   if(!result.checkout.paymentConfirmed&&(existing.checkout_state==='unknown'||existing.checkout_state==='preparing'||existing.checkout_state==='unprepared'))
     return response({...body,ok:false,code:'SUBSCRIPTION_CHECKOUT_UNCONFIRMED',
       message:result.retryAvailable?'付款链接未生成，原订单仍待核验；可以使用新的请求标识再次购买。':'原订单结果未确认，请勿重复付款。'},409,env,request);
   return response(body,200,env,request);
 }
 if(queued&&!quoteId)throw new ApiFailure(409,'SUBSCRIPTION_RENEWAL_QUEUED','已有待生效的续购，请先使用该周期。');

 const quote=quoteId?await env.DB.prepare(`SELECT * FROM subscription_upgrade_quotes
   WHERE id=? AND user_id=? AND to_version_id=? AND order_id IS NULL AND expires_at>?`)
   .bind(quoteId,session.user_id,plan.id,now).first<UpgradeQuote>():null;
 if(quoteId&&!quote)throw new ApiFailure(409,'SUBSCRIPTION_QUOTE_EXPIRED','请重新获取升级报价。');
 const amountFen=quote?.amount_fen??plan.price_fen;
 const clientIp=request.headers.get('cf-connecting-ip')??'';
 if(!/^[0-9a-fA-F:.]{3,64}$/.test(clientIp))
   throw new ApiFailure(503,'CLIENT_IP_UNAVAILABLE','付款网络信息暂不可用。');
 const id=uuid(),transactionId=uuid(),tradeNo='XRHS_'+id.replaceAll('-',''),claim=uuid();
 const quoteExpires=quote?.expires_at??now+30*60_000;
 const statements=[
  quote?env.DB.prepare(`INSERT INTO subscription_orders
      (id,user_id,plan_version_id,kind,target_period_id,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,operation_id)
     SELECT ?,q.user_id,q.to_version_id,'upgrade',q.period_id,q.amount_fen,'pending',q.quoted_at,q.expires_at,?,?,?
     FROM subscription_upgrade_quotes q JOIN subscription_periods p ON p.id=q.period_id AND p.user_id=q.user_id
     JOIN subscription_plan_versions v ON v.id=q.to_version_id
     JOIN subscription_orders source ON source.id=p.source_order_id AND source.user_id=q.user_id
     JOIN subscription_payment_transactions paid ON paid.order_id=source.id
     JOIN users u ON u.id=q.user_id
     WHERE q.id=? AND q.user_id=? AND q.order_id IS NULL AND q.expires_at>?
       AND p.status='active' AND p.plan_version_id=q.from_version_id AND p.end_at=q.period_end_at AND p.end_at-?>=?
       AND source.status='paid' AND source.applied_at IS NOT NULL AND paid.status='paid' AND paid.risk_state='clear'
       AND v.id=? AND v.current=1 AND v.active=1 AND v.daily_limit>p.daily_limit
       AND u.status='active' AND u.archived_at IS NULL
       AND NOT EXISTS(SELECT 1 FROM subscription_orders x WHERE x.user_id=q.user_id AND ${subscriptionBlocksNewCheckoutSql('x')})`)
     .bind(id,now,now,operationId,quote.id,session.user_id,now,now,SUBSCRIPTION_DAY_MS,plan.id):env.DB.prepare(
   "INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,operation_id) "+
   "SELECT ?,?,?,?,?,'pending',?,?,?,?,? FROM subscription_plan_versions v "+
   "WHERE v.id=? AND v.current=1 AND v.active=1 AND v.price_fen=? AND v.duration_days=30 "+
   "AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.status='active' AND u.archived_at IS NULL) "+
   `AND NOT EXISTS(SELECT 1 FROM subscription_orders x WHERE x.user_id=? AND ${subscriptionBlocksNewCheckoutSql('x')}) `+
   "AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.user_id=? AND p.status='queued' AND EXISTS(SELECT 1 FROM subscription_orders o WHERE o.id=p.source_order_id AND o.status<>'refunded')) "+
   "AND ((?='renewal' AND EXISTS(SELECT 1 FROM subscription_periods p WHERE p.user_id=? AND p.status IN ('active','refund_pending','revoked') AND p.start_at<=? AND p.end_at>?)) "+
   "OR (?='purchase' AND NOT EXISTS(SELECT 1 FROM subscription_periods p WHERE p.user_id=? AND p.status IN ('active','refund_pending','revoked') AND p.start_at<=? AND p.end_at>?)))"
  ).bind(id,session.user_id,plan.id,kind,plan.price_fen,now,quoteExpires,now,now,operationId,
    plan.id,plan.price_fen,session.user_id,session.user_id,session.user_id,
    kind,session.user_id,now,now,kind,session.user_id,now,now),
  ...(quote?[env.DB.prepare(`UPDATE subscription_upgrade_quotes SET order_id=? WHERE id=? AND order_id IS NULL
    AND EXISTS(SELECT 1 FROM subscription_orders WHERE id=? AND target_period_id=subscription_upgrade_quotes.period_id)`)
    .bind(id,quote.id,id)]:[]),
  env.DB.prepare(
   "INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,status,risk_state,created_at,updated_at,checkout_state,checkout_attempted_at) "+
   "SELECT ?,o.id,?, ?, ?, ?,o.amount_fen,?,'pending','clear',?,?,'preparing',? "+
   "FROM subscription_orders o WHERE o.id=? AND o.user_id=? AND o.operation_id=? AND o.status='pending' AND (SELECT value FROM system_settings WHERE key='active_merchant')=?"
  ).bind(transactionId,merchantProvider,merchantAccount,tradeNo,channel,signType,now,now,now,id,session.user_id,operationId,merchantProvider),
  env.DB.prepare(
   "INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN "+
   "EXISTS(SELECT 1 FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id "+
   "WHERE o.id=? AND o.user_id=? AND o.operation_id=? AND o.status='pending' AND "+
   "o.plan_version_id=? AND o.amount_fen=? AND t.id=? AND t.checkout_state='preparing' "+
   "AND t.merchant_provider=? AND t.merchant_account=? AND t.provider_trade_id=? AND t.amount_fen=o.amount_fen) "+
   `AND (SELECT COUNT(*) FROM subscription_orders x WHERE x.user_id=? AND ${subscriptionBlocksNewCheckoutSql('x')})=1 THEN 1 ELSE 0 END`
  ).bind(claim,id,session.user_id,operationId,plan.id,amountFen,transactionId,merchantProvider,merchantAccount,tradeNo,session.user_id),
  env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind(claim)
 ];
 try{await env.DB.batch(statements);}
 catch{
   const recent=await existingFor(env,session.user_id,operationId);
   if(recent)throw new ApiFailure(409,'SUBSCRIPTION_PENDING_ORDER','已有订阅付款订单，请先核对原订单。');
   throw new ApiFailure(409,'SUBSCRIPTION_ORDER_CONFLICT','订阅状态已变化，请重新查看账户。');
 }
 let issued:{tradeNo:string;payUrl:string}|null=null;
 let signedProviderId:string|null=null,needsReview=false;
 let problem=isXiaodou?'XIAODOU_NETWORK_UNCERTAIN':'MK99_NETWORK_UNCERTAIN';
 if(isXiaodou){
   try{
     const client=configuredXiaodouMerchant(env);
     const result=await client.createPayment({outTradeNo:tradeNo,amountFen,channel:'ALIPAY_H5',currency:'CNY',
       subject:'Reply Copilot '+planCode.toUpperCase()+(quote?' upgrade':' 30 days'),payerClientIp:clientIp,
       ...(env.XIAODOU_TRADE_SCOPE?{tradeScope:env.XIAODOU_TRADE_SCOPE}:{}),
       returnUrl:new URL('/subscription-checkout/',env.WEB_ORIGIN).href},
       {requestId:'xrh-sub-create-'+uuid()});
     const checked=inspectCheckoutResponse(result,{outTradeNo:tradeNo,amountFen});
     if(result.channel!=='ALIPAY_H5'||typeof result.openOrderId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(result.openOrderId))
       throw new Error('XIAODOU_CHECKOUT_IDENTITY_UNCONFIRMED');
     // Signed provider identity (even without cashier) is evidence that must
     // BLOCK fresh checkout until the original provider payment is reconciled.
     signedProviderId=result.openOrderId;
     if(checked.outcome==='ready'&&checked.paymentUrl)issued={tradeNo:result.openOrderId,payUrl:checked.paymentUrl};
     else problem=checked.issue;
   }catch(error){
     problem='XIAODOU_CHECKOUT_UNCONFIRMED';
     if(error instanceof CheckoutValidationError||
        (error instanceof Error&&error.message==='XIAODOU_CHECKOUT_IDENTITY_UNCONFIRMED'))needsReview=true;
   }
 }else{
   try{issued=await new Mk99Client(config!).create({
      outTradeNo:tradeNo,amountFen,subject:'Reply Copilot '+planCode.toUpperCase()+(quote?' upgrade':' 30 days'),
      paytype:channel==='WECHAT_H5'?'wxpay':'alipay',clientIp,
      notifyUrl:env.API_ORIGIN+'/v1/payments/mk99/subscriptions/notify',
      returnUrl:new URL('/subscription-checkout/?order='+encodeURIComponent(id),env.WEB_ORIGIN).href
   });}catch(error){
     if(error instanceof Mk99Error){
       problem=error.code;
       if(!['MK99_TIMEOUT','MK99_NETWORK_UNCERTAIN','MK99_HTTP_ERROR','MK99_REQUEST_REJECTED'].includes(error.code))needsReview=true;
     }
   }
 }
 if(issued){
   await env.DB.prepare(
    "UPDATE subscription_payment_transactions SET provider_payment_id=COALESCE(provider_payment_id,?),cashier_url=?,cashier_ready_at=?,checkout_state='ready',updated_at=? "+
    "WHERE id=? AND checkout_state='preparing' AND status='pending' AND risk_state='clear' "+
    "AND (provider_payment_id IS NULL OR provider_payment_id=?)"
   ).bind(issued.tradeNo,issued.payUrl,nowMs(),nowMs(),transactionId,issued.tradeNo).run();
 }else{
   await env.DB.batch([
    env.DB.prepare("UPDATE subscription_payment_transactions SET checkout_state='unknown',status=CASE WHEN status='pending' THEN 'unknown' ELSE status END,provider_payment_id=COALESCE(provider_payment_id,?),risk_state=CASE WHEN ?=1 THEN 'manual_review' ELSE risk_state END,updated_at=? WHERE id=? AND checkout_state='preparing' AND status IN ('pending','unknown')").bind(signedProviderId,needsReview?1:0,nowMs(),transactionId),
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
 return response({ok:false,order:result,code:'SUBSCRIPTION_CHECKOUT_UNCONFIRMED',message:result.retryAvailable?'付款链接未生成；本地重复购买限制已解除。请用新的请求标识购买；如有扣款请核对原单。':'原订单创建结果待确认，请先查询原订单，不要重复付款。',providerIssue:problem},502,env,request);
}


/**
 * Explicitly replace the payment attempt on the original Xiaodou subscription.
 * Every call first verifies an unpaid provider state via a signed GET. The
 * existing D1 "preparing" state is used as a single-writer claim, and any
 * ambiguous relaunch fails closed without retrying upstream.
 */
export async function relaunchSubscriptionCheckout(request:Request,env:Env,orderId:string):Promise<Response>{
 if(!checkoutEnabled(env))throw new ApiFailure(404,'NOT_FOUND','接口不存在。');
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=='web')throw new ApiFailure(403,'WEB_SESSION_REQUIRED','请在官网登录后操作。');
 requireWebOrigin(request,env);
 await requireCsrf(request,env,token);
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(orderId))throw new ApiFailure(400,'INVALID_ORDER_ID','订单号无效。');
 const row=await orderFor(env,orderId);
 if(!row||row.user_id!==session.user_id)throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');
 if(row.merchant_provider!=='xiaodou'||row.status!=='pending'||row.transaction_status!=='pending'||
    row.risk_state!=='clear'||row.checkout_state!=='ready'||row.payment_channel!=='ALIPAY_H5'||
    row.merchant_account!==env.XIAODOU_APP_ID||row.notification_sign_type!==env.XIAODOU_KEY_ID)
   throw new ApiFailure(409,'SUBSCRIPTION_ORDER_NOT_RELAUNCHABLE','原订单当前不可重新拉起付款，请先查验支付状态。');
 if(!await takeRate(env,'subscription-relaunch:'+session.user_id,3,60_000,nowMs()))
   throw new ApiFailure(429,'TOO_MANY_REQUESTS','重新拉起付款太频繁，请稍后再试。');
 const original=await orderById(env,orderId);
 if(!original)throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');
 const checked=await querySubscriptionPayment(env,original);
 if(checked.paymentConfirmed){
   const settled=await orderFor(env,orderId);
   if(!settled)throw new ApiFailure(503,'SUBSCRIPTION_ORDER_UNCONFIRMED','原订单状态暂不可用。');
   return response({ok:true,order:snapshot(settled,null)},200,env,request);
 }
 if(!('providerStatus' in checked)||!['CREATED','PAYING'].includes(String(checked.providerStatus??'')))
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_UNCONFIRMED','平台尚未确认订单可继续付款，请保留原订单。');
 // One in-flight request at a time. "preparing" is an allowed value in the
 // deployed D1 schema; no migration or direct remote D1 operation is needed.
 const now=nowMs();
 const claimed=await env.DB.prepare(
   "UPDATE subscription_payment_transactions SET checkout_state='preparing',cashier_url=NULL,checkout_attempted_at=?,updated_at=? "+
   "WHERE order_id=? AND merchant_provider='xiaodou' AND checkout_state='ready' AND status='pending' AND risk_state='clear' "+
   "AND EXISTS(SELECT 1 FROM subscription_orders o WHERE o.id=subscription_payment_transactions.order_id AND o.user_id=? AND o.status='pending')"
 ).bind(now,now,orderId,session.user_id).run();
 if(Number(claimed.meta?.changes??0)!==1)
   throw new ApiFailure(409,'SUBSCRIPTION_CHECKOUT_UNCONFIRMED','原订单状态已变化，请先查验订单。');
 let paymentUrl:string;
 try{
   const signed=await configuredXiaodouMerchant(env).relaunchPayment(row.provider_trade_id,{requestId:'xrh-sub-relaunch-'+uuid()});
   const result=inspectCheckoutResponse(signed,{outTradeNo:row.provider_trade_id,amountFen:row.amount_fen});
   if(signed.channel!=='ALIPAY_H5'||signed.openOrderId!==row.provider_payment_id||
      result.outcome!=='ready'||!result.paymentUrl)
     throw new Error('UNCONFIRMED_RELAUNCH_RESPONSE');
   paymentUrl=result.paymentUrl;
 }catch{
   await env.DB.prepare(
     "UPDATE subscription_payment_transactions SET checkout_state='unknown',updated_at=? "+
     "WHERE order_id=? AND checkout_state='preparing' AND merchant_provider='xiaodou'"
   ).bind(nowMs(),orderId).run();
   throw new ApiFailure(502,'XIAODOU_RELAUNCH_UNCONFIRMED','重新拉起结果暂无法核实，请查验原订单，勿重复创建或付款。');
 }
 const saved=await env.DB.prepare(
   "UPDATE subscription_payment_transactions SET checkout_state='ready',cashier_url=?,cashier_ready_at=?,updated_at=? "+
   "WHERE order_id=? AND merchant_provider='xiaodou' AND checkout_state='preparing' AND status='pending' AND risk_state='clear' "+
   "AND EXISTS(SELECT 1 FROM subscription_orders o WHERE o.id=subscription_payment_transactions.order_id AND o.user_id=? AND o.status='pending')"
 ).bind(paymentUrl,nowMs(),nowMs(),orderId,session.user_id).run();
 if(Number(saved.meta?.changes??0)!==1)
   throw new ApiFailure(503,'SUBSCRIPTION_CHECKOUT_UNCONFIRMED','新付款入口无法确认已保存，请查验原订单。');
 const updated=await orderFor(env,orderId);
 if(!updated)throw new ApiFailure(503,'SUBSCRIPTION_ORDER_UNCONFIRMED','原订单状态暂不可用。');
 return response({ok:true,order:snapshot(updated,null)},200,env,request);
}



/**
 * Explicit owner-confirmed cancellation of a still-unpaid Xiaodou subscription.
 * Never infer terminal state from elapsed time or an expired cashier URL.
 * Only the merchant-authenticated close endpoint can authorize release.
 */
export async function cancelUnpaidXiaodouSubscriptionCheckout(request:Request,env:Env,orderId:string):Promise<Response>{
 if(!subscriptionsEnabled(env)||env.SUBSCRIPTION_PURCHASES_ENABLED!=='1')
   throw new ApiFailure(404,'NOT_FOUND','接口不存在。');
 const {session,token}=await sessionFor(request,env);
 if(session.kind!=='web')throw new ApiFailure(403,'WEB_SESSION_REQUIRED','请在官网登录后操作。');
 requireWebOrigin(request,env);
 await requireCsrf(request,env,token);
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(orderId))throw new ApiFailure(400,'INVALID_ORDER_ID','订单号无效。');
 const input=await jsonBody(request,1024);
 if(Object.keys(input).length)throw new ApiFailure(400,'INVALID_REQUEST','取消订单不接受付款参数。');
 const row=await orderFor(env,orderId);
 if(!row||row.user_id!==session.user_id)throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');
 if(row.merchant_provider!=='xiaodou'||row.merchant_account!==env.XIAODOU_APP_ID||
    row.notification_sign_type!==env.XIAODOU_KEY_ID||row.payment_channel!=='ALIPAY_H5'||
    row.status!=='pending'||row.transaction_status!=='pending'||row.risk_state!=='clear'||row.checkout_state!=='ready')
   throw new ApiFailure(409,'SUBSCRIPTION_ORDER_NOT_CLOSABLE','原订单目前无法安全取消，请先核验付款结果。');
 if(!await takeRate(env,'subscription-close:'+session.user_id,3,60_000,nowMs()))
   throw new ApiFailure(429,'TOO_MANY_REQUESTS','取消订单太频繁，请稍后再试。');
 const original=await orderById(env,orderId);
 if(!original||original.user_id!==session.user_id)
   throw new ApiFailure(404,'ORDER_NOT_FOUND','订单不存在。');
 let result:Awaited<ReturnType<ReturnType<typeof configuredXiaodouMerchant>['closePayment']>>;
 try{result=await configuredXiaodouMerchant(env).closePayment(original.provider_trade_id,{requestId:'xrh-sub-close-'+uuid()});}
 catch{throw new ApiFailure(502,'XIAODOU_CLOSE_UNAVAILABLE','支付平台暂无法确认关闭这笔原订单，请保留原单并稍后核验。');}
 if(result.outTradeNo!==original.provider_trade_id||result.amountFen!==original.amount_fen||
    result.currency!=='CNY'||result.channel!==original.payment_channel)
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','支付平台返回的关单结果与原订单不符，请勿重复付款。');
 if(!['CLOSE_REQUESTED','ALREADY_CLOSED'].includes(result.closeState)||result.status!=='CLOSED')
   throw new ApiFailure(409,'SUBSCRIPTION_CLOSE_UNCONFIRMED','支付平台尚未确认关闭原订单，请先查验支付状态。');
 await reconcileUnpaidXiaodouTerminal(env,original,'CLOSED');
 const latest=await orderFor(env,orderId);
 if(!latest||latest.status!=='closed'||latest.transaction_status!=='closed')
   throw new ApiFailure(409,'SUBSCRIPTION_CLOSE_UNCONFIRMED','原订单状态已变化，请先查验支付状态。');
 return response({ok:true,orderStatus:'closed',order:snapshot(latest,null)},200,env,request);
}
