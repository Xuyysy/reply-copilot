import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from '../../lib/api';
import {phrase,readableError,useLanguage} from '../../lib/language';

type Plan={plan_code:string;price_fen:number;daily_limit:number;name_zh:string;name_en:string};
type Catalog={plans:Plan[];checkoutAvailable:boolean;paymentMethods:string[]};
type BoltAvailability={available:boolean;networks:string[]};
const visibleFiat=(c:Catalog)=>c.checkoutAvailable?c.paymentMethods.filter(v=>v==='ALIPAY_H5'||v==='WECHAT_H5'):[];

export type SubscriptionOrder={id:string;merchantProvider?:'mk99'|'xiaodou';periodStatus?:string|null;planCode:string;kind:string;amountFen:number;status:string;riskState:string;
 checkout:{outcome:string;paymentUrl:string|null;paymentConfirmed:boolean}};
type Quote={id:string;amountFen:number;expiresAt:number;periodEndsAt:number};
type Refresh={orderStatus:string;providerStatus?:string;paymentConfirmed:boolean;entitlementApplied?:boolean};
const orderPattern=/^[A-Za-z0-9_-]{1,80}$/;
const price=(amount:number)=>'¥'+(amount/100).toFixed(2);

export default function SubscriptionCheckout(){
 const language=useLanguage();
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 const [params]=useState(()=>new URLSearchParams(location.search));
 const target=params.get('plan')??'';
 const upgrade=params.get('upgrade')==='1';
 const [id,setId]=useState(params.get('order')??'');
 const [catalog,setCatalog]=useState<Catalog>();
 const [order,setOrder]=useState<SubscriptionOrder>();
 const [payUrl,setPayUrl]=useState<string|null>(null);
 const [paymentNote,setPaymentNote]=useState('');
 const [blockingOrder,setBlockingOrder]=useState<SubscriptionOrder|null>(null);
 const [channel,setChannel]=useState('');
 const [rail,setRail]=useState<'fiat'|'usdt'>('fiat');
 const [bolt,setBolt]=useState<BoltAvailability>({available:false,networks:[]});
 const [methodsLoading,setMethodsLoading]=useState(false);
 const [quote,setQuote]=useState<Quote>();
 const [error,setError]=useState<unknown>();
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const operation=useRef(false);
 const key=useRef<string|null>(null);
 const plan=catalog?.plans.find(item=>item.plan_code===target);
 useEffect(()=>{
  let active=true;
  const read=id
   ? (orderPattern.test(id)?api<{order:SubscriptionOrder}>('/v1/subscriptions/orders/'+id).then(result=>{if(active){setOrder(result.order);setPayUrl(result.order.status==='pending'&&!result.order.checkout.paymentConfirmed?result.order.checkout.paymentUrl:null);}}):Promise.reject(new ApiError('订单编号无效。','INVALID_ORDER_ID',400)))
   : Promise.all([api<Catalog>('/v1/subscriptions/plans'),api('/v1/usage')]).then(([result])=>{
     if(active){setCatalog(result);setChannel(old=>visibleFiat(result).includes(old)?old:visibleFiat(result)[0]??'');}
   });
  void read.catch(cause=>{if(active)setError(cause);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[id]);
 useEffect(()=>{
  if(id)return;
  let mounted=true;
  async function sync(){
   if(document.visibilityState==='hidden')return;
   setMethodsLoading(true);
   try{
    const [fresh,availability]=await Promise.all([
      api<Catalog>('/v1/subscriptions/plans'),
      api<BoltAvailability>('/v1/boltutil/availability').catch(()=>({available:false,networks:[]}))
    ]);
    if(!mounted)return;
    setCatalog(fresh);
    setChannel(current=>visibleFiat(fresh).includes(current)?current:visibleFiat(fresh)[0]??'');
    setBolt(availability);
   }catch{
    if(mounted){setCatalog(current=>current?{...current,checkoutAvailable:false,paymentMethods:[]}:current);setChannel('');setBolt({available:false,networks:[]});}
   }finally{if(mounted)setMethodsLoading(false);}
  }
  const onFocus=()=>void sync();
  const onVisible=()=>{if(document.visibilityState==='visible')void sync();};
  void sync();window.addEventListener('focus',onFocus);
  document.addEventListener('visibilitychange',onVisible);
  return()=>{mounted=false;window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisible);};
 },[id]);

 async function act(action:'quote'|'create'|'refresh'|'relaunch'){
  if(operation.current)return;
  operation.current=true;setBusy(true);setError(undefined);setPaymentNote('');
  try{
   if(action==='quote'){
    setQuote((await api<{quote:Quote}>('/v1/subscriptions/upgrade-quote',{method:'POST',body:JSON.stringify({planCode:target})})).quote);
   }else if(action==='create'){
    // Re-check the backend-owned merchant/channel policy immediately before a new payment.
    const fresh=await api<Catalog>('/v1/subscriptions/plans');
    const methods=visibleFiat(fresh);
    setCatalog(fresh);
    setChannel(current=>methods.includes(current)?current:methods[0]??'');
    if(rail!=='fiat'||!methods.includes(channel))throw new ApiError(
      t('支付渠道已变更，请重新选择。','Payment channel changed; choose an available method.'),'PAYMENT_METHOD_CHANGED',409);
    key.current??=crypto.randomUUID();
    const result=await api<{order:SubscriptionOrder;resumed:boolean}>('/v1/subscriptions/orders',{method:'POST',
      body:JSON.stringify({planCode:target,channel,idempotencyKey:key.current,...(upgrade?{quoteId:quote?.id}:{})})});
    showOrder(result.order);
    setPayUrl(result.order.status==='pending'?result.order.checkout.paymentUrl:null);
   }else if(action==='refresh'){
    const result=await api<Refresh>('/v1/subscriptions/orders/'+id+'/refresh',{method:'POST'});
    const detail=(await api<{order:SubscriptionOrder}>('/v1/subscriptions/orders/'+id)).order;
    setOrder(detail);
    const pending=['WAIT_BUYER_PAY','CREATED','PAYING'].includes(result.providerStatus??'');
    const url=pending&&detail.status==='pending'&&!detail.checkout.paymentConfirmed?detail.checkout.paymentUrl:null;
    setPayUrl(url);
    setPaymentNote(result.paymentConfirmed
     ?t('支付已核验，请查看账户权益。','Payment verified. Check your account entitlements.')
     :pending?(url?t('仍待付款，可继续打开原订单收银台。','Still awaiting payment. You can reopen the original cashier.')
      :t('仍待付款，但付款入口可能已失效，可重新生成二维码。','Still awaiting payment, but the cashier may have expired. You can request a new QR code.'))
     :t('平台暂未确认支付结果，请保留原订单，不要重复付款。','Payment is not confirmed. Keep the original order and avoid paying twice.'));
   }else{
    const result=await api<{order:SubscriptionOrder}>('/v1/subscriptions/orders/'+id+'/attempts',{method:'POST',body:JSON.stringify({})});
    setOrder(result.order);
    setPayUrl(result.order.status==='pending'?result.order.checkout.paymentUrl:null);
    setPaymentNote(result.order.status==='pending'
     ?t('已生成新的付款入口，旧二维码请勿再使用。','Fresh cashier generated. Do not reuse the previous QR code.')
     :t('原订单已更新，请查看支付状态。','Original order updated. Check its payment status.'));
   }
  }catch(cause){
   if(cause instanceof ApiError&&cause.order&&typeof cause.order==='object'&&'id' in cause.order&&typeof cause.order.id==='string'&&orderPattern.test(cause.order.id)){
    showOrder(cause.order as SubscriptionOrder);
   }
   if(action==='create'&&cause instanceof ApiError&&['SUBSCRIPTION_PENDING_ORDER','SUBSCRIPTION_RENEWAL_QUEUED','SUBSCRIPTION_ORDER_CONFLICT'].includes(cause.code)){
    try{
     const result=await api<{orders:SubscriptionOrder[]}>('/v1/subscriptions/orders');
     const unresolved=result.orders.find(item=>['pending','unknown','manual_review','refund_pending'].includes(item.status))
       ??result.orders.find(item=>item.periodStatus==='queued'&&item.status==='paid');
     setBlockingOrder(unresolved??null);
    }catch{setBlockingOrder(null);}
   }
   setError(cause);
  }finally{operation.current=false;setBusy(false);}
 }
 function showOrder(value:SubscriptionOrder){
  setOrder(value);setId(value.id);
  history.replaceState(null,'','/subscription-checkout/?order='+encodeURIComponent(value.id));
 }
 const signedOut=error instanceof ApiError&&error.status===401;
 const fiatMethods=catalog?visibleFiat(catalog):[];
 const usdtAvailable=bolt.available===true&&bolt.networks.length>0;
 const usdtHref='/usdt-checkout/?productType=subscription&sku='+encodeURIComponent(target)+(upgrade?'&upgrade=1':'');
 return <div className="space-y-5">
  {loading?<p role="status">{t('正在读取订阅…','Loading subscription…')}</p>:null}
  {error?<div role="alert" className="notice">{readableError(error,language)} {t('付款结果不明时，请在账户中心查看原单。','If payment is uncertain, check the original order in your account.')}</div>:null}
  {blockingOrder?<p role="status">{blockingOrder.periodStatus==='queued'
   ?t('你已有付款成功、等待生效的下一期订阅。','You already have a paid renewal queued for the next period.')
   :t('检测到一笔需要先处理的原订单。','An earlier order needs your attention.')}
   {' '}<a className="underline" href={'/subscription-checkout/?order='+encodeURIComponent(blockingOrder.id)}>{t('查看并继续原订单','Open the original order')}</a>
  </p>:null}
  {signedOut?<a className="button" href="/login/">{t('登录后返回购买','Sign in, then return to checkout')}</a>:null}
  {order?<section className="pricing-card space-y-3">
   <p className="break-all">{t('订单号','Order')}: {order.id}</p>
   <p className="uppercase">{order.planCode} · {price(order.amountFen)}</p>
   <p>{subscriptionStatus(order,language)}</p>
   {paymentNote?<p role="status">{paymentNote}</p>:null}
   {order.status==='pending'&&!order.checkout.paymentConfirmed&&payUrl?<a className="button" href={payUrl} target="_blank" rel="noopener noreferrer">{t('打开原订单收银台','Open original checkout')}</a>:null}
   {['pending','unknown','paid','manual_review','refund_pending'].includes(order.status)?
    <button className="button secondary" disabled={busy} onClick={()=>void act('refresh')}>{t('查验付款状态','Verify payment status')}</button>:null}
   {order.merchantProvider==='xiaodou'&&order.status==='pending'&&!order.checkout.paymentConfirmed?
    <button className="button secondary" disabled={busy} onClick={()=>void act('relaunch')}>{t('重新生成原订单二维码','Generate new QR code for this order')}</button>:null}
   <a className="button secondary" href="/account/">{t('返回账户查看权益','View account and entitlements')}</a>
  </section>:null}
  {!id&&!loading&&plan&&catalog?<section className="pricing-card space-y-4">
   <h2>{language==='en'?plan.name_en:plan.name_zh}</h2>
   {upgrade?<p>{quote?t(`本期升档补差价 ${price(quote.amountFen)}，原到期时间不变。`,`Upgrade for ${price(quote.amountFen)}. Your current expiry stays the same.`)
    :t('先获取服务端报价。剩余不足 24 小时可购买下一期。','Get a quote first. With less than 24 hours remaining, purchase the next period.')}</p>
    :<p>{price(plan.price_fen)} · {t('30 天，不自动续费。若已有订阅，则为下一期。','30 days, no auto-renewal. Active subscribers purchase their next period.')}</p>}
   <fieldset className="space-y-3" disabled={busy||methodsLoading}>
     <legend className="font-semibold">{t('选择支付方式','Select payment method')}</legend>
     <div className="grid gap-3 sm:grid-cols-2">
      {fiatMethods.map(value=><label key={value} className={'flex cursor-pointer items-center gap-3 rounded-xl border p-4 '+(rail==='fiat'&&channel===value?'border-blue-500 bg-blue-50':'bg-white')}>
       <input type="radio" name="payment-method" checked={rail==='fiat'&&channel===value} onChange={()=>{setRail('fiat');setChannel(value);setQuote(undefined);}}/>
       <strong>{value==='WECHAT_H5'?t('微信支付','WeChat Pay'):t('支付宝','Alipay')}</strong>
      </label>)}
      <label className={'flex cursor-pointer items-center gap-3 rounded-xl border p-4 '+(rail==='usdt'?'border-blue-500 bg-blue-50':'bg-white')}>
       <input type="radio" name="payment-method" checked={rail==='usdt'} onChange={()=>{setRail('usdt');setQuote(undefined);}}/>
       <span><strong>USDT</strong><small className="block text-muted-foreground">{usdtAvailable?t('TRON / Polygon / BNB','TRON / Polygon / BNB'):t('暂未开放','Not available')}</small></span>
      </label>
     </div>
    </fieldset>
    {methodsLoading?<p role="status">{t('正在同步可用支付方式…','Refreshing payment methods…')}</p>:null}
    {rail==='usdt'?<div className="space-y-3 rounded-xl border bg-slate-50 p-4">
      <p>{t('下一步选择 TRON、Polygon 或 BNB 网络。','Next choose TRON, Polygon or BNB network.')}</p>
      {usdtAvailable?<a className="button" href={usdtHref}>{t('继续选择 USDT 网络','Continue to USDT networks')}</a>:
       <p role="status" className="notice">{t('USDT 收款尚未配置，无法创建真实订单。','USDT not configured; real payment orders are disabled.')}</p>}
     </div>:<>
     {upgrade&&!quote?<button className="button" disabled={busy||methodsLoading||!fiatMethods.includes(channel)} onClick={()=>void act('quote')}>{t('获取升档报价','Get upgrade quote')}</button>:<>
      {quote?<p>{t('报价有效至','Quote expires at')} {new Date(quote.expiresAt).toLocaleTimeString()}</p>:null}
      <button className="button" disabled={busy||methodsLoading||!fiatMethods.includes(channel)||Boolean(quote&&quote.expiresAt<=Date.now())} onClick={()=>void act('create')}>{t('确认金额并创建订单','Confirm amount and create order')}</button>
      {quote?<button className="button secondary" disabled={busy} onClick={()=>void act('quote')}>{t('重新报价','Refresh quote')}</button>:null}
     </>}
    </>}
    <p><a href="/terms/">{t('服务条款','Terms')}</a> · <a href="/refunds/">{t('退款说明','Refunds')}</a></p>
  </section>:null}
  {!id&&!loading&&catalog&&!plan?<p role="status">{t('所选订阅暂不可购买。','This subscription is unavailable.')}</p>:null}
  <a href="/pricing/">{t('查看套餐','View plans')}</a>
 </div>;
}

export function subscriptionStatus(order:SubscriptionOrder,language:'zh'|'en'){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 switch(order.status){
  case 'paid': return order.checkout.paymentConfirmed?(order.periodStatus==='queued'?t('付款已核验，下一期订阅已排队，将在当前订阅期满后生效。','Payment verified. Your next period is queued and starts after the current subscription ends.'):t('付款已核验，权益已处理。','Payment verified and entitlement processed.')):t('权益待核验。','Entitlement verification pending.');
  case 'pending': return t('待付款。付款后请查验原单。','Awaiting payment. Verify the original order after paying.');
  case 'unknown': return t('付款结果未确认，请勿重复付款。','Payment is unconfirmed. Do not pay again.');
  case 'refund_pending': return t('退款或风控审核中。','Refund or risk review in progress.');
  case 'manual_review': return t('订单待人工核对，请勿重复付款。','Order requires review. Do not pay again.');
  case 'refunded': return t('已退款。','Refunded.');
  case 'closed': return t('订单已关闭。','Order closed.');
  case 'failed': return t('订单未完成。','Order failed.');
  default: return t('状态暂不可用。','Status unavailable.');
 }
}
