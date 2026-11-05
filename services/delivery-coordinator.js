// Delivery coordination. No token, raw request or result is logged. Pending
// inputs live in trusted extension session storage, so worker suspension does
// not erase the exact payload required by the server's idempotency contract.
const PENDING='pendingAiDelivery';
const COMPLETED='completedAiDeliveries';
const UNCERTAIN=new Set(['NETWORK_ERROR','DELIVERY_CONFIRMATION_PENDING','GENERATION_IN_PROGRESS','GENERATION_STATUS_UNKNOWN','GENERATION_RECOVERY_REQUIRED']);
const RELEASED=new Set(['GENERATION_FAILED','IDEMPOTENCY_RESULT_EXPIRED','GENERATION_ABANDONED','DELIVERY_NOT_AVAILABLE']);
const fail=(code,message)=>Object.assign(new Error(message),{code});
const sameSource=(a,b)=>a.requestId===b.requestId&&a.sourceText===b.sourceText&&a.sourceUrl===b.sourceUrl;
function envelope(input){
  return JSON.parse(JSON.stringify(Object.fromEntries(['requestId','sourceText','sourceUrl','voiceProfile','recentHistory','styleStats','replyStyle'].map(key=>[key,input[key]]))));
}
export class DeliveryCoordinator {
  constructor({storage,createClient,getAccountId,clock=Date.now,waitTimeoutMs=35000}){
    this.storage=storage;this.createClient=createClient;this.getAccountId=getAccountId;this.clock=clock;this.tail=Promise.resolve();this.lastQuota=null;this.waitTimeoutMs=waitTimeoutMs;this.fenced=new Set();this.memory=[];this.storageTail=Promise.resolve();this.recovery=null;this.pendingMemory=null;
  }
  generateReplies(input){
    // Snapshot before awaiting: mutable settings/history must not change a replay.
    const frozen=envelope(input),signal=input.signal;
    const deadline={expired:false};
    const run=this.tail.catch(()=>{}).then(()=>{if(deadline.expired)throw fail('REQUEST_CANCELLED','等待已结束，请重新操作。');return this.run(frozen,signal,input.performanceTrace,()=>!deadline.expired);});
    let timer;
    const bounded=Promise.race([run,new Promise((_,reject)=>{timer=setTimeout(()=>{deadline.expired=true;reject(fail('GENERATION_RECOVERY_REQUIRED','上一条生成未完成。可以恢复上一条，或放弃并重新生成。'));},this.waitTimeoutMs);})]).finally(()=>clearTimeout(timer));
    this.tail=bounded.catch(()=>{});return bounded;
  }
  async run(input,signal,performanceTrace,canStart=()=>true){
    if(signal?.aborted)throw fail('REQUEST_CANCELLED','本次回复操作已结束。');
    const ownerId=await (performanceTrace ? performanceTrace.measure("owner_check",()=>this.getAccountId()) : this.getAccountId());
    if(typeof ownerId!=='string'||!ownerId)throw fail('AUTH_REQUIRED','请重新连接账户。');
    const stored=await (performanceTrace ? performanceTrace.measure("delivery_storage",()=>this.storage.get([PENDING,COMPLETED])) : this.storage.get([PENDING,COMPLETED]));
    let pending=stored[PENDING]||this.pendingMemory;
    let completed=[...(stored[COMPLETED]||[]),...this.memory].filter(row=>row.ownerId===ownerId&&this.clock()-row.completedAt<600000);
    const same=completed.find(row=>row.input.requestId===input.requestId);
    if(same){
      if(!sameSource(same.input,input))throw fail('IDEMPOTENCY_CONFLICT','同一生成请求不能用于不同内容。');
      this.lastQuota=same.quota;return same.raw;
    }
    if(pending?.ownerId!==ownerId||this.fenced.has(ownerId+':'+pending?.input?.requestId))pending=null;
    if(pending){
      if(pending.input.requestId===input.requestId&&!sameSource(pending.input,input))throw fail('IDEMPOTENCY_CONFLICT','同一生成请求不能用于不同内容。');
      try{
        const recovered=await this.deliver(pending,completed,performanceTrace,canStart);
        completed=recovered.completed;
        if(pending.input.requestId===input.requestId)return recovered.raw;
      }catch(error){
        // Only a conclusive server result permits advancing past an old request.
        if(!RELEASED.has(error?.code))throw error;
        if(pending.input.requestId===input.requestId)throw error;
      }
    }
    if(signal?.aborted)throw fail('REQUEST_CANCELLED','本次回复操作已结束。');
    // Recover orphaned state even after browser/session storage loss. This GET
    // never creates an upstream generation or assumes that a 30s timeout ended it.
    const probe=this.createClient();
    if(probe.recoverGeneration){
      const active=await probe.recoverGeneration();
      if(active.requestId&&['running','expired','ready'].includes(active.state))throw fail('GENERATION_RECOVERY_REQUIRED','上一条生成未完成。请恢复上一条，或放弃并重新生成。');
    }
    if(!canStart())throw fail('REQUEST_CANCELLED','等待已结束，请重新操作。');
    const record={ownerId,input,createdAt:this.clock()};
    this.pendingMemory=record;
    // If local storage is unavailable, the server active-request lookup remains
    // authoritative after restart. Do not discard an otherwise usable draft.
    await this.writeLocked(()=>this.storage.set({[PENDING]:record})).catch(()=>{});
    return (await this.deliver(record,completed,performanceTrace,canStart)).raw;
  }
  async deliver(record,completed,performanceTrace,canStart=()=>true){
    const client=this.createClient();
    try{
      // Once accepted, UI cancellation detaches the composer only. Let the
      // bounded hosted request finish its original delivery handshake.
      let raw;
      if(client.recoverGeneration){
        const state=await client.recoverGeneration(record.input.requestId);
        if(['ready','delivered'].includes(state.state))raw=await client.receiveDelivery(state);
        else if(['released','expired'].includes(state.state))throw fail('GENERATION_FAILED','上一次生成已结束，可以重新生成。');
        else if(state.state==='running')throw fail('GENERATION_RECOVERY_REQUIRED','上一条生成未完成。可以恢复上一条，或放弃并重新生成。');
      }
      if(raw===undefined&&!canStart())throw fail('REQUEST_CANCELLED','等待已结束，请重新操作。');
      if(raw===undefined)raw=await client.generateReplies({...record.input,...(performanceTrace ? {performanceTrace} : {})});
      if(this.fenced.has(record.ownerId+':'+record.input.requestId))throw fail('GENERATION_ABANDONED','本次生成已结束。');
      this.lastQuota=client.lastQuota||null;
      const retained=[...completed.filter(row=>row.input.requestId!==record.input.requestId),{...record,raw,quota:this.lastQuota,completedAt:this.clock()}].slice(-4);
      await this.remember(record,retained);
      return {raw,completed:retained};
    }catch(error){
      if(RELEASED.has(error?.code))await this.clearResolved(record);
      // Unknown transport/parser/storage errors retain the recovery envelope.
      else if(error?.code&&!UNCERTAIN.has(error.code)&&!['NETWORK_ERROR','DELIVERY_CONFIRMATION_PENDING'].includes(error.code))await this.clearResolved(record);
      throw error;
    }
  }
  writeLocked(action){const run=this.storageTail.catch(()=>{}).then(action);this.storageTail=run.catch(()=>{});return run;}
  async clearResolved(record){
    this.fenced.add(record.ownerId+':'+record.input.requestId);
    if(this.pendingMemory?.input.requestId===record.input.requestId)this.pendingMemory=null;
    await this.writeLocked(async()=>{const data=await this.storage.get(PENDING);if(data[PENDING]?.ownerId===record.ownerId&&data[PENDING]?.input.requestId===record.input.requestId)await this.storage.set({[PENDING]:null});}).catch(()=>{});
  }
  async remember(record,retained){
    this.memory=retained;
    if(this.pendingMemory?.input.requestId===record.input.requestId)this.pendingMemory=null;
    await this.writeLocked(async()=>{const data=await this.storage.get([PENDING,COMPLETED]);const rows=[...(data[COMPLETED]||[]),...retained];const unique=[...new Map(rows.map(r=>[r.ownerId+':'+r.input.requestId,r])).values()].slice(-4);const match=data[PENDING]?.ownerId===record.ownerId&&data[PENDING]?.input.requestId===record.input.requestId;await this.storage.set({...(match?{[PENDING]:null}:{}),[COMPLETED]:unique});}).catch(()=>{});
  }
  recoverPending({abandon=false}={}){
    if(this.recovery)return this.recovery;
    this.recovery=this.doRecover(abandon).finally(()=>{this.recovery=null;});return this.recovery;
  }
  async doRecover(abandon){
    const ownerId=await this.getAccountId();if(!ownerId)throw fail('AUTH_REQUIRED','请重新连接账户。');
    const data=await this.storage.get([PENDING,COMPLETED]);const saved=data[PENDING]||this.pendingMemory;const record=saved?.ownerId===ownerId?saved:null;
    const client=this.createClient();let state=await client.recoverGeneration(record?.input.requestId);
    if(abandon&&state.state==='missing'&&record)state=await client.recoverGeneration(record.input.requestId,true);
    else if(abandon&&['running','expired'].includes(state.state))state=await client.recoverGeneration(state.requestId,true);
    if(['ready','delivered'].includes(state.state)&&state.raw){
      const raw=await client.receiveDelivery(state);this.lastQuota=client.lastQuota||null;
      if(record)await this.remember(record,[...(data[COMPLETED]||[]),{...record,raw,quota:this.lastQuota,completedAt:this.clock()}].slice(-4));
      this.tail=Promise.resolve();return {state:'ready',requestId:state.requestId,raw};
    }
    if(['released','delivered'].includes(state.state)||(state.state==='missing'&&!record)){
      if(record)await this.clearResolved(record);
      this.tail=Promise.resolve();return {...state,state:'released'};
    }
    throw fail('GENERATION_RECOVERY_REQUIRED','上一条仍在生成。可以稍后恢复，或选择放弃并重新生成。');
  }

}
