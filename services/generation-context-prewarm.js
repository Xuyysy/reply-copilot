/**
 * Bounded local-only generation input reuse. No AI requests, tokens,
 * server entitlement decisions, delivery receipts, or quota are cached.
 * Invalidation fences in-flight reads from repopulating a stale cache.
 */
export function createGenerationContextPrewarmer({read,now=()=>Date.now(),ttlMs=60_000}={}) {
  if(typeof read!=="function")throw new TypeError("Context prewarm needs reader");
  let revision=0,cached=null,pending=null;
  function get(){
    const started=now();
    if(cached&&started-cached.at>=0&&started-cached.at<ttlMs)return Promise.resolve(cached.value);
    if(pending?.revision===revision)return pending.promise;
    const active=revision;
    const promise=Promise.resolve().then(read).then(value=>{
      if(active===revision)cached={at:now(),value};
      return value;
    }).finally(()=>{if(pending?.promise===promise)pending=null;});
    pending={revision:active,promise};
    return promise;
  }
  function invalidate(){revision++;cached=null;pending=null;}
  return {get,invalidate};
}
