import { RUNTIME_CONFIG } from "../config/runtime.js";
import { StorageService } from "./storage-service.js";
import { AccountStateService } from "./account-state-service.js";
import { DeepSeekClient } from "./deepseek-client.js";
import { HostedAIClient } from "./hosted-ai-client.js";

export class AIProviderRouter {
  constructor({ config = RUNTIME_CONFIG, accountStates = new AccountStateService({ config }), storage = new StorageService(), byokFactory = (apiKey) => new DeepSeekClient({ apiKey }), hostedFactory = () => new HostedAIClient({ config }) } = {}) { this.config = config; this.accountStates = accountStates; this.storage = storage; this.byokFactory = byokFactory; this.hostedFactory = hostedFactory; }
  async generateReplies(input) {
    const state = await this.accountStates.getState();
    if (state.status === "credits_available") {
      if (state.source !== "server") throw new Error("云端 AI 服务尚未配置；当前仅为开发测试状态。");
      const hosted = this.hostedFactory();
      const raw = await hosted.generateReplies(input);
      if (hosted.lastQuota) this.accountStates.updateServerQuota?.(hosted.lastQuota);
      return raw;
    }
    if (state.status === "developer_mode" && this.config.channel === "development" && state.source === "development_mock") {
      const key = await this.storage.getApiKey();
      if (!key) throw new Error("请先在设置中心配置自己的 DeepSeek API Key。");
      return this.byokFactory(key).generateReplies(input);
    }
    if (state.status === "credits_exhausted") throw new Error("生成次数已用完，请前往官网查看充值套餐。");
    if (state.status === "frozen") throw new Error("账户已暂停，请联系支持。");
    if (state.status === "auth_unavailable") throw new Error("授权服务暂时不可用，请稍后重试。");
    if (state.status === "auth_expired") throw new Error("登录已过期，请在设置中心重新连接账户。");
    throw new Error("请先在设置中心连接官网账户。");
  }
  generateReplyAnalysis(input) { return this.generateReplies(input); }
}
