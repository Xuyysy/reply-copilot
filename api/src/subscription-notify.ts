import type { Env } from './types';
import { ApiFailure } from './types';
import { nowMs } from './security';
import { Mk99Client, Mk99Error, mk99Config, parseMk99Form,
  verifyAndParseMk99Notification, type Mk99PaymentEvent } from './mk99';
import { notifyContentTypeClass, readMk99Body, parseMk99MultipartForm } from './mk99-payments';
import { recordSubscriptionRisk } from './subscription-risk';
import { orderById, reconcileVerifiedSubscriptionPurchase } from './subscription-settlement';

/** Signed notification uses the original MK99 contract, but settles only in
 * the isolated subscription ledger. No permanent-credit grant or manual paid
 * flags. A signed SUCCESS must also pass a fixed HTTPS merchant-authenticated
 * QUERY of the same provider transaction before the subscription is granted.
 *
 * This endpoint is independent of checkout sales switches: outstanding paid
 * orders must remain recoverable if future sales are paused.
 */
export async function subscriptionMk99Notify(request:Request,env:Env):Promise<Response>{
 if(env.SUBSCRIPTIONS_ENABLED!=='1')
   throw new ApiFailure(404,'NOT_FOUND','接口不存在。');
 const cls=notifyContentTypeClass(request.headers.get('content-type'));
 if(cls!=='form_urlencoded'&&cls!=='multipart')
   throw new ApiFailure(415,'INVALID_PAYMENT_NOTIFY','支付通知格式无效。');
 let bytes:Uint8Array;
 try{bytes=await readMk99Body(request.body,16384);}
 catch{throw new ApiFailure(400,'INVALID_PAYMENT_NOTIFY','支付通知正文无效。');}
 let form:Record<string,string>;
 try{
   if(cls==='multipart')form=await parseMk99MultipartForm(bytes,request.headers.get('content-type')!,request.url);
   else form=parseMk99Form(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }catch{throw new ApiFailure(400,'INVALID_PAYMENT_NOTIFY','支付通知内容无效。');}
 const cfg=mk99Config(env);
 let signed:Mk99PaymentEvent|null;
 try{signed=await verifyAndParseMk99Notification(form,form.out_trade_no??'',cfg);}
 catch(error){
   if(error instanceof Mk99Error)throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','订阅商户通知字段与订单不符。');
   throw error;
 }
 if(!signed)throw new ApiFailure(401,'INVALID_PAYMENT_SIGNATURE','商户通知签名无效。');
 const now=nowMs();
 if(signed.timestamp===undefined||signed.timestamp*1000>now+300000)
   throw new ApiFailure(409,'PAYMENT_TIMESTAMP_INVALID','支付通知时间异常。');

 type NoticeRow={id:string;user_id:string;order_id:string;amount_fen:number;payment_channel:string;
   merchant_account:string|null;notification_sign_type:string|null;provider_payment_id:string|null;
   provider_trade_id:string;payment_status:string;risk_state:string;order_status:string};
 const row=await env.DB.prepare(`SELECT t.id,t.provider_trade_id,t.provider_payment_id,
      t.merchant_account,t.notification_sign_type,t.amount_fen,t.payment_channel,
      t.status payment_status,t.risk_state,o.id order_id,o.user_id,o.status order_status
    FROM subscription_payment_transactions t JOIN subscription_orders o ON o.id=t.order_id
    WHERE t.merchant_provider='mk99' AND t.provider_trade_id=?`)
    .bind(signed.outTradeNo).first<NoticeRow>();
 if(!row)throw new ApiFailure(404,'ORDER_NOT_FOUND','订阅支付订单不存在。');
 const expectedChannel=row.payment_channel==='WECHAT_H5'?'wxpay':'alipay';
 if(row.merchant_account!==cfg.pid||row.notification_sign_type!==cfg.notifySignType||
    signed.merchantId!==cfg.pid||signed.amountFen!==row.amount_fen||
    (signed.currency!==undefined&&signed.currency!=='CNY')||
    signed.paytypeCode!==expectedChannel||
    (row.provider_payment_id!=null&&row.provider_payment_id!==signed.tradeNo))
   throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','通知金额、商户或渠道与原订单不一致。');

 // Signed success is an authenticated hint, NOT a payment grant. Confirm by
 // querying the pinned MK99 HTTPS merchant endpoint, then reuse the same
 // atomic proof/period state machine used by user-initiated refresh.
 if(signed.tradeStatus==='TRADE_SUCCESS'){
   const order=await orderById(env,row.order_id);
   if(!order||order.user_id!==row.user_id)
     throw new ApiFailure(409,'SUBSCRIPTION_ORDER_CONFLICT','订阅订单已改变。');
   let verified:Mk99PaymentEvent;
   try{verified=await new Mk99Client(cfg).query(row.provider_trade_id);}
   catch{throw new ApiFailure(502,'MK99_QUERY_UNAVAILABLE','正在等待商户查询确认。');}
   if(verified.tradeStatus!=='TRADE_SUCCESS'||verified.outTradeNo!==signed.outTradeNo||
      verified.tradeNo!==signed.tradeNo||verified.amountFen!==signed.amountFen||
      (verified.merchantId!==undefined&&verified.merchantId!==cfg.pid)||
      (verified.paytypeCode!==undefined&&verified.paytypeCode!==expectedChannel))
     throw new ApiFailure(409,'SUBSCRIPTION_PAYMENT_MISMATCH','签名通知与可信商户查单结果不一致。');
   await reconcileVerifiedSubscriptionPurchase(env,order,verified);
   return new Response('success',{status:200,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
 }

 const reason=signed.tradeStatus;
 await recordSubscriptionRisk(env,row,signed,now);
 if(reason==='TRADE_CLOSED'&&row.order_status!=='paid'){
   await env.DB.batch([
     env.DB.prepare(`UPDATE subscription_payment_transactions SET status='closed',updated_at=?
       WHERE id=? AND status IN ('pending','unknown') AND risk_state='clear'`)
       .bind(now,row.id),
     env.DB.prepare(`UPDATE subscription_orders SET status='closed',updated_at=?
       WHERE id=? AND status IN ('pending','unknown') AND EXISTS(
        SELECT 1 FROM subscription_payment_transactions t WHERE t.order_id=subscription_orders.id
          AND t.status='closed' AND t.risk_state='clear')`).bind(now,row.order_id)
   ]);
 }
 return new Response('success',{status:200,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
}
