import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from '../../lib/api';
import {phrase,readableError,useLanguage} from '../../lib/language';
import {createVerifiedPaymentAutoCheck,markPaymentCashierOpened,hasPaymentCashierOpened} from '../../lib/verified-payment-auto.mjs';

type Plan={plan_code:string;price_fen:number;daily_limit:number;name_zh:string;name_en:string};
type Catalog={plans:Plan[];checkoutAvailable:boolean;paymentMethods:string[]};
export type SubscriptionOrder={id:string;merchantProvider?:'mk99'|'xiaodou';periodStatus?:string|null;retryAvailable?:boolean;planCode:string;kind:string;amountFen:number;status:string;riskState:string;
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
 const [cashierOpened,setCashierOpened]=useState(()=>hasPaymentCashierOpened('subscription',params.get('order')??''));
 const [catalog,setCatalog]=useState<Catalog>();
 const [boltAvailable,setBoltAvailable]=useState(false);
 useEffect(()=>{
   let alive=true;
   const check=()=>{void api<{available:boolean;networks:string[]}>('/v1/boltutil/availability')
    .then(result=>{if(alive)setBoltAvailable(result.available===true&&result.networks.length>0);})
    .catch(()=>{if(alive)setBoltAvailable(false);});};
   check();window.addEventListener('focus',check);
   return()=>{alive=false;window.removeEventListener('focus',check);};
 },[]);
 const [currentSubscription,setCurrentSubscription]=useState<{status:string;plan:string|null;expiresAt:string|null}|null>(null);
 const [order,setOrder]=useState<SubscriptionOrder>();
 const [payUrl,setPayUrl]=useState<string|null>(null);
 const [paymentNote,setPaymentNote]=useState('');
 const [blockingOrder,setBlockingOrder]=useState<SubscriptionOrder|null>(null);
 const [channel,setChannel]=useState('');
 const [payWithUsdt,setPayWithUsdt]=useState(false);
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
   : Promise.all([api<Catalog>('/v1/subscriptions/plans'),api<{subscription?:{status:string;plan:string|null;expiresAt:string|null}}>('/v1/usage')]).then(([result,usage])=>{
     if(active){setCatalog(result);setChannel(result.paymentMethods[0]??'');setCurrentSubscription(usage.subscription??null);}
   });
  void read.catch(cause=>{if(active)setError(cause);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[id]);

 // Payment-return UX: bounded local GET monitoring, and only a previously
 // opened original cashier permits the existing authenticated merchant POST.
 // React cleanup stops stale-account/order notifications and all timers.
 useEffect(()=>{
  if(!order||order.id!==id||!['pending','unknown'].includes(order.status)||order.checkout.paymentConfirmed||
     (!cashierOpened&&!hasPaymentCashierOpened('subscription',id)))return;
  let active=true,reading=false,readCount=0,timer:ReturnType<typeof setTimeout>|null=null;
  const clear=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  const reconcile=createVerifiedPaymentAutoCheck({kind:'subscription',orderId:id,request:api,
   onVerified:(confirmed:SubscriptionOrder)=>{
    if(!active||confirmed.id!==id)return;
    setOrder(confirmed);setPayUrl(null);
    setPaymentNote(confirmed.periodStatus==='queued'
     ?t('付款已核验，下一期已排队，将在当前订阅结束后生效。','Payment verified. Your next period is queued.')
     :t('付款已核验，订阅权益已处理。','Payment verified. Subscription entitlement applied.'));
   }});
  const schedule=()=>{
   clear();
   if(active&&readCount<48&&document.visibilityState!=='hidden'&&document.hasFocus?.()!==false)
    timer=setTimeout(()=>{void tick();},2500);
  };
  async function tick(){
   if(!active||reading||document.visibilityState==='hidden'||document.hasFocus?.()===false||readCount>=48)return;
   if(operation.current){schedule();return;}
   reading=true;readCount++;
   try{
    const latest=(await api<{order:SubscriptionOrder}>('/v1/subscriptions/orders/'+encodeURIComponent(id))).order;
    if(!active||latest.id!==id)return;
    setOrder(latest);
    if(['pending','unknown'].includes(latest.status)&&!latest.checkout.paymentConfirmed)
      await reconcile.onPending(latest);
    if(!active)return;
    if(['pending','unknown'].includes(latest.status)&&!latest.checkout.paymentConfirmed)schedule();
    else{clear();setPayUrl(null);}
   }catch(error){
    if(active&&!([401,403,404].includes((error as ApiError)?.status)))schedule();
   }finally{reading=false;}
  }
  const resume=()=>{if(active&&document.visibilityState!=='hidden'&&document.hasFocus?.()!==false){clear();void tick();}};
  const visible=()=>{if(document.visibilityState==='hidden')clear();else resume();};
  window.addEventListener('pageshow',resume);
  window.addEventListener('focus',resume);
  document.addEventListener('visibilitychange',visible);
  schedule();
  return()=>{active=false;clear();reconcile.stop();
   window.removeEventListener('pageshow',resume);
   window.removeEventListener('focus',resume);
   document.removeEventListener('visibilitychange',visible);
  };
 },[id,cashierOpened,order?.status,order?.checkout.paymentConfirmed,order?.merchantProvider]);

 async function act(action:'quote'|'create'|'refresh'|'relaunch'|'cancel'){
  if(operation.current)return;
  operation.current=true;setBusy(true);setError(undefined);setPaymentNote('');
  try{
   if(action==='quote'){
    setQuote((await api<{quote:Quote}>('/v1/subscriptions/upgrade-quote',{method:'POST',body:JSON.stringify({planCode:target})})).quote);
   }else if(action==='create'){
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
   }else if(action==='cancel'){
    if(!window.confirm(t('确认取消这笔未付款订阅吗？如果已经支付，请先查验原订单。平台确认关单后才能重新购买。','Cancel this unpaid subscription? If you paid, verify the original order first. New purchases are allowed only after the merchant confirms closure.')))return;
    const result=await api<{order:SubscriptionOrder}>('/v1/subscriptions/orders/'+id+'/cancel',{method:'POST',body:JSON.stringify({})});
    setOrder(result.order);setPayUrl(null);
    setPaymentNote(t('原订单已由支付平台确认关闭。现在可以返回套餐页重新购买。','Merchant confirmed the original order is closed. You may return to the plans and buy again.'));
   }else{
    const result=await api<{order:SubscriptionOrder}>('/v1/subscriptions/orders/'+id+'/attempts',{method:'POST',body:JSON.stringify({})});
    setOrder(result.order);
    setPayUrl(result.order.status==='pending'?result.order.checkout.paymentUrl:null);
    setPaymentNote(result.order.status==='pending'
     ?t('已生成新的付款入口，旧二维码请勿再使用。','Fresh cashier generated. Do not reuse the previous QR code.')
     :t('原订单已更新，请查看支付状态。','Original order updated. Check its payment status.'));
   }
  }catch(cause){
   const canRetry=action==='create'&&cause instanceof ApiError&&
     (cause.order as SubscriptionOrder|undefined)?.retryAvailable===true;
   if(canRetry){
     // Do not latch the original UNKNOWN order or reuse its idempotency key.
     key.current=null;setPayUrl(null);setBlockingOrder(null);
     if(upgrade)setQuote(undefined);
     setPaymentNote(t('未生成收银台，已解除购买限制；请重新点击购买。','No cashier was issued. You may start a new purchase.'));
   }else if(cause instanceof ApiError&&cause.order&&typeof cause.order==='object'&&'id' in cause.order&&typeof cause.order.id==='string'&&orderPattern.test(cause.order.id)){
     showOrder(cause.order as SubscriptionOrder);
   }
   if(!canRetry&&action==='create'&&cause instanceof ApiError&&['SUBSCRIPTION_PENDING_ORDER','SUBSCRIPTION_RENEWAL_QUEUED','SUBSCRIPTION_ORDER_CONFLICT'].includes(cause.code)){
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
 const tierOrder=['basic','pro','max','ultra'];
 const higherTier=currentSubscription?.status==='active'&&tierOrder.indexOf(target)>tierOrder.indexOf(currentSubscription.plan??'')&&tierOrder.indexOf(currentSubscription.plan??'')>=0;
 const canUpgradeNow=Boolean(higherTier&&currentSubscription?.expiresAt&&
   new Date(currentSubscription.expiresAt).getTime()-Date.now()>=24*60*60*1000);
 const fiatCheckoutAvailable=Boolean(catalog&&catalog.checkoutAvailable&&catalog.paymentMethods.length>0);
 const usdtSelected=Boolean(boltAvailable&&(payWithUsdt||!fiatCheckoutAvailable));
 const usdtCheckoutHref='/usdt-checkout/?productType=subscription&sku='+encodeURIComponent(target)+(upgrade?'&upgrade=1':'');
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
   {order.retryAvailable?<a className="button secondary" href={'/subscription-checkout/?plan='+encodeURIComponent(order.planCode)+(order.kind==='upgrade'?'&upgrade=1':'')}>{t('重新购买订阅','Purchase subscription again')}</a>:null}
   {paymentNote?<p role="status">{paymentNote}</p>:null}
   {order.status==='pending'&&!order.checkout.paymentConfirmed&&payUrl?<a className="button" href={payUrl} target="_blank" rel="noopener noreferrer" onClick={()=>{markPaymentCashierOpened('subscription',order.id);setCashierOpened(true);}}>{t('打开原订单收银台','Open original checkout')}</a>:null}
   {['pending','unknown','paid','manual_review','refund_pending'].includes(order.status)?
    <button className="button secondary" disabled={busy} onClick={()=>void act('refresh')}>{t('查验付款状态','Verify payment status')}</button>:null}
   {order.merchantProvider==='xiaodou'&&order.status==='pending'&&!order.checkout.paymentConfirmed?
    <button className="button secondary" disabled={busy} onClick={()=>void act('relaunch')}>{t('重新生成原订单二维码','Generate new QR code for this order')}</button>:null}
   {order.merchantProvider==='xiaodou'&&order.status==='pending'&&!order.checkout.paymentConfirmed?
    <button className="button secondary" disabled={busy} onClick={()=>void act('cancel')}>{t('取消未付款原订单（平台确认后可重买）','Cancel unpaid order (buy again once confirmed)')}</button>:null}
   {['closed','failed'].includes(order.status)?
    <a className="button secondary" href="/pricing/">{t('返回套餐页重新购买','Return to plans and buy again')}</a>:null}
   <a className="button secondary" href="/account/">{t('返回账户查看权益','View account and entitlements')}</a>
  </section>:null}
  {!id&&!loading&&plan&&catalog&&(fiatCheckoutAvailable||boltAvailable)?<section className="pricing-card space-y-3">
   <h2>{language==='en'?plan.name_en:plan.name_zh}</h2>
   {upgrade?<p>{usdtSelected
    ?t('USDT 升档补差价将在下一步由服务端报价；原到期时间不变。','The USDT cashier will quote the prorated upgrade; expiry stays unchanged.')
    :quote?t(`本期升档补差价 ${price(quote.amountFen)}，原到期时间不变。`,`Upgrade for ${price(quote.amountFen)}. Your current expiry stays the same.`)
    :t('人民币升档请先获取服务端报价。剩余不足 24 小时可购买下一期。','Get a server quote for a fiat upgrade. Buy the next period if less than 24 hours remain.')}</p>
    :<>
     <p>{price(plan.price_fen)} · {t('30 天，不自动续费。若已有订阅，则为下一期。','30 days, no auto-renewal. Active subscribers purchase their next period.')}</p>
     {currentSubscription?.status==='active'&&<p role="status" className="notice">{t('注意：你已有 '+(currentSubscription.plan??'').toUpperCase()+' 订阅。这里按完整价格购买下一期 '+target.toUpperCase()+'，当前订阅不会立即变更。','You already have '+(currentSubscription.plan??'').toUpperCase()+'. This purchases the NEXT '+target.toUpperCase()+' period at full price; your current subscription stays unchanged.')}</p>}
     {canUpgradeNow&&<p>{t('想立即升档并按本期剩余时间补差价？','Want to upgrade your current period for a prorated amount instead?')}{' '}
      <a className="button secondary" href={'/subscription-checkout/?plan='+encodeURIComponent(target)+'&upgrade=1'}>{t('改为本期升档（服务端报价）','Upgrade this period (server quote)')}</a></p>}
     {higherTier&&!canUpgradeNow&&<p className="fineprint">{t('本期剩余不足 24 小时，不能升档；只能购买下一期。','Less than 24 hours remain. You can only buy the next period.')}</p>}
    </>}
   <fieldset disabled={busy}><legend>{t('支付方式','Payment method')}</legend>
    <div className="grid gap-3 sm:grid-cols-2">
     {fiatCheckoutAvailable&&catalog.paymentMethods.map(value=><label key={value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${!usdtSelected&&channel===value?'border-blue-500 ring-1 ring-blue-500':''}`}><input type="radio" name="payment-method" checked={!usdtSelected&&channel===value} onChange={()=>{setPayWithUsdt(false);setChannel(value);}} /> {value==='WECHAT_H5'?t('微信支付','WeChat Pay'):t('支付宝','Alipay')}</label>)}
     {boltAvailable?<label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${usdtSelected?'border-blue-500 ring-1 ring-blue-500':''}`}><input type="radio" name="payment-method" value="USDT" checked={usdtSelected} onChange={()=>setPayWithUsdt(true)} /> {t('USDT · 五链付款','USDT · Five-network payment')}</label>:null}
    </div>
   </fieldset>
   {usdtSelected?<p className="text-sm text-muted-foreground">{t('下一步选择 TRON、Polygon、BNB、Ethereum 或 Solana；按服务端订单核对网络、收款地址及准确应付数量。','Choose TRON, Polygon, BNB, Ethereum or Solana next; verify the exact server-issued invoice before paying.')}</p>:null}
   <p><a href="/terms/">{t('服务条款','Terms')}</a> · <a href="/refunds/">{t('退款说明','Refunds')}</a></p>
   {usdtSelected
    ?<a className="button" href={usdtCheckoutHref}>{t('继续使用 USDT 付款','Continue with USDT')}</a>
    :upgrade&&!quote
     ?<button className="button" disabled={busy} onClick={()=>void act('quote')}>{t('获取升档报价','Get upgrade quote')}</button>
     :<button className="button" disabled={busy||!channel||Boolean(quote&&quote.expiresAt<=Date.now())} onClick={()=>void act('create')}>{t('确认金额并创建订单','Confirm amount and create order')}</button>}
   {quote&&!usdtSelected?<p>{t('报价有效至','Quote expires at')} {new Date(quote.expiresAt).toLocaleTimeString()}</p>:null}
   {quote&&!usdtSelected?<button className="button secondary" disabled={busy} onClick={()=>void act('quote')}>{t('重新报价','Refresh quote')}</button>:null}
  </section>:null}
  {!id&&!loading&&catalog&&(!plan||(!fiatCheckoutAvailable&&!boltAvailable))?<p role="status">{t('所选订阅暂不可购买。永久额度购买不受影响。','This subscription is unavailable. Permanent credits are still available.')}</p>:null}
  <a href="/pricing/">{t('查看套餐','View plans')}</a>
 </div>;
}

export function subscriptionStatus(order:SubscriptionOrder,language:'zh'|'en'){
 const t=(zh:string,en:string)=>phrase(language,zh,en);
 if(order.status==='unknown'&&order.retryAvailable)return t('原单未生成收银台，可重新购买；原单仍保留等待可信核验。','No cashier was issued. You may buy again; the original remains available for verification.');
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
