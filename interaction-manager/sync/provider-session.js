// A bounded connection lease. No credentials, networking or persistence here.
export async function openProviderSession(factory,binding,{signal,timeoutMs=12000,closeTimeoutMs=1000}={}){
 if(typeof factory!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>12000||!Number.isInteger(closeTimeoutMs)||closeTimeoutMs<1||closeTimeoutMs>1000)throw Error('source_unavailable');
 if(signal?.aborted)throw Error('cancelled');
 const controller=new AbortController();let raw,closed=false,closing=null,timer,rejectWait;
 async function dispose(){
  if(!raw||closing)return closing;
  closing=(async()=>{let t;try{await Promise.race([Promise.resolve().then(()=>raw.close?.()),new Promise(r=>t=setTimeout(r,closeTimeoutMs))]);}catch{}finally{clearTimeout(t);}})();
  return closing;
 }
 async function close(){closed=true;controller.abort();signal?.removeEventListener('abort',abort);return dispose();}
 function abort(){rejectWait?.(Error('cancelled'));void close();}
 signal?.addEventListener('abort',abort,{once:true});
 try{
  const waiting=new Promise((_,reject)=>{rejectWait=reject;timer=setTimeout(()=>{reject(Error('time_limit'));void close();},timeoutMs);});
  const connecting=Promise.resolve().then(()=>{if(closed||signal?.aborted)throw Error('cancelled');return factory(binding,{signal:controller.signal});}).then(value=>{raw=value;if(closed)void dispose();return value;});
  await Promise.race([connecting,waiting]);
  if(closed||signal?.aborted)throw Error('cancelled');
  const sources=raw?.sources===undefined?['notification']:raw.sources;
  if(!raw||typeof raw.id!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(raw.id)||typeof raw.identify!=='function'||typeof raw.readPage!=='function'||!Array.isArray(sources)||sources.length<1||sources.length>2||new Set(sources).size!==sources.length||sources.some(s=>!['notification','post'].includes(s)))throw Error('source_unavailable');
  const invoke=async(name,args)=>{if(closed||controller.signal.aborted)throw Error('cancelled');return raw[name](args);};
  return Object.freeze({id:raw.id,sources:Object.freeze([...sources]),identify:args=>invoke('identify',args),readPage:args=>invoke('readPage',args),close});
 }catch(e){await close();throw e;}finally{clearTimeout(timer);}
}
