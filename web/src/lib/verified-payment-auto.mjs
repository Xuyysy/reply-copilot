// Browser-visible, bounded, merchant-authenticated payment reconciliation.
// The cashier marker is *permission to query*, NEVER proof that money was paid.
// Only POST /refresh followed by an owner-authenticated server GET may surface
// creditedAt or an applied subscription. Webhook and query use the same server
// ledger; this module does not invent or grant payments.
const VALID_ID=/^[A-Za-z0-9_-]{1,80}$/;
const INTERVALS=[0,8000,10000,14000,18000,25000,35000,50000];
const MAX_MARKER_AGE_MS=15*60*1000;
const markerKey=(kind,id)=>'reply-copilot:cashier-seen:'+kind+':'+id;
const budgetKey=(kind,id)=>'reply-copilot:auto-merchant-check:'+kind+':'+id;
const safeRead=(store,key)=>{try{return JSON.parse(store?.getItem(key)||'null')}catch{return null}};
const safeWrite=(store,key,value)=>{try{store?.setItem(key,JSON.stringify(value))}catch{}};
const validKind=kind=>kind==='credit'||kind==='subscription';
export function hasPaymentCashierOpened(kind,orderId,env=globalThis){
 if(!validKind(kind)||!VALID_ID.test(orderId))return false;
 const saved=safeRead(env.localStorage,markerKey(kind,orderId));
 const age=(env.now||Date.now)()-saved?.at;
 return Number.isFinite(saved?.at)&&age>=0&&age<MAX_MARKER_AGE_MS;
}
export function markPaymentCashierOpened(kind,orderId,env=globalThis){
 if(!validKind(kind)||!VALID_ID.test(orderId))return;
 safeWrite(env.localStorage,markerKey(kind,orderId),{at:(env.now||Date.now)()});
}
export function createVerifiedPaymentAutoCheck({kind,orderId,request,onVerified,environment:env=globalThis}){
 if(!validKind(kind)||!VALID_ID.test(orderId))return {onPending:async()=>{},stop:()=>{}};
 const now=env.now||Date.now,store=env.localStorage,doc=env.document,token=env.crypto?.randomUUID?.()||String(Math.random());
 let stopped=false,inFlight=false,localBudget=null;
 const mKey=markerKey(kind,orderId),bKey=budgetKey(kind,orderId);
 const eligible=(order)=>{
  if(order?.id!==orderId||!['pending','unknown'].includes(order.status))return false;
  if(order.riskState&&order.riskState!=='clear')return false;
  return kind==='credit'
   ?order.paymentProtocol==='rsa2'&&!order.creditedAt
   :['xiaodou','mk99'].includes(order.merchantProvider)&&order.checkout?.paymentConfirmed!==true;
 };
 const foreground=()=>doc?.visibilityState!=='hidden'&&doc?.hasFocus?.()!==false;
 function marker(){
  const m=safeRead(store,mKey),age=now()-m?.at;
  return Number.isFinite(m?.at)&&age>=0&&age<MAX_MARKER_AGE_MS?m.at:null;
 }
 function budget(at){
  const old=safeRead(store,bKey)||localBudget;
  return old?.markerAt===at&&Number.isSafeInteger(old.tries)&&old.tries>=0&&old.tries<=INTERVALS.length&&Number.isFinite(old.lastAt)
   ?old:{markerAt:at,tries:0,lastAt:0,leaseUntil:0,owner:null};
 }
 async function onPending(order){
  if(stopped||inFlight||!foreground()||!eligible(order))return;
  const at=marker();if(at===null)return;
  const state=budget(at),time=now();
  if(state.tries>=INTERVALS.length||state.leaseUntil>time)return;
  if(state.tries>0&&time-state.lastAt<INTERVALS[state.tries])return;
  // Claim BEFORE network I/O: failures and concurrent tabs count toward cap.
  const claimed={markerAt:at,tries:state.tries+1,lastAt:time,leaseUntil:time+12000,owner:token};
  localBudget=claimed;safeWrite(store,bKey,claimed);
  // Re-read immediately to reduce cross-tab races (merchant rate limit is
  // still authoritative). Never let the browser supply a paid decision.
  if(safeRead(store,bKey)?.owner!==token&&store)return;
  inFlight=true;
  try{
   await request((kind==='credit'?'/v1/orders/':'/v1/subscriptions/orders/')+encodeURIComponent(orderId)+'/refresh',
     {method:'POST',body:'{}'});
   if(stopped||!foreground())return;
   const local=await request((kind==='credit'?'/v1/orders/':'/v1/subscriptions/orders/')+encodeURIComponent(orderId),
     {method:'GET'});
   if(stopped||!foreground()||local?.order?.id!==orderId)return;
   const current=local.order;
   const verified=kind==='credit'
     ?current.status==='paid'&&Boolean(current.creditedAt)
     :current.status==='paid'&&current.checkout?.paymentConfirmed===true;
   if(verified){
    stopped=true;
    await onVerified?.(current);
   }else if(['closed','failed','refunded','manual_review','refund_pending'].includes(current.status)){
    stopped=true;
   }
  }catch(error){
   if([401,403,404,409,429].includes(error?.status))stopped=true;
   // A provider outage is not a payment result. Never retry forever.
  }finally{
   inFlight=false;
   const value=safeRead(store,bKey);
   if(value?.owner===token){
    const released={...value,leaseUntil:0,owner:null};localBudget=released;safeWrite(store,bKey,released);
   }
  }
 }
 return {onPending,stop:()=>{stopped=true;}};
}
