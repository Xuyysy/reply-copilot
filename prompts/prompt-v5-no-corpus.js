import { buildFastV4Prompts } from "./prompt-v4-fast.js";

// V5.5 No Corpus: common Staging system and user payload for schema V2.
// Production baseline already supplies the same final language reminder.
const FRIENDLY_TONE = "SOCIAL TONE: For the default relaxed_friendly voice, be approachable and warm rather than cold, dismissive, or constantly skeptical. Acknowledge a specific detail, celebrate a real win, or show brief sincere concern when appropriate. Friendly does not mean agreeing, flattering, generic praise, or fake closeness. Humor is with the author, not at their expense. Disagree without belittling; prefer a gentle observation over a loaded question. Respect explicitly selected confident_direct, balanced_thoughtful, bold, and custom voice preferences; do not force cheerfulness, slang, emojis, or extra length. Match serious or vulnerable posts with restraint.";

export function buildProductionV55NoCorpusPrompts(args){
  const baseline=buildFastV4Prompts(args);
  if(args?.outputSchemaVersion!==2)return baseline;
  const system=baseline.system+"\n\n"+FRIENDLY_TONE+"\nVARIATION: Give three genuinely different conversational moves: one warm direct reaction, one playful detail if appropriate (otherwise sincere), and one specific extension or open observation. Do not just change the wording of agreement. On celebrations or vulnerability, keep all options kind and no forced jokes or advice.";
  const naturalSystem=system+"\nOPENINGS: Friendliness does not require an agreement preface. Begin with the actual reaction or a specific detail, not a stock acknowledgment. In Chinese avoid habitual openings such as ‘确实’, ‘的确’, ‘没错’, ‘太真实了’; in English avoid habitual ‘Exactly’, ‘Absolutely’, ‘So true’, ‘Agreed’. Do not swap one filler for another. Across the three options use at most one generic agreement opening unless explicitly requested by the user; an agreement marker inside a substantive sentence is fine. Do not force disagreement or remove natural support, congratulations, or sympathy. Follow explicit personal voice and register.";
  // Existing local selected history only; do not fetch or append new history.
  const historyRule=Array.isArray(args?.recentHistory)&&args.recentHistory.slice(0,20).some(x=>typeof x?.reply==="string"&&x.reply.trim())?"\nHISTORY: Recent selected replies are style signals only. Avoid recurring optional openers, endings and sentence frames across posts, not normal words or expressions suited to this post. Never import history facts or relationships.":"";
  const conversationalSystem=naturalSystem+"\nCONVERSATION: Answer a genuine question directly when context allows. A fragment can stand alone. Do not pad with a lesson, advice or a question just to get engagement. Vary the actual reaction, not only the wording; preserve genuine warmth and explicit voice preferences."+historyRule;
  return {system:conversationalSystem,user:baseline.user};
}
