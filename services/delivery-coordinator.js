import {withLocalRecordWrite} from "./local-record-write.js";
// Delivery coordination. No token, raw request or result is logged. Pending
// inputs live in trusted extension local storage, so worker suspension does
// not erase the exact payload required by the server's idempotency contract.
const PENDING='pendingAiDelivery';
const COMPLETED='completedAiDeliveries';
const UNCERTAIN=new Set(['NETWORK_ERROR','DELIVERY_CONFIRMATION_PENDING','GENERATION_IN_PROGRESS','GENERATION_STATUS_UNKNOWN','GENERATION_RECOVERY_REQUIRED']);
const RELEASED=new Set(['GENERATION_FAILED','IDEMPOTENCY_RESULT_EXPIRED','GENERATION_ABANDONED','DELIVERY_NOT_AVAILABLE']);
// A client parser rejection is conclusive for this extension, but does NOT
// mean the server's delivery reservation was released or debited. Never ACK it.
const LOCAL_UNREADABLE='CLIENT_RESPONSE_INCOMPATIBLE';
const CAN_ADVANCE=new Set([...RELEASED,LOCAL_UNREADABLE]);
const fail=(code,message)=>Object.assign(new Error(message),{code});
const sameSource=(a,b)=>a.requestId===b.requestId&&a.sourceText===b.sourceText&&a.sourceUrl===b.sourceUrl;
function envelope(input){
  return JSON.parse(JSON.stringify(Object.fromEntries(['requestId','sourceText','sourceUrl','voiceProfile','recentHistory','styleStats','replyStyle'].map(key=>[key,input[key]]))));
}
export class DeliveryCoordinator {
  constructor({storage,createClient,getAccountId,clock=Date.now,waitTimeoutMs=35000,completion=null}){
    this.storage=storage;this.createClient=createClient;this.getAccountId=getAccountId;this.clock=clock;this.tail=Promise.resolve();this.lastQuota=null;this.lastSubscription=null;this.waitTimeoutMs=waitTimeoutMs;this.fenced=new Set();this.memory=[];this.storageTail=Promise.resolve();this.recovery=null;this.pendingMemory=null;this.completion=completion;this.mostRecentRequestId=null;
  }
  generateReplies(input){
    // Snapshot before awaiting: mutable settings/history must not change a replay.
    const frozen=envelope(input),signal=input.signal;
    const deadline={expired:false};
    // Different posts must not wait behind an old request's 35-second UI
    // deadline. The server's authenticated recovery/abandon contract remains
    // authoritative for quotas, idempotency and any uncertain provider work.
    const recoveryCapable=typeof this.createClient().recoverGeneration==='function';
    const sameRequest=this.mostRecentRequestId===frozen.requestId;
    const previous=sameRequest||!recoveryCapable?this.tail.catch(()=>{}):Promise.resolve();
    this.mostRecentRequestId=frozen.requestId;
    const run=previous.then(()=>{if(deadline.expired)throw fail('REQUEST_CANCELLED','等待已结束，请重新操作。');return this.run(frozen,signal,input.performanceTrace,()=>!deadline.expired);});
    let timer;
    const bounded=Promise.race([run,new Promise((_,reject)=>{timer=setTimeout(()=>{deadline.expired=true;reject(fail('GENERATION_RECOVERY_REQUIRED','上一条生成未完成。可以恢复上一条，或放弃并重新生成。'));},this.waitTimeoutMs);})]).finally(()=>clearTimeout(timer));
    this.tail=bounded.catch(()=>{});return bounded;
  }
  async run(input,signal,performanceTrace,canStart=()=>true){
    if(signal?.aborted)throw fail('REQUEST_CANCELLED','本次回复操作已结束。');
    const [ownerId,stored]=await Promise.all([
      performanceTrace ? performanceTrace.measure("owner_check",()=>this.getAccountId()) : this.getAccountId(),
      performanceTrace ? performanceTrace.measure("delivery_storage",()=>this.storage.get([PENDING,COMPLETED])) : this.storage.get([PENDING,COMPLETED]),
    ]);
    if(typeof ownerId!=='string'||!ownerId)throw fail('AUTH_REQUIRED','请重新连接账户。');
    let pending=stored[PENDING]||this.pendingMemory;
    let completed=[...(stored[COMPLETED]||[]),...this.memory].filter(row=>row.ownerId===ownerId&&this.clock()-row.completedAt<600000);
    const same=completed.find(row=>row.input.requestId===input.requestId);
    if(same){
      if(!sameSource(same.input,input))throw fail('IDEMPOTENCY_CONFLICT','同一生成请求不能用于不同内容。');
      if(this.completion&&!same.localRecordsCommitted)await this.remember(same,completed);
      this.lastQuota=same.quota;this.lastSubscription=null;return same.raw;
    }
    if(pending?.ownerId!==ownerId||this.fenced.has(ownerId+':'+pending?.input?.requestId))pending=null;
    if(pending){
      if(pending.input.requestId===input.requestId&&!sameSource(pending.input,input))throw fail('IDEMPOTENCY_CONFLICT','同一生成请求不能用于不同内容。');
      try{
        // On a different post, do NOT regenerate a missing old request and do
        // NOT wait for its client-side generation promise. Ask the server to
        // safely retire a running old request with the existing fenced, rate-
        // limited endpoint. A ready valid result still requires normal ACK.
        const different=pending.input.requestId!==input.requestId;
        const client=different?this.createClient():null;
        const recovered=different&&typeof client?.recoverGeneration==='function'
          ?await this.finishSuperseded(pending,completed,client,performanceTrace)
          :await this.deliver(pending,completed,performanceTrace,canStart);
        completed=recovered.completed;
        if(!different)return recovered.raw;
      }catch(error){
        // A fully resolved or unusable old request must never poison the next.
        // Network and unconfirmed settlement remain fenced to prevent double debit.
        if(!CAN_ADVANCE.has(error?.code))throw error;
        if(pending.input.requestId===input.requestId)throw error;
      }
    }
    if(signal?.aborted)throw fail('REQUEST_CANCELLED','本次回复操作已结束。');
    // Fast path: let the atomic generate reservation detect a server orphan.
    // No active/history scan is needed for a fresh request with no local pending.
    if(!canStart())throw fail('REQUEST_CANCELLED','等待已结束，请重新操作。');
    const record={ownerId,input,createdAt:this.clock()};
    this.pendingMemory=record;
    // If local storage is unavailable, the server active-request lookup remains
    // authoritative after restart. Do not discard an otherwise usable draft.
    await this.writeLocked(()=>this.storage.set({[PENDING]:record})).catch(()=>{});
    return (await this.deliver(record,completed,performanceTrace,canStart,false)).raw;
  }

