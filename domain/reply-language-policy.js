import { inferPostLanguageHint, normalizeReplyLanguage } from "./language-support.js";
import { parseAIOutput } from "../utils/output-parser.js";

// Language routing is local and costs no model requests. Preserve v1 contract.
export function resolveRequiredReplyLanguage({ sourceText = "", selectedLanguage = "auto" } = {}) {
  const selected = normalizeReplyLanguage(selectedLanguage) || "auto";
  if (selected !== "auto") return selected.split("-")[0];
  const scriptHint = inferPostLanguageHint(sourceText);
  if (scriptHint !== "auto") return scriptHint;
  // Han-only text can be Chinese or Japanese Kanji: defer to the model.
  return /\p{Script=Han}/u.test(sourceText) ? "auto" : "en";
}
function chars(text, pattern) { return (text.match(pattern) || []).length; }
function clearScriptMismatch(text, language) {
  const han = chars(text, /\p{Script=Han}/gu);
  const kana = chars(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = chars(text, /\p{Script=Hangul}/gu);
  const latin = chars(text, /\p{Script=Latin}/gu);
  if (language === "en") return han + kana + hangul >= 2 && han + kana + hangul > latin / 2;
  if (language === "ja") {
    const simplifiedChinese = /[这们为说过对没啥咋吗呢呀啦呗觉让发还已经谢请]/u.test(text);
    return hangul >= 2 || (kana === 0 && (simplifiedChinese || (han >= 4 && han > latin)));
  }
  if (language === "ko") return (han >= 2 && hangul === 0 && han > latin) || (kana >= 2 && hangul === 0);
  if (language === "zh") return latin >= 16 && han === 0 && kana === 0 && hangul === 0;
  return false;
}

// Reject obvious language mismatches BEFORE billing settlement. Existing
// generation flow refunds failed validation; never secretly regenerate.
export function assertReplyLanguageConsistency(raw, { sourceText = "", selectedLanguage = "auto" } = {}) {
  const reply = parseAIOutput(raw);
  const expected = resolveRequiredReplyLanguage({ sourceText, selectedLanguage });
  const actual = reply.language.split("-")[0];
  if (expected !== "auto" && expected !== actual) throw new Error("reply_language_tag_mismatch");
  const texts = [...Object.values(reply.replies), ...(reply.quoteCandidate ? [reply.quoteCandidate] : [])];
  if (texts.some(text => clearScriptMismatch(text, actual))) throw new Error("reply_language_text_mismatch");
  return reply;
}
