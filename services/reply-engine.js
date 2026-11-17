import { validateSourceText } from "../utils/validation.js";
import { buildPrompts } from "../prompts/prompt-builder.js";
import { buildQuotePrompts } from "../prompts/quote-prompt-builder.js";
import { DEFAULT_VOICE_PROFILE } from "../domain/voice-profile.js";
import { parseAIOutput } from "../utils/output-parser.js";

export class ReplyEngine {
  constructor({ aiClient, historyService, voiceProfile = null, persona = null, usageService = null }) { this.aiClient = aiClient; this.historyService = historyService; this.voiceProfile = voiceProfile; this.persona = persona; this.usageService = usageService; }
  async generateReplies({ postContext, voiceProfile = this.voiceProfile, recentHistory, requestId = "" }, { replyStyle = "natural-friendly", generationKind = "reply", signal, styleStats, performanceTrace } = {}) {
    const sourceText = validateSourceText(postContext?.text || postContext?.sourceText);
    const request = { sourceText, sourceUrl: postContext?.url || postContext?.sourceUrl || "", requestId };
    const readContext = async () => {
      if (!recentHistory && !styleStats && this.historyService.getGenerationContext) return this.historyService.getGenerationContext(20);
      const [history, stats] = await Promise.all([recentHistory || this.historyService.getRecent(20), styleStats || this.historyService.getStats()]);
      return { recentHistory: history, styleStats: stats };
    };
    const context = await (performanceTrace ? performanceTrace.measure("history_context", readContext) : readContext());
    const selectedHistory = context.recentHistory, selectedStats = context.styleStats;
    const builder = generationKind === "quote" ? buildQuotePrompts : buildPrompts;
    const prompts = builder({ postContext: { text: sourceText, url: request.sourceUrl }, voiceProfile: voiceProfile || (this.persona ? undefined : DEFAULT_VOICE_PROFILE), persona: this.persona, recentHistory: selectedHistory, styleStats: selectedStats, replyStyle, ...(generationKind === "quote" ? {outputSchemaVersion:2} : {}) });
    const generate = this.aiClient.generateReplies || this.aiClient.generateReplyAnalysis;
    const raw = await generate.call(this.aiClient, { ...prompts, signal, ...(performanceTrace ? { performanceTrace } : {}), requestId, sourceText, sourceUrl: request.sourceUrl, voiceProfile: voiceProfile || DEFAULT_VOICE_PROFILE, recentHistory: selectedHistory, styleStats: selectedStats, replyStyle, ...(generationKind === "quote" ? {generationKind:"quote"} : {}) });
    return parseAIOutput(raw);
  }
  async generate(request, options = {}) { return this.generateReplies({ postContext: request, requestId: request?.requestId || "" }, options); }
}