  async finishSuperseded(record,completed,client,performanceTrace){
    let state;
    try{
      // This is an explicit new-post user action, not a background retry.
      // Server verifies ownership and protects active provider work via its
      // existing idempotent/rate-limited abandonment transaction.
      state=await client.recoverGeneration(record.input.requestId,true);
    }catch(error){
      // The server may have completed or rejected abandonment; never assume
      // credits were released when the outcome is uncertain.
      throw error;
    }
    if(['released','missing','expired'].includes(state?.state)){
      await this.clearResolved(record);
      return {completed};
    }
    if(state?.state==='delivered'&&!state.raw){
      await this.clearResolved(record);
      return {completed};
    }
    if(!['ready','delivered'].includes(state?.state)||!state.raw)
      throw fail('GENERATION_RECOVERY_REQUIRED','上一条仍未安全结束，请恢复上一条后继续。');
    let raw;
    try{raw=await client.receiveDelivery(state);}
    catch(error){
      if(error?.name==='InvalidAIResponseError'){
        await this.clearResolved(record);
        return {completed};
      }
      throw error;
    }
    this.lastQuota=client.lastQuota||null;this.lastSubscription=client.lastSubscription??null;
    const retained=[...completed.filter(row=>row.input.requestId!==record.input.requestId),
      {...record,raw,quota:this.lastQuota,completedAt:this.clock()}].slice(-4);
    await (performanceTrace?performanceTrace.measure('delivery_persist',()=>this.remember(record,retained)):this.remember(record,retained));
    return {completed:retained};
  }
  async deliver(record,completed,performanceTrace,canStart=()=>true,recover=true){
    const client=this.createClient();
    try{
      // Once accepted, UI cancellation detaches the composer only. Let the
      // bounded hosted request finish its original delivery handshake.
      let raw;
      if(recover&&client.recoverGeneration){
        const state=await client.recoverGeneration(record.input.requestId);
        if(['ready','delivered'].includes(state.state))raw=await client.receiveDelivery(state);
        else if(['released','expired'].includes(state.state))throw fail('GENERATION_FAILED','上一次生成已结束，可以重新生成。');
        else if(state.state==='running')throw fail('GENERATION_RECOVERY_REQUIRED','上一条生成未完成。可以恢复上一条，或放弃并重新生成。');
      }
      if(raw===undefined&&!canStart())throw fail('REQUEST_CANCELLED','等待已结束，请重新操作。');
      if(raw===undefined)raw=await client.generateReplies({...record.input,...(performanceTrace ? {performanceTrace} : {})});
      if(this.fenced.has(record.ownerId+':'+record.input.requestId))throw fail('GENERATION_ABANDONED','本次生成已结束。');
      this.lastQuota=client.lastQuota||null;this.lastSubscription=client.lastSubscription??null;
      const retained=[...completed.filter(row=>row.input.requestId!==record.input.requestId),{...record,raw,quota:this.lastQuota,completedAt:this.clock()}].slice(-4);
      await (performanceTrace?performanceTrace.measure("delivery_persist",()=>this.remember(record,retained)):this.remember(record,retained));
      return {raw,completed:retained};
    }catch(error){
      // A strict old-client parser can reject a server-valid language tag.
      // This old raw result is never deliverable by this extension, so retire
      // its LOCAL recovery envelope instead of poisoning every newer post.
      // Leave the server-side quota reservation to its existing expiry/ACK
      // protocol; never acknowledge, debit, or auto-regenerate this result.
      const resolved=error?.name==='InvalidAIResponseError'
        ? fail(LOCAL_UNREADABLE,'本次 AI 回复无法被当前插件识别。已解除本地阻塞，请更新插件后使用新帖子重试。')
        : error;
      if(CAN_ADVANCE.has(resolved?.code))await this.clearResolved(record);
      // Unknown network/ACK errors retain the original pending request.
      else if(resolved?.code&&!UNCERTAIN.has(resolved.code)&&!['NETWORK_ERROR','DELIVERY_CONFIRMATION_PENDING'].includes(resolved.code))await this.clearResolved(record);
      throw resolved;
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
    try{
      await this.writeLocked(()=>withLocalRecordWrite(this.storage,async()=>{
        const data=await this.storage.get([PENDING,COMPLETED,...(typeof this.completion?.keys==='function'?this.completion.keys(record):(this.completion?.keys||[]))]);
        const rows=[...(data[COMPLETED]||[]),...retained];
        const unique=[...new Map(rows.map(r=>[r.ownerId+':'+r.input.requestId,r])).values()].slice(-4);
        const receipt=unique.find(r=>r.ownerId===record.ownerId&&r.input.requestId===record.input.requestId);
        const extra=this.completion?this.completion.patch(data,receipt):{};
        if(this.completion)receipt.localRecordsCommitted=true;
        const match=data[PENDING]?.ownerId===record.ownerId&&data[PENDING]?.input.requestId===record.input.requestId;
        await this.storage.set({...(match?{[PENDING]:null}:{}),[COMPLETED]:unique,...extra});
        this.memory=unique;
      }));
    }catch{
      // Storage failure keeps the previous awaited best-effort path, never a
      // fire-and-forget task. A later replay can retry the merged durable commit.
      for(const row of this.memory)if(row.input.requestId===record.input.requestId)row.localRecordsCommitted=false;
      await this.completion?.fallback?.(record,retained.find(r=>r.input.requestId===record.input.requestId)?.raw,retained.find(r=>r.input.requestId===record.input.requestId)).catch(()=>{});
    }
  }
  recoverPending({abandon=false}={}){
    if(this.recovery)return this.recovery;
    this.recovery=this.doRecover(abandon).finally(()=>{this.recovery=null;});return this.recovery;
  }
  async doRecover(abandon){
    const ownerId=await this.getAccountId();if(!ownerId)throw fail('AUTH_REQUIRED','请重新连接账户。');
    const data=await this.storage.get([PENDING,COMPLETED]);const saved=data[PENDING]||this.pendingMemory;const record=saved?.ownerId===ownerId?saved:null;
    const client=this.createClient();let state=await client.recoverGeneration(record?.input.requestId);
    // A fresh POST can conflict with another server request after local state
    // was lost. Resolve the actual blocker only on this explicit recovery path.
    if(record&&['missing','released'].includes(state.state)){
      const active=await client.recoverGeneration();
      if(active.requestId&&active.requestId!==record.input.requestId)state=active;
    }
    if(abandon&&record&&state.requestId!==record.input.requestId){
      // Fence the possibly delayed new envelope as well as the foreign blocker.
      // Both operations are server-confirmed/idempotent and remain rate-limited.
      const primary=await client.recoverGeneration(record.input.requestId,true);
      if(!['released','delivered'].includes(primary.state))state=primary;
    }
    if(abandon&&((state.state==='missing'&&record)||['running','expired'].includes(state.state)))state=await client.recoverGeneration(state.requestId||record.input.requestId,true);
    if(['ready','delivered'].includes(state.state)&&state.raw){
      const raw=await client.receiveDelivery(state);this.lastQuota=client.lastQuota||null;this.lastSubscription=client.lastSubscription??null;
      if(record&&record.input.requestId===state.requestId)await this.remember(record,[...(data[COMPLETED]||[]),{...record,raw,quota:this.lastQuota,completedAt:this.clock()}].slice(-4));
      if(!record||record.input.requestId!==state.requestId)await this.completion?.recovered?.({ownerId,input:{requestId:state.requestId},raw,completedAt:this.clock()}).catch(()=>{});
      if(record&&record.input.requestId!==state.requestId&&abandon)await this.clearResolved(record);
      this.tail=Promise.resolve();return {state:'ready',requestId:state.requestId,raw};
    }
    if(['released','delivered'].includes(state.state)||(state.state==='missing'&&!record)){
      if(record)await this.clearResolved(record);
      this.tail=Promise.resolve();return {...state,state:'released'};
    }
    throw fail('GENERATION_RECOVERY_REQUIRED','上一条仍在生成。可以稍后恢复，或选择放弃并重新生成。');
  }

}
