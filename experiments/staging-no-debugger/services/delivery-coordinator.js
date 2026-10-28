// Staging-only coordination. No token, raw request or result is logged. Pending
// inputs live in trusted extension session storage, so worker suspension does
// not erase the exact payload required by the server's idempotency contract.
const PENDING='stagingPendingAiDelivery';
const COMPLETED='stagingCompletedAiDeliveries';
const UNCERTAIN=new Set(['NETWORK_ERROR','DELIVERY_CONFIRMATION_PENDING','GENERATION_IN_PROGRESS','GENERATION_STATUS_UNKNOWN']);
const RELEASED=new Set(['GENERATION_FAILED','IDEMPOTENCY_RESULT_EXPIRED']);
const fail=(code,message)=>Object.assign(new Error(message),{code});
const sameSource=(a,b)=>a.requestId===b.requestId&&a.sourceText===b.sourceText&&a.sourceUrl===b.sourceUrl;
function envelope(input){
  return JSON.parse(JSON.stringify(Object.fromEntries(['requestId','sourceText','sourceUrl','voiceProfile','recentHistory','styleStats','replyStyle'].map(key=>[key,input[key]]))));
}
export class StagingDeliveryCoordinator {
  constructor({storage,createClient,getAccountId,clock=Date.now}){
    this.storage=storage;this.createClient=createClient;this.getAccountId=getAccountId;this.clock=clock;this.tail=Promise.resolve();this.lastQuota=null;
  }
  generateReplies(input){
    // Snapshot before awaiting: mutable settings/history must not change a replay.
    const frozen=envelope(input),signal=input.signal;
    const run=this.tail.catch(()=>{}).then(()=>this.run(frozen,signal));
    this.tail=run.catch(()=>{});return run;
  }
  async run(input,signal){
    if(signal?.aborted)throw fail('REQUEST_CANCELLED','本次回复操作已结束。');
    const ownerId=await this.getAccountId();
    if(typeof ownerId!=='string'||!ownerId)throw fail('AUTH_REQUIRED','请重新连接账户。');
    const stored=await this.storage.get([PENDING,COMPLETED]);
    let pending=stored[PENDING];
    let completed=(stored[COMPLETED]||[]).filter(row=>row.ownerId===ownerId&&this.clock()-row.completedAt<600000);
    const same=completed.find(row=>row.input.requestId===input.requestId);
    if(same){
      if(!sameSource(same.input,input))throw fail('IDEMPOTENCY_CONFLICT','同一生成请求不能用于不同内容。');
      this.lastQuota=same.quota;return same.raw;
    }
    if(pending?.ownerId!==ownerId)pending=null;
    if(pending){
      if(pending.input.requestId===input.requestId&&!sameSource(pending.input,input))throw fail('IDEMPOTENCY_CONFLICT','同一生成请求不能用于不同内容。');
      try{
        const recovered=await this.deliver(pending,completed);
        completed=recovered.completed;
        if(pending.input.requestId===input.requestId)return recovered.raw;
      }catch(error){
        // Only a conclusive server result permits advancing past an old request.
        if(!RELEASED.has(error?.code))throw error;
        if(pending.input.requestId===input.requestId)throw error;
      }
    }
    if(signal?.aborted)throw fail('REQUEST_CANCELLED','本次回复操作已结束。');
    const record={ownerId,input,createdAt:this.clock()};
    await this.storage.set({[PENDING]:record});
    return (await this.deliver(record,completed)).raw;
  }
  async deliver(record,completed){
    const client=this.createClient();
    try{
      // Once accepted, UI cancellation detaches the composer only. Let the
      // bounded hosted request finish its original delivery handshake.
      const raw=await client.generateReplies(record.input);
      this.lastQuota=client.lastQuota||null;
      const retained=[...completed.filter(row=>row.input.requestId!==record.input.requestId),{...record,raw,quota:this.lastQuota,completedAt:this.clock()}].slice(-4);
      await this.storage.set({[PENDING]:null,[COMPLETED]:retained});
      return {raw,completed:retained};
    }catch(error){
      if(error?.code&&!UNCERTAIN.has(error.code))await this.storage.set({[PENDING]:null});
      throw error;
    }
  }
}
