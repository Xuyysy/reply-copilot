// Real local D1 and private DO binding proxies; no SQL strings, bind values,
// passwords, tokens, response content or user identifiers enter the report.
export function measureEnv(env){
 const tally={d1Calls:0,d1Statements:0,doCalls:0,batchRowsRead:0,batchRowsWritten:0,standaloneRowsRead:0,standaloneRowsWritten:0,standaloneMetadataMissing:0,batchMetadataMissing:0};
 const original=new WeakMap();
 const add=(r,batch)=>{if(!Number.isSafeInteger(r?.meta?.rows_read)||!Number.isSafeInteger(r?.meta?.rows_written)){tally[batch?'batchMetadataMissing':'standaloneMetadataMissing']++;return;}tally[batch?'batchRowsRead':'standaloneRowsRead']+=r.meta.rows_read;tally[batch?'batchRowsWritten':'standaloneRowsWritten']+=r.meta.rows_written;};
 const wrap=stmt=>{
  const proxy=new Proxy(stmt,{get(target,key){
   if(key==='bind')return (...args)=>wrap(target.bind(...args));
   if(['first','all','run','raw'].includes(key))return async(...args)=>{
    tally.d1Calls++;tally.d1Statements++;const r=await target[key](...args);add(r,false);return r;
   };
   const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;
  }});original.set(proxy,stmt);return proxy;
 };
 const db=new Proxy(env.DB,{get(target,key){
  if(key==='prepare')return sql=>wrap(target.prepare(sql));
  if(key==='batch')return async statements=>{
   tally.d1Calls++;tally.d1Statements+=statements.length;const result=await target.batch(statements.map(s=>{if(!original.has(s))throw Error('UNTRACKED_D1_STATEMENT');return original.get(s);}));
   for(const r of result)add(r,true);return result;
  };
  if(key==='exec'||key==='withSession')return ()=>{throw Error('UNTRACKED_D1_METHOD');};
  const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;
 }});
 const ns={getByName(name){const stub=env.PASSWORD_VERIFY_DO.getByName(name);return {async hash(...args){tally.doCalls++;return stub.hash(...args);},async verify(...args){tally.doCalls++;return stub.verify(...args);}};}};
 return {env:{...env,DB:db,PASSWORD_VERIFY_DO:ns},tally};
}
