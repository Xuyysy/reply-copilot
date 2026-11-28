// Staging-only trusted Background -> bound X content-script transport.
// Messages never contain cookies, CSRF values, request headers or raw responses.
const TYPE='XRH_STAGING_INTERACTION_INTERFACE';
const errors=new Set(['open_notifications','owner_unverified','endpoint_not_observed','identity_changed','owner_mismatch','session_limit','unauthenticated','forbidden','rate_limited','schema_changed','page_limit','invalid_cursor','invalid_pagination','ambiguous_cursor','terminal_unverified','time_limit','cancelled','source_error']);
export function createXInteractionProviderFactory(chromeApi){
 return async function connect(binding,{signal}={}){
  if(!Number.isInteger(binding?.sourceTabId)||binding.sourceTabId<0||!/^[1-9]\d{0,19}$/.test(binding.ownerUserId)||!/^[a-z0-9_]{1,15}$/i.test(binding.handle))throw Error('invalid_context');
  const connectionId=crypto.randomUUID();let sessionId=null,closed=false;
  async function cancel(){closed=true;signal?.removeEventListener('abort',abort);try{await chromeApi.tabs.sendMessage(binding.sourceTabId,{type:TYPE,action:'cancel',connectionId,sessionId});}catch{}}
  function abort(){void cancel();}
  async function call(action,extra={}){
   if(closed||signal?.aborted)throw Error('cancelled');
   let r;try{r=await chromeApi.tabs.sendMessage(binding.sourceTabId,{type:TYPE,action,connectionId,sessionId,...extra});}catch{throw Error('source_unavailable');}
   if(closed||signal?.aborted)throw Error('cancelled');
   if(!r?.ok){
     const failure=Error(errors.has(r?.error)?r.error:'source_unavailable'),d=r?.sourceDiagnostic;
     if(d&&['rest','graphql','search'].includes(d.routeKind)&&['prepare','request','response','body','decode','project','validate'].includes(d.readPhase))
       failure.sourceDiagnostic={routeKind:d.routeKind,readPhase:d.readPhase,httpStatus:Number.isInteger(d.httpStatus)&&d.httpStatus>=100&&d.httpStatus<=599?d.httpStatus:null};
     throw failure;
   }
   return r.value;
  }
  function identity(i){if(i?.ownerUserId!==binding.ownerUserId||i.handle?.toLowerCase()!==binding.handle.toLowerCase()||typeof i.sessionId!=='string'||!i.sessionId||i.sessionId.length>128||sessionId&&sessionId!==i.sessionId)throw Error('identity_changed');return i;}
  if(signal?.aborted)throw Error('cancelled');signal?.addEventListener('abort',abort,{once:true});
  try{
   const started=identity(await call('start',{authorized:true,background:true}));sessionId=started.sessionId;
   if(!Array.isArray(started.sources)||started.sources.length!==2||!['notification','post'].every(s=>started.sources.includes(s)))throw Error('source_unavailable');
   if(typeof started.providerId!=='string'||!/^x-web-[a-f0-9]{32}$/.test(started.providerId))throw Error('source_unavailable');
   const sourceIds=started.sourceIds;
   if(sourceIds!==undefined&&(!sourceIds||Object.keys(sourceIds).length!==2||!['notification','post'].every(s=>typeof sourceIds[s]==='string'&&/^x-web-[a-f0-9]{32}$/.test(sourceIds[s])&&sourceIds[s]!==started.providerId)||sourceIds.notification===sourceIds.post))throw Error('source_unavailable');
   return {id:started.providerId,...(sourceIds?{sourceIds:Object.freeze({...sourceIds})}:{}),sources:['notification','post'],identify:async()=>identity(await call('identity')),readPage:async({ownerUserId,source,cursor})=>{
    if(ownerUserId!==binding.ownerUserId||!['notification','post'].includes(source)||!(cursor===null||typeof cursor==='string'&&cursor.length>0&&cursor.length<=2048))throw Error('invalid_context');
    return call('page',{ownerUserId,source,cursor});
   },close:cancel};
  }catch(e){await cancel();throw e;}
 };
}
