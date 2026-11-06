import {validPaymentOrderId,safeMk99Cashier} from './payment-resume.mjs';
export function checkoutResumeId(href,remembered){
 const url=new URL(href);
 const id=url.searchParams.has('order')?url.searchParams.get('order'):url.searchParams.get('payment_order')||(url.searchParams.has('package')?null:remembered);
 if(id!==null&&id!==undefined&&id!==''&&!validPaymentOrderId(id))throw new Error('INVALID_ORDER_ID');
 if(url.searchParams.has('order')&&!validPaymentOrderId(id))throw new Error('INVALID_ORDER_ID');
 return id||null;
}
export async function loadOrderCheckout(id,request,{queryUnknown=false}={}){
 if(!validPaymentOrderId(id))throw new Error('INVALID_ORDER_ID');
 const path='/v1/orders/'+encodeURIComponent(id);
 const read=async()=>{const r=await request(path,{method:'GET'});if(r?.order?.id!==id)throw new Error('ORDER_MISMATCH');return r.order;};
 let order=await read();
 if(order.paymentProtocol!=='mk99'||(order.status!=='pending'&&!(queryUnknown&&order.status==='unknown'))||order.riskState!=='clear'||order.creditedAt!=null||order.paidAt!=null)return {order,verified:false};
 try{
  const checked=await request(path+'/refresh',{method:'POST',body:'{}'});order=await read();
  const verified=checked?.ok===true&&checked.orderStatus==='pending'&&checked.verificationSource==='authenticated_https_query'&&Boolean(safeMk99Cashier(order,id));
  return {order,verified};
 }catch{return {order,verified:false};}
}
