// The server supplies an origin only after checking its configured cashier allowlist.
export function safeMk99Cashier(order, orderId) {
 if(order?.id!==orderId || order.paymentProvider!=='mk99' || order.paymentProtocol!=='mk99'
  || order.status!=='pending' || order.riskState!=='clear' || order.creditedAt!=null || order.paidAt!=null) return null;
 try {
  if(typeof order.paymentUrl!=='string' || /[\\\u0000-\u0020\u007f]/.test(order.paymentUrl))return null;
  const url=new URL(order.paymentUrl),origin=new URL(order.paymentCashierOrigin);
  if(url.protocol!=='https:' || url.username || url.password || url.port || url.hash
   || origin.protocol!=='https:' || origin.origin!==order.paymentCashierOrigin || origin.port || origin.username || origin.password
   || url.origin!==origin.origin)return null;
  return url.href;
 } catch{return null;}
}
export function canResumeMk99Order(order) {
 return order?.provider==='mk99' && order.payment_protocol==='mk99'
  && order.payment_status==='pending' && order.risk_state==='clear' && order.credited_at==null && order.paid_at==null && ['pending','awaiting_payment'].includes(order.status);
}
function resumeFailure(order){
 const state=order?.riskState!=='clear'?'manual_review':order?.status;
 return Object.assign(new Error('PAYMENT_RESUME_UNAVAILABLE'),{paymentState:state});
}
export function paymentResumeMessage(error,language){
 const messages={paid:['该订单已付款，请刷新账户查看到账记录，不要再次付款。','This order is already paid. Refresh your account to check credits; do not pay again.'],closed:['该订单已关闭，不能继续支付。请联系客服。','This order is closed and cannot be paid. Contact support.'],failed:['该订单支付失败，无法继续支付。请刷新状态或联系客服。','Payment failed for this order. Refresh its status or contact support.'],refunded:['该订单已退款，不能继续支付。','This order was refunded and cannot be paid.'],unknown:['支付结果尚未确认，请刷新订单状态或联系客服，不要重复付款。','Payment is unconfirmed. Refresh its status or contact support; do not pay again.'],manual_review:['该订单需要人工核对，请联系客服，不要继续付款。','This order needs manual review. Contact support; do not continue paying.']};
 return (messages[error?.paymentState]||['无法确认该订单仍可付款。请刷新订单状态或联系客服；旧收银台链接可能已失效，不会自动新建订单。','This order could not be confirmed as payable. Refresh its status or contact support. The original cashier link may have expired; no new order will be created.'])[language==='en'?1:0];
}
export async function resumeMk99Payment(orderId,{inFlight,request,remember,navigate}) {
 if(inFlight.has(orderId))return false;
 inFlight.add(orderId);
 try {
  const path='/v1/orders/'+encodeURIComponent(orderId);
  const initial=await request(path,{method:'GET'});
  if(!safeMk99Cashier(initial?.order,orderId))throw resumeFailure(initial?.order);
  // Query the existing transaction only. Never create or renew a cashier transaction.
  const checked=await request(path+'/refresh',{method:'POST',body:'{}'});
  if(checked?.ok!==true || checked.orderStatus!=='pending' || checked.verificationSource!=='authenticated_https_query')throw resumeFailure({status:checked?.orderStatus,riskState:'clear'});
  const latest=await request(path,{method:'GET'}),url=safeMk99Cashier(latest?.order,orderId);
  if(!url || url!==safeMk99Cashier(initial.order,orderId))throw resumeFailure(latest?.order);
  remember(orderId);navigate(url);return true;
 } finally {inFlight.delete(orderId);}
}
