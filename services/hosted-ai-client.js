import { RUNTIME_CONFIG } from "../config/runtime.js";
import { AccountClient } from "./account-client.js";
import { parseAIOutput } from "../utils/output-parser.js";

export class HostedAIClient {
  constructor({ config = RUNTIME_CONFIG, accountClient = new AccountClient({ config }) } = {}) { this.config = config; this.accountClient = accountClient; }
  async generateReplies({ sourceText, sourceUrl, voiceProfile, recentHistory, styleStats, replyStyle, generationKind, requestId, signal, performanceTrace }) {
    if (!this.config.hostedApiUrl) throw Object.assign(new Error("云端 AI 服务尚未配置。"), { code: "HOSTED_NOT_CONFIGURED" });
    if (!/^[0-9a-f-]{36}$/i.test(requestId || "")) throw new Error("生成请求标识无效，请重试。");
    const controller = new AbortController();
    const abort = () => controller.abort(); if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, this.config.requestTimeoutMs || 30000);
    try {
      const requestGeneration = () => this.accountClient.request("/v1/ai/generate", { method: "POST", body: { requestId, post: { text: sourceText, url: sourceUrl }, voiceProfile, recentHistory, styleStats, replyStyle, outputSchemaVersion: 2, ...(generationKind === "quote" ? {generationKind:"quote"} : {}) }, signal: controller.signal });
      const data = await (performanceTrace ? performanceTrace.measure("cloud_generate",requestGeneration) : requestGeneration());
      performanceTrace?.addDurations(data?.performance?.durations);
      if (typeof data?.raw !== "string" || !data.raw.trim()) throw new Error("云端 AI 返回内容无效。");
      // Validate the exact payload the UI will consume before permanently
      // charging the allocated lot. The response is not exposed until the
      // Worker confirms the idempotent delivery acknowledgement.
      parseAIOutput(data.raw);
      let confirmation;
      try {
        const acknowledge = () => this.accountClient.request(`/v1/ai/requests/${requestId}/delivered`, { method: "POST", body: { requestId }, signal: controller.signal });
        confirmation = await (performanceTrace ? performanceTrace.measure("ack",acknowledge) : acknowledge());
      } catch {
        // The generated response is safely replayable under this requestId.
        // Never expose it or start a new paid generation until delivery has
        // been confirmed; the caller can retry this same idempotent request.
        throw Object.assign(new Error("回复已生成，但额度确认暂未完成。请重试确认，不会重复生成或扣次。"), { code: "DELIVERY_CONFIRMATION_PENDING" });
      }
      this.lastSubscription = confirmation?.subscription ?? null;
      this.lastQuota = confirmation?.quota || data.quota || null;
      return data.raw;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  async recoverGeneration(requestId, abandon = false) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{return await this.accountClient.request(requestId ? `/v1/ai/requests/${requestId}${abandon?'/abandon':''}`:'/v1/ai/requests/active',{method:abandon?'POST':'GET',...(abandon?{body:{requestId}}:{}),signal:controller.signal});}
    finally{clearTimeout(timer);}
  }
  async receiveDelivery(state){
    if(!state.raw)throw Object.assign(Error('上一条结果已过期，请重新生成。'),{code:'GENERATION_FAILED'});
    parseAIOutput(state.raw);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{const ack=await this.accountClient.request(`/v1/ai/requests/${state.requestId}/delivered`,{method:'POST',body:{requestId:state.requestId},signal:controller.signal});this.lastQuota=ack.quota||null;this.lastSubscription=ack.subscription??null;}
    catch{throw Object.assign(Error('回复已生成，请恢复上一条完成确认。'),{code:'DELIVERY_CONFIRMATION_PENDING'});}
    finally{clearTimeout(timer);}
    return state.raw;
  }
  generateReplyAnalysis(input) { return this.generateReplies(input); }
}
