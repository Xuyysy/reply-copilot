// Poll only the authenticated local order API. A browser return is never proof of payment.
const registries=new WeakMap();let serial=0;
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function shouldMonitorPayment(order){const protocol=order?.paymentProtocol??order?.payment_protocol,status=order?.payment_status??order?.status;return ['rsa2','epay','mk99'].includes(protocol)&&['pending','unknown'].includes(status);}
export function pendingPaymentOrder(orders,now=Date.now()){return (Array.isArray(orders)?orders:[]).find(order=>shouldMonitorPayment(order)&&Number.isFinite(order.created_at)&&now-order.created_at<86400000)?.id??null;}
export function paymentReturnOrder(href){try{const id=new URL(href).searchParams.get('payment_order');return validId(id)?id:null;}catch{return null;}}
export function rememberPayment(orderId,env=globalThis){if(validId(orderId))try{env.localStorage?.setItem('reply-copilot:pending-payment',JSON.stringify({orderId,at:Date.now()}));}catch{}}
export function rememberedPayment(env=globalThis){try{const p=JSON.parse(env.localStorage?.getItem('reply-copilot:pending-payment')||'null');return validId(p?.orderId)&&Date.now()-p.at<86400000?p.orderId:null;}catch{return null;}}
export function clearRememberedPayment(orderId,env=globalThis){try{if(rememberedPayment(env)===orderId)env.localStorage?.removeItem('reply-copilot:pending-payment');}catch{}}
export function watchAccountRefresh(refresh,env=globalThis,{intervalMs=0}={}){
 const w=env.window,d=env.document,now=env.now||Date.now;let last=-Infinity,timer=null,disposed=false,suspended=false;
 const clear=()=>{if(timer!==null)env.clearTimeout?.(timer);timer=null;};
 const run=()=>{if(disposed||suspended||d?.visibilityState==='hidden'||now()-last<1000)return;last=now();void refresh();};
 const schedule=()=>{clear();if(!disposed&&!suspended&&intervalMs>0&&d?.visibilityState!=='hidden'){timer=env.setTimeout(()=>{if(!d?.hasFocus||d.hasFocus())run();schedule();},Math.max(intervalMs,15000));timer?.unref?.();}};
 const storage=e=>{if(e.key==='reply-copilot:payment-updated')run();};
 const pause=()=>{suspended=true;clear();};
 const resume=()=>{suspended=false;run();schedule();};
 const visible=()=>{if(d?.visibilityState==='hidden')clear();else resume();};
 w?.addEventListener('focus',run);w?.addEventListener('pageshow',resume);w?.addEventListener('pagehide',pause);w?.addEventListener('storage',storage);d?.addEventListener('visibilitychange',visible);schedule();
 return()=>{disposed=true;clear();w?.removeEventListener('focus',run);w?.removeEventListener('pageshow',resume);w?.removeEventListener('pagehide',pause);w?.removeEventListener('storage',storage);d?.removeEventListener('visibilitychange',visible);};
}
export function watchPayment(options){
 const {orderId,environment:env=globalThis}=options;if(!validId(orderId))return()=>{};
 const root=env.window||env;let registry=registries.get(root);if(!registry){registry=new Map();registries.set(root,registry);}
 let controller=registry.get(orderId);
 if(!controller){controller=createController(options,env,()=>registry.delete(orderId));registry.set(orderId,controller);}
 return controller.subscribe(options);
}
function createController(first,env,remove){
 const {orderId,request,intervalMs=2500,timeoutMs=120000}=first,w=env.window,d=env.document,now=env.now||Date.now;
 const owner=`${env.crypto?.randomUUID?.()||Math.random()}-${++serial}`,key='reply-copilot:payment-lease:'+orderId,subscribers=new Set();
 let deadline=now()+timeoutMs,timer=null,requestTimer=null,abort=null,busy=false,stopped=false,suspended=false,pausedAt=0,lastStarted=-Infinity;
 const schedule=(ms=intervalMs)=>{if(stopped)return;env.clearTimeout(timer);timer=env.setTimeout(()=>void tick(),ms);timer?.unref?.();};
 const emit=(name,value)=>{for(const s of [...subscribers])try{Promise.resolve(s[name]?.(value)).catch(()=>{});}catch{}};
 function release(){try{if(JSON.parse(env.localStorage?.getItem(key)||'null')?.owner===owner)env.localStorage?.removeItem(key);}catch{}}
 function acquire(){try{const old=JSON.parse(env.localStorage?.getItem(key)||'null');if(old&&old.owner!==owner&&old.until>now())return false;env.localStorage?.setItem(key,JSON.stringify({owner,until:now()+12000}));return true;}catch{return true;}}
 function stop(){if(stopped)return;stopped=true;env.clearTimeout(timer);env.clearTimeout(requestTimer);abort?.abort();release();w?.removeEventListener('focus',resume);w?.removeEventListener('pageshow',resume);w?.removeEventListener('pagehide',pause);w?.removeEventListener('storage',changed);d?.removeEventListener('visibilitychange',visible);remove();}
 const finish=(event,result)=>{stop();emit(event,result);};
 async function tick(){
  if(stopped||suspended||busy||d?.visibilityState==='hidden')return;
  if(now()>=deadline){finish('onTimeout');return;}
  if(now()-lastStarted<1000){schedule(1000-(now()-lastStarted));return;}
  if(!acquire()){schedule();return;}
  busy=true;lastStarted=now();abort=new env.AbortController();requestTimer=env.setTimeout(()=>abort.abort(),8000);requestTimer?.unref?.();
  try{
   const result=await request('/v1/orders/'+encodeURIComponent(orderId),{method:'GET',signal:abort.signal});
   if(stopped||suspended||d?.visibilityState==='hidden')return;
   if(result?.order?.id!==orderId)throw new Error('Invalid local order response');
   if(result.order.status==='paid'&&result.order.creditedAt){
    clearRememberedPayment(orderId,env);finish('onPaid',result);
    try{env.localStorage?.setItem('reply-copilot:payment-updated',JSON.stringify({orderId,at:now()}));}catch{}
   }else if(['closed','failed','refunded'].includes(result.order.status)){clearRememberedPayment(orderId,env);finish('onTerminal',result);}
   else emit('onPending',result);
  }catch(error){if(!stopped&&d?.visibilityState!=='hidden'){emit('onError',error);if([401,403,404].includes(error?.status))stop();}}
  finally{env.clearTimeout(requestTimer);busy=false;if(!stopped&&!suspended&&d?.visibilityState!=='hidden')schedule();}
 }
 function pause(){if(!suspended){pausedAt=now();suspended=true;}env.clearTimeout(timer);abort?.abort();release();}
 function resume(){if(stopped||d?.visibilityState==='hidden')return;if(suspended){deadline+=now()-pausedAt;suspended=false;}if(!busy)schedule(0);}
 function visible(){if(d?.visibilityState==='hidden')pause();else resume();}
 function changed(e){if(e.key==='reply-copilot:payment-updated')resume();}
 w?.addEventListener('focus',resume);w?.addEventListener('pageshow',resume);w?.addEventListener('pagehide',pause);w?.addEventListener('storage',changed);d?.addEventListener('visibilitychange',visible);
 schedule(0);
 return {subscribe(s){subscribers.add(s);return()=>{subscribers.delete(s);if(!subscribers.size)stop();};}};
}

