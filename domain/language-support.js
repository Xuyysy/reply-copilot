// Four generated reply languages; no additional language-detection API calls.
export const REPLY_LANGUAGES = Object.freeze(["auto", "zh", "en", "ja", "ko"]);
// Keep parsing known legacy/model BCP-47 tags to avoid a paid-generation format error.
// The visible manual language choices remain only the five REPLY_LANGUAGES.
const bases = new Set(["zh","en","ja","ko","es","fr","de","pt","it","ru","ar","hi","id","th","vi","tr","uk","nl"]);
export function normalizeReplyLanguage(value) {
  if (value === "auto") return "auto";
  if (typeof value !== "string" || value.length > 24 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(value)) return null;
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    return canonical && bases.has(canonical.split("-")[0]) ? canonical : null;
  } catch { return null; }
}
export function inferPostLanguageHint(text) {
  if (typeof text !== "string" || !text.trim()) return "auto";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
  if (/\p{Script=Hangul}/u.test(text)) return "ko";
  return "auto"; // Han-only and Latin-script language detection remains contextual.
}
