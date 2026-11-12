import type {Env,Session} from './types';
import {ApiFailure} from './types';
import {requireAdminSession} from './admin-auth';
import {paymentControl} from './payment-policy';
import {xiaodouNetworkReady} from './xiaodou-merchant';
import {projectXiaodouSellerPricing, type PackagePricing} from './pricing';
import {operation,commitOperation} from './admin-operations';
import {jsonBody,nowMs} from './security';
import {response} from './http';
import {createOrder} from './payments';

const PILOT_PACKAGE='starter';
const PILOT_MAX_FEN=1000; // Only the existing ¥9.90 starter package may be used.
const PILOT_INTERVAL_MS=86_400_000;
export const PILOT_PACKAGE_PREFIX='【小豆生产验收】';
const PILOT_CONFIRMATION='CREATE_REAL_ALIPAY_TEST_ORDER';

async function status(env:Env,actor:Session){
 const control=await paymentControl(env);
 const pkg=await env.DB.prepare("SELECT id,name_zh,credits,price_cents,promo_price_cents,price_cny_fen,settlement_mode,exchange_rate_micros,fee_rate_bps FROM recharge_packages WHERE id=? AND active=1").bind(PILOT_PACKAGE).first<{id:string;name_zh:string;credits:number}&PackagePricing>();
 let amountFen:number|null=null;
 try{if(pkg)amountFen=projectXiaodouSellerPricing(pkg).totalPaymentFen;}catch{/* Fail closed on changing prices. */}
 const recent=await env.DB.prepare("SELECT count(*) n FROM admin_operations WHERE actor_user_id=? AND action='xiaodou_production_pilot_checkout' AND created_at>=?").bind(actor.user_id,nowMs()-PILOT_INTERVAL_MS).first<{n:number}>();
 const latest=await env.DB.prepare("SELECT o.id,o.status,o.created_at,t.status payment_status FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id WHERE o.user_id=? AND o.package_name LIKE '【小豆生产验收】%' AND t.merchant_provider='xiaodou' ORDER BY o.created_at DESC LIMIT 1").bind(actor.user_id).first<{id:string;status:string;created_at:number;payment_status:string}>();
 const blockers:string[]=[];
 if(env.ENVIRONMENT!=='production')blockers.push('production_only');
 if(env.XIAODOU_PRODUCTION_PILOT_ENABLED!=='1')blockers.push('pilot_disabled');
 // This is a distinct operator attestation: RSA2 connectivity is NOT proof
 // that Alipay or this merchant's declared virtual-goods trade scope is licensed.
 if(env.XIAODOU_PRODUCTION_PILOT_TRADE_APPROVED!=='1')blockers.push('vendor_approval_unconfirmed');
 if(control.activeMerchant!=='mk99')blockers.push('mk99_must_remain_active');
 if(!control.environmentReady||!control.operatorEnabled)blockers.push('global_sales_paused');
 if(!control.providers.rsa2.enabled||!control.providers.rsa2.credentialsConfigured||!control.channels.rsa2.alipay.enabled)blockers.push('rsa2_unavailable');
 if(!xiaodouNetworkReady(env)||env.XIAODOU_WEBHOOKS_ENABLED!=='1')blockers.push('network_or_webhook_unavailable');
 if(amountFen===null||amountFen<1||amountFen>PILOT_MAX_FEN)blockers.push('starter_price_exceeds_limit');
 if(Number(recent?.n??0)>0)blockers.push('daily_test_attempt_used');
 return {eligible:blockers.length===0,blockers,packageId:PILOT_PACKAGE,packageName:pkg?.name_zh??null,credits:pkg?.credits??null,amountFen,limitFen:PILOT_MAX_FEN,attemptsPer24h:1,activeMerchant:control.activeMerchant,lastOrder:latest?{id:latest.id,status:latest.status,paymentStatus:latest.payment_status,createdAt:latest.created_at}:null};
}

export async function adminXiaodouPilotStatus(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env);
 return response(await status(env,actor),200,env,request);
}

export async function adminXiaodouPilotCheckout(request:Request,env:Env):Promise<Response>{
 const actor=await requireAdminSession(request,env,true);
 const body=await jsonBody(request,2048);
 const allowed=['operationId','reason','packageId','expectedAmountFen','confirmation'];
 if(Object.keys(body).some(key=>!allowed.includes(key))||body.packageId!==PILOT_PACKAGE||
   body.confirmation!==PILOT_CONFIRMATION||!Number.isSafeInteger(body.expectedAmountFen))
   throw new ApiFailure(400,'INVALID_PILOT_REQUEST','请明确确认真实人民币付款金额。');
 const gate=await status(env,actor);
 if(!gate.eligible)throw new ApiFailure(409,'XIAODOU_PILOT_NOT_READY','小豆生产验收条件未全部满足，禁止创建付款订单。');
 if(body.expectedAmountFen!==gate.amountFen)throw new ApiFailure(409,'PILOT_PRICE_CHANGED','测试金额已变化，请刷新后重新确认。');
 const op=await operation(env,actor,body,'xiaodou_production_pilot_checkout',actor.user_id);
 if(op.replayed)throw new ApiFailure(409,'PILOT_ATTEMPT_ALREADY_USED','此测试操作已记录，请核对原订单，勿重复付款。');
 // Audit and reserve the attempt BEFORE any provider-side payment creation.
 // A failed/uncertain network response still counts toward the one-per-day cap.
 await commitOperation(env,op,[],{activeMerchant:gate.activeMerchant},
   {packageId:PILOT_PACKAGE,amountFen:gate.amountFen,channel:'ALIPAY_H5',result:'reserved_no_charge_yet'});
 const internalRequest=new Request(request.url,{method:'POST',headers:request.headers,
   body:JSON.stringify({packageId:PILOT_PACKAGE,channel:'ALIPAY_H5'})});
 return createOrder(internalRequest,env,{pilot:{actorUserId:actor.user_id,operationId:op.id}});
}