// Coalesce focus/visibility updates; a confirmed payment must queue a newer read.
export function createRefreshGate(){
 let inFlight=null;
 function run(task,{fresh=false}={}){
  if(inFlight)return fresh?inFlight.then(()=>run(task),()=>run(task)):inFlight;
  const pending=Promise.resolve().then(task);inFlight=pending;
  void pending.finally(()=>{if(inFlight===pending)inFlight=null;}).catch(()=>{});
  return pending;
 }
 return run;
}

export function cleanPaymentReturn(href){
 const url=new URL(href);
 for(const key of ['pid','type','out_trade_no','trade_no','money','name','notify_url','return_url','trade_status','sign','sign_type','param'])url.searchParams.delete(key);
 return url.href;
}

// UI-only notice identity. No order state or payment tracking is changed on dismissal.
export function createPaymentNotices(){
 let owner=null,value=null;const dismissed=new Map();
 const key=e=>JSON.stringify([e.orderId,e.kind]);
 return {
  setOwner(next){if(owner!==next){owner=next;value=null;}},
  publish(event,expectedOwner=owner){
   if(!owner||expectedOwner!==owner||dismissed.get(owner)?.has(key(event)))return null;
   if(event.kind==='confirming'){
    if([...dismissed.get(owner)||[]].some(k=>{const [id,kind]=JSON.parse(k);return id===event.orderId&&kind!=='confirming';}))return null;
    if(value?.orderId===event.orderId&&value.kind!=='confirming')return value;
   }
   value=event;return event;
  },
  dismiss(event){if(!owner||!event)return;let keys=dismissed.get(owner);if(!keys){keys=new Set();dismissed.set(owner,keys);}keys.add(key(event));if(value&&key(value)===key(event))value=null;},
  current(){return value;},
  isOwner(expected){return owner===expected;}
 };
}
