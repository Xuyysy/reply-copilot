import type {Env} from "../types";
import {ApiFailure} from "../types";
import {sessionFor,requireCsrf,takeRate} from "../auth";
import {requireWebOrigin,jsonBody,uuid,nowMs} from "../security";
import {response} from "../http";
import {projectMk99Pricing} from "../pricing";
import {quoteSubscriptionUpgrade,SUBSCRIPTION_DAY_MS} from "../../../domain/subscription-policy.js";
import {subscriptionsEnabled,subscriptionAccount} from "../subscription-account";
import {quoteFromCnyFen,formatMicros,decimalMicros,parseBoltNetwork,validReceivingAddress,tokenRawUnits,NETWORKS,SUPPORTED_BOLT_NETWORKS,type BoltNetwork} from "./contract";
import {boltRequest} from "./client";
import {settleBoltPayment} from "./settle";

export function boltAvailable(env:Env):boolean {
  return env.ENVIRONMENT==="staging" && env.BOLTUTIL_SCHEMA_READY==="1" && env.BOLTUTIL_ENABLED==="1" &&
    env.BOLTUTIL_STAGING_CREATE_ENABLED==="1" && !!env.BOLTUTIL_API_KEY &&
    !!env.BOLTUTIL_WEBHOOK_SECRET && !!env.BOLTUTIL_CNY_PER_USDT_MICROS &&
    /^[1-9][0-9]{5,8}$/.test(env.BOLTUTIL_CNY_PER_USDT_MICROS);
}
function networkEnabled(env:Env,network:BoltNetwork):boolean {
  const flag=network==="TRC20"?env.BOLTUTIL_TRC20_ENABLED:
    network==="POLYGON"?env.BOLTUTIL_POLYGON_ENABLED:env.BOLTUTIL_BEP20_ENABLED;
  return boltAvailable(env)&&flag==="1";
}
function enabled(env:Env):void {
  if(!boltAvailable(env)) throw new ApiFailure(503,"BOLTUTIL_UNAVAILABLE","USDT 测试通道暂未开放。");
}
async function owner(request:Request,env:Env,write:boolean){
  const {session,token}=await sessionFor(request,env);
  if(session.kind!=="web")throw new ApiFailure(403,"WEB_SESSION_REQUIRED","请在官网登录。");
  if(write){requireWebOrigin(request,env);await requireCsrf(request,env,token);}
  return session;
}
type Order = {
  id:string; external_order_id:string; user_id:string; operation_id:string;
  network:BoltNetwork;token_contract:string;token_decimals:number;payable_token_raw:string|null;
  product_type:"credits"|"subscription";credit_order_id:string|null;subscription_order_id:string|null;
  base_amount_fen:number;cny_per_usdt_micros:number;quoted_usdt_micros:number;
  payable_usdt_micros:number|null;paid_usdt_micros:number|null;
  receiving_address:string|null;tx_hash:string|null;checkout_url:string|null;
  expires_at:number|null;status:string;paid_at:number|null;applied_at:number|null;
};
function snapshot(row:Order){
  const payable=row.payable_usdt_micros===null?null:formatMicros(BigInt(row.payable_usdt_micros));
  return {id:row.id,productType:row.product_type,creditOrderId:row.credit_order_id,
    subscriptionOrderId:row.subscription_order_id,baseAmountFen:row.base_amount_fen,
    quotedAmount:formatMicros(BigInt(row.quoted_usdt_micros)),amount:payable,
    address:row.receiving_address,network:row.network,tokenContract:row.token_contract,
    tokenDecimals:row.token_decimals,rawAmount:row.payable_token_raw,currency:"USDT",
    checkoutUrl:row.status==="pending"?row.checkout_url:null,
    expiresAt:row.expires_at,status:row.status,paidAt:row.paid_at,
    entitlementApplied:row.applied_at!==null};
}
async function orderById(env:Env,id:string):Promise<Order|null> {
  return env.DB.prepare("SELECT * FROM boltutil_orders WHERE id=?").bind(id).first<Order>();
}
async function orderByOperation(env:Env,userId:string,operationId:string):Promise<Order|null>{
  return env.DB.prepare("SELECT * FROM boltutil_orders WHERE user_id=? AND operation_id=?")
    .bind(userId,operationId).first<Order>();
}
function onlyId(v:unknown):string {
  if(typeof v!=="string"||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v))
    throw new ApiFailure(400,"INVALID_ORDER_ID","订单编号无效。");
  return v;
}
export async function publicBoltAvailability(request:Request,env:Env):Promise<Response>{
  const networks=SUPPORTED_BOLT_NETWORKS.filter(network=>networkEnabled(env,network));
  return response({available:networks.length>0,currency:"USDT",networks,
    products:["credits","subscription"],independentMerchant:true},200,env,request);
}
export async function createBoltUpgradeQuote(request:Request,env:Env):Promise<Response>{
  enabled(env);if(!subscriptionsEnabled(env)||env.SUBSCRIPTION_PURCHASES_ENABLED!=="1")
    throw new ApiFailure(503,"SUBSCRIPTION_UNAVAILABLE","订阅暂未开放。");
  const user=await owner(request,env,true),body=await jsonBody(request,1024);
  if(Object.keys(body).length!==1||!["basic","pro","max","ultra"].includes(String(body.planCode)))
    throw new ApiFailure(400,"SUBSCRIPTION_PLAN_INVALID","目标订阅无效。");
  const now=nowMs();
  if(!await takeRate(env,"bolt-quote:"+user.user_id,8,60000,now))
    throw new ApiFailure(429,"TOO_MANY_REQUESTS","报价过于频繁。");
  const active=await subscriptionAccount(env,user.user_id,now);
  if(active.status!=="active")throw new ApiFailure(409,"SUBSCRIPTION_UPGRADE_UNAVAILABLE","当前没有可升级的订阅。");
  const row=await env.DB.prepare("SELECT p.id,p.start_at,p.end_at,a.id from_version_id,a.plan_code current_code,a.price_fen current_price,b.id to_version_id,b.plan_code target_code,b.price_fen target_price FROM subscription_periods p JOIN subscription_plan_versions a ON a.id=p.plan_version_id JOIN subscription_plan_versions b ON b.plan_code=? AND b.current=1 AND b.active=1 WHERE p.user_id=? AND p.status='active' AND p.start_at<=? AND p.end_at>?")
    .bind(body.planCode,user.user_id,now,now).first<Record<string,any>>();
  if(!row||row.end_at-now<SUBSCRIPTION_DAY_MS)
    throw new ApiFailure(409,"SUBSCRIPTION_UPGRADE_UNAVAILABLE","当前订阅不满足升档条件。");
  let quote;
  try{quote=quoteSubscriptionUpgrade({currentPlan:row.current_code,targetPlan:row.target_code,
    periodStartAt:row.start_at,expiresAt:row.end_at,now,
    currentPriceFen:row.current_price,targetPriceFen:row.target_price});}
  catch{throw new ApiFailure(409,"SUBSCRIPTION_UPGRADE_UNAVAILABLE","升级报价不适用。");}
  const id=uuid(),expiry=Math.min(now+300000,row.end_at-SUBSCRIPTION_DAY_MS+1);
  await env.DB.prepare("INSERT INTO subscription_upgrade_quotes(id,user_id,period_id,from_version_id,to_version_id,amount_fen,quoted_at,expires_at,period_end_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(id,user.user_id,row.id,row.from_version_id,row.to_version_id,quote.amountFen,now,expiry,row.end_at).run();
  return response({quote:{id,amountFen:quote.amountFen,currency:"CNY",expiresAt:expiry,
    usdtEstimate:formatMicros(quoteFromCnyFen(quote.amountFen,env.BOLTUTIL_CNY_PER_USDT_MICROS!)),
    periodEndsAt:row.end_at}},200,env,request);
}
export async function listBoltOrders(request:Request,env:Env):Promise<Response>{
  if(env.ENVIRONMENT!=="staging"||env.BOLTUTIL_SCHEMA_READY!=="1")return response({orders:[]},200,env,request);
  const user=await owner(request,env,false);
  const rows=await env.DB.prepare("SELECT * FROM boltutil_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 30")
    .bind(user.user_id).all<Order>();
  return response({orders:(rows.results??[]).map(snapshot)},200,env,request);
}
export async function getBoltOrder(request:Request,env:Env,id:string):Promise<Response>{
  if(env.ENVIRONMENT!=="staging"||env.BOLTUTIL_SCHEMA_READY!=="1")throw new ApiFailure(404,"NOT_FOUND","接口不可用。");
  const user=await owner(request,env,false),row=await orderById(env,onlyId(id));
  if(!row||row.user_id!==user.user_id)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
  return response({order:snapshot(row)},200,env,request);
}
export async function createBoltOrder(request:Request,env:Env):Promise<Response>{
  enabled(env);
  const user=await owner(request,env,true),body=await jsonBody(request,1024);
  const productType=body.productType,sku=body.sku,quoteId=body.quoteId,idempotencyKey=body.idempotencyKey;
  let network:BoltNetwork;
  try{network=parseBoltNetwork(body.network);}catch{throw new ApiFailure(400,"BOLTUTIL_NETWORK_INVALID","仅支持 TRC20、Polygon、BEP20。");}
  if(!networkEnabled(env,network))throw new ApiFailure(503,"BOLTUTIL_NETWORK_UNAVAILABLE","该 USDT 网络尚未开放。");
  if(!["credits","subscription"].includes(String(productType))||typeof sku!=="string"||
    !/^[a-z0-9_-]{1,64}$/i.test(sku)||typeof idempotencyKey!=="string"||
    !/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)||
    Object.keys(body).some(k=>!["productType","sku","quoteId","idempotencyKey","network"].includes(k)))
    throw new ApiFailure(400,"INVALID_REQUEST","购买参数无效。");
  if(productType==="credits"&&quoteId!==undefined)throw new ApiFailure(400,"INVALID_REQUEST","额度包不支持升级报价。");
  if(productType==="subscription"&&(!subscriptionsEnabled(env)||env.SUBSCRIPTION_PURCHASES_ENABLED!=="1"))
    throw new ApiFailure(503,"SUBSCRIPTION_UNAVAILABLE","订阅暂未开放。");
  if(productType==="subscription"&&!["basic","pro","max","ultra"].includes(sku))
    throw new ApiFailure(400,"SUBSCRIPTION_PLAN_INVALID","订阅档位无效。");
  if(quoteId!==undefined&&(typeof quoteId!=="string"||!/^[0-9a-f-]{36}$/i.test(quoteId)))
    throw new ApiFailure(400,"SUBSCRIPTION_QUOTE_INVALID","升级报价无效。");
  const operationId="bolt:"+user.user_id+":"+idempotencyKey;
  const existing=await orderByOperation(env,user.user_id,operationId);
  if(existing){
    if(existing.network!==network||existing.product_type!==productType)
      throw new ApiFailure(409,"BOLTUTIL_IDEMPOTENCY_CONFLICT","原订单已绑定另一条网络或商品，请核对原单。");
    return response({order:snapshot(existing),resumed:true},200,env,request);
  }
  const now=nowMs();
  if(!await takeRate(env,"bolt-checkout:"+user.user_id,8,60000,now))
    throw new ApiFailure(429,"TOO_MANY_REQUESTS","创建订单过于频繁。");
  const id=uuid(),targetId=uuid(),externalId="XRHU_"+id.replace(/-/g,"");
  let baseFen:number,priceCents=0,credits=0,packageName="",planVersion="";
  let subKind:"purchase"|"renewal"|"upgrade"="purchase",periodId:string|null=null;
  if(productType==="credits"){
    const pkg=await env.DB.prepare("SELECT id,name_zh,credits,price_cents,promo_price_cents,currency,price_cny_fen,settlement_mode,exchange_rate_micros,fee_rate_bps FROM recharge_packages WHERE id=? AND active=1")
      .bind(sku).first<Record<string,any>>();
    if(!pkg)throw new ApiFailure(404,"PACKAGE_NOT_FOUND","额度包已下架。");
    const price=projectMk99Pricing(pkg);
    baseFen=price.totalPaymentFen;priceCents=pkg.promo_price_cents??pkg.price_cents;
    credits=pkg.credits;packageName=pkg.name_zh;
  }else{
    const plan=await env.DB.prepare("SELECT id,price_fen,duration_days FROM subscription_plan_versions WHERE plan_code=? AND current=1 AND active=1")
      .bind(sku).first<{id:string;price_fen:number;duration_days:number}>();
    if(!plan||plan.duration_days!==30)throw new ApiFailure(404,"SUBSCRIPTION_PLAN_UNAVAILABLE","订阅档位不可用。");
    planVersion=plan.id;baseFen=plan.price_fen;
    const active=await env.DB.prepare("SELECT id FROM subscription_periods WHERE user_id=? AND status IN ('active','refund_pending','revoked') AND start_at<=? AND end_at>?")
      .bind(user.user_id,now,now).first<{id:string}>();
    if(quoteId){
      const q=await env.DB.prepare("SELECT id,period_id,to_version_id,amount_fen,expires_at,period_end_at FROM subscription_upgrade_quotes WHERE id=? AND user_id=? AND order_id IS NULL AND expires_at>? AND to_version_id=?")
        .bind(quoteId,user.user_id,now,planVersion).first<Record<string,any>>();
      if(!q||!active||q.period_id!==active.id||q.period_end_at-now<SUBSCRIPTION_DAY_MS)
        throw new ApiFailure(409,"SUBSCRIPTION_QUOTE_EXPIRED","升级报价已失效。");
      subKind="upgrade";periodId=q.period_id;baseFen=q.amount_fen;
    }else subKind=active?"renewal":"purchase";
    const blocking=await env.DB.prepare("SELECT 1 FROM subscription_orders WHERE user_id=? AND status IN ('pending','unknown','manual_review','refund_pending') LIMIT 1")
      .bind(user.user_id).first();
    const queued=await env.DB.prepare("SELECT 1 FROM subscription_periods WHERE user_id=? AND status='queued' LIMIT 1")
      .bind(user.user_id).first();
    if(blocking||queued)throw new ApiFailure(409,"SUBSCRIPTION_PENDING_ORDER","已有未完成或待生效订阅，请处理原单。");
  }
  let quoted:bigint;
  try{quoted=quoteFromCnyFen(baseFen,env.BOLTUTIL_CNY_PER_USDT_MICROS!);}
  catch{throw new ApiFailure(503,"BOLTUTIL_PRICE_INVALID","USDT 价格尚未正确配置，暂不能下单。");}
  const rate=Number(env.BOLTUTIL_CNY_PER_USDT_MICROS);
  const statements:D1PreparedStatement[]=[];
  if(productType==="credits"){
    statements.push(env.DB.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,payment_method,provider_reference,created_at) SELECT ?,?,?,?, ?,?,'USD','awaiting_payment','boltutil',?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND archived_at IS NULL)")
      .bind(targetId,user.user_id,sku,packageName,credits,priceCents,externalId,now,user.user_id));
  }else{
    statements.push(env.DB.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,target_period_id,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,operation_id) SELECT ?,?,?,?, ?,?,'pending',?,?,?, ?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND archived_at IS NULL)")
      .bind(targetId,user.user_id,planVersion,subKind,periodId,baseFen,now,now+300000,now,now,operationId,user.user_id));
    if(subKind==="upgrade") statements.push(env.DB.prepare("UPDATE subscription_upgrade_quotes SET order_id=? WHERE id=? AND user_id=? AND order_id IS NULL AND expires_at>?")
      .bind(targetId,quoteId,user.user_id,now));
  }
  statements.push(env.DB.prepare("INSERT INTO boltutil_orders(id,external_order_id,user_id,operation_id,product_type,credit_order_id,subscription_order_id,network,token_contract,token_decimals,base_amount_fen,cny_per_usdt_micros,quoted_usdt_micros,status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?, 'creating',?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND archived_at IS NULL)")
    .bind(id,externalId,user.user_id,operationId,productType,productType==="credits"?targetId:null,
      productType==="subscription"?targetId:null,network,NETWORKS[network].contract,NETWORKS[network].decimals,
      baseFen,rate,Number(quoted),now,now,user.user_id));
  statements.push(env.DB.prepare("INSERT INTO credit_operation_assertions(operation_id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM boltutil_orders WHERE id=? AND user_id=?) AND EXISTS(SELECT 1 FROM "+(productType==="credits"?"recharge_orders":"subscription_orders")+" WHERE id=? AND user_id=?) THEN 1 ELSE 0 END")
    .bind("bolt-create:"+id,id,user.user_id,targetId,user.user_id));
  statements.push(env.DB.prepare("DELETE FROM credit_operation_assertions WHERE operation_id=?").bind("bolt-create:"+id));
  try{await env.DB.batch(statements);}
  catch{const retry=await orderByOperation(env,user.user_id,operationId);if(retry)return response({order:snapshot(retry),resumed:true},200,env,request);
    throw new ApiFailure(409,"BOLTUTIL_ORDER_CONFLICT","订单状态冲突，请查询原订单。");}
  let provider:Record<string,unknown>;
  try{
    provider=await boltRequest(env,"/api/v1/order/create",{
      externalOrderId:externalId,amount:formatMicros(quoted),currency:"USDT",network,
      notifyUrl:env.API_ORIGIN+"/v1/boltutil/webhook",
      returnUrl:env.WEB_ORIGIN+"/usdt-checkout/?order="+encodeURIComponent(id)
    });
    const pay=provider.payment as Record<string,unknown>|undefined;
    const time=provider.time as Record<string,unknown>|undefined;
    if(provider.merchantExternalId!==externalId||!pay||
       pay.currency!=="USDT"||pay.network!==network||
       typeof pay.amount!=="string"||!validReceivingAddress(pay.address,network)||
       pay.decimal!==NETWORKS[network].decimals ||
       typeof pay.rawAmount!=="string"||!/^(0|[1-9][0-9]*)$/.test(pay.rawAmount)||
       typeof provider.checkoutUrl!=="string"||
       !/^https:\/\/([a-z0-9-]+\.)*boltutil\.com\//i.test(provider.checkoutUrl)||
       !time||!Number.isSafeInteger(time.expireTimestamp)||time.expireTimestamp<=now)
      throw new Error("untrusted create reply");
    const payable=decimalMicros(pay.amount);
    if(payable<quoted||pay.rawAmount!==tokenRawUnits(payable,network).toString())
      throw new Error("payment lower than quote or raw units mismatch");
    await env.DB.prepare("UPDATE boltutil_orders SET payable_usdt_micros=?,payable_token_raw=?,receiving_address=?,checkout_url=?,expires_at=?,status='pending',updated_at=? WHERE id=? AND status='creating' AND network=?")
      .bind(Number(payable),pay.rawAmount,pay.address,provider.checkoutUrl,time.expireTimestamp,nowMs(),id,network).run();
  }catch{
    await env.DB.prepare("UPDATE boltutil_orders SET status='unknown',updated_at=? WHERE id=? AND status='creating'")
      .bind(nowMs(),id).run();
  }
  const order=await orderById(env,id);
  return response({order:snapshot(order!),resumed:false},order?.status==="pending"?201:202,env,request);
}
export async function refreshBoltOrder(request:Request,env:Env,id:string):Promise<Response>{
  if(env.ENVIRONMENT!=="staging"||env.BOLTUTIL_SCHEMA_READY!=="1")throw new ApiFailure(404,"NOT_FOUND","接口不可用。");
  const user=await owner(request,env,true),row=await orderById(env,onlyId(id));
  if(!row||row.user_id!==user.user_id)throw new ApiFailure(404,"ORDER_NOT_FOUND","订单不存在。");
  if(!await takeRate(env,"bolt-refresh:"+user.user_id,6,60000,nowMs()))
    throw new ApiFailure(429,"TOO_MANY_REQUESTS","查询过于频繁。");
  await settleBoltPayment(env,row.external_order_id,null);
  return getBoltOrder(request,env,id);
}
