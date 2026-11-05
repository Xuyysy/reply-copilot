const loads=new WeakMap();
const SCRIPT='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export function loadTurnstile(win,doc,{retry=false,timeoutMs=15000}={}){
 if(typeof win.turnstile?.render==='function')return Promise.resolve(win.turnstile);
 if(loads.has(win))return loads.get(win);
 const promise=new Promise((resolve,reject)=>{
  let script=doc.querySelector('script[data-xrh-turnstile]');
  if(retry&&script?.dataset.xrhState==='failed'){script.remove();script=null;}
  if(!script){script=doc.createElement('script');script.src=SCRIPT;script.async=true;script.defer=true;script.dataset.xrhTurnstile='';}
  let timer;const finish=(code)=>{clearTimeout(timer);script.removeEventListener('load',loaded);script.removeEventListener('error',failed);if(code){script.dataset.xrhState='failed';reject(Object.assign(Error(code),{code}));}else resolve(win.turnstile);};
  const loaded=()=>finish(typeof win.turnstile?.render==='function'?null:'script_api_missing'),failed=()=>finish('script_load_failed');
  script.addEventListener('load',loaded,{once:true});script.addEventListener('error',failed,{once:true});timer=setTimeout(()=>finish('script_timeout'),timeoutMs);
  if(!script.isConnected)doc.head.append(script);
 });loads.set(win,promise);void promise.finally(()=>{if(loads.get(win)===promise)loads.delete(win);}).catch(()=>{});return promise;
}
export function createTurnstileController({node,sitekey,onState,win=window,load=retry=>loadTurnstile(win,node.ownerDocument,{retry}),challengeMs=120000,tokenMs=290000,now=()=>performance.now()}){
 let epoch=0,id=null,api=null,token='',timer=null,observer=null,seenFrame=false,disposed=false;
 const clear=()=>{clearTimeout(timer);observer?.disconnect();observer=null;token='';if(id!==null){try{api?.remove(id);}catch{}id=null;}node.replaceChildren?.();};
 let started=now();
 const emit=(phase,code=null)=>onState({phase,code,elapsedMs:Math.round(Math.max(0,now()-started))});
 const invalidate=(code='verification_expired')=>{epoch++;clear();if(!disposed)emit('failed',code);};
 async function start(retry=false){if(disposed)return;const run=++epoch;clear();started=now();emit('loading');
  try{api=await load(retry);if(disposed||run!==epoch||!node.isConnected)return;
   const current=()=>!disposed&&run===epoch&&node.isConnected;
   const fail=code=>{if(current())invalidate(code);};emit('verifying');
   const rendered=api.render(node,{sitekey,action:'register',appearance:'always',size:'flexible',retry:'never','refresh-expired':'manual','refresh-timeout':'manual','response-field':false,
    callback:value=>{if(!current()||token)return;if(typeof value!=='string'||!value.trim()||value.length>2048){fail('invalid_callback');return;}token=value;clearTimeout(timer);timer=setTimeout(()=>fail('verification_expired'),tokenMs);emit('verified');},
    'error-callback':code=>{fail(typeof code==='string'&&/^\d{3,6}$/.test(code)?code:'challenge_failed');return true;},
    'expired-callback':()=>fail('verification_expired'),'timeout-callback':()=>fail('challenge_timeout'),
   });
   // A synchronous callback may have invalidated this attempt inside render.
   if(!current()){try{api.remove(rendered);}catch{}return;}id=rendered;
   if(!token)timer=setTimeout(()=>fail('challenge_timeout'),challengeMs);
   if(win.MutationObserver){observer=new win.MutationObserver(()=>{if(!current())return;const present=!!node.querySelector('iframe');if(seenFrame&&!present)fail('widget_removed');seenFrame||=present;});seenFrame=!!node.querySelector('iframe');observer.observe(node,{childList:true,subtree:true});}
  }catch(e){if(!disposed&&run===epoch)invalidate(['script_timeout','script_load_failed','script_api_missing'].includes(e?.code)?e.code:'render_failed');}
 }
 return{start:()=>start(false),retry:()=>start(true),consume(){const value=token;if(value){epoch++;clear();emit('submitted');}return value;},dispose(){disposed=true;epoch++;clear();}};
}
