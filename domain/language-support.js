// Shared reply-language contract: UI locale is independent from reply locale.
// Existing auto, Chinese and English profiles retain their current semantics.
export const REPLY_LANGUAGES = Object.freeze([
  "auto", "zh", "zh-TW", "en", "ja", "ko", "es", "fr", "de",
  "pt", "pt-BR", "it", "ru", "ar", "hi", "id", "th", "vi", "tr", "uk", "nl"
]);
const bases = new Set(REPLY_LANGUAGES.filter(code => code !== "auto").map(code => code.split("-")[0]));
export function normalizeReplyLanguage(value) {
  if (value === "auto") return "auto";
  if (typeof value !== "string" || value.length > 24 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(value)) return null;
  try {
    const canonical = Intl.getCanonicalLocales(value)[0];
    return canonical && bases.has(canonical.split("-")[0]) ? canonical : null;
  } catch { return null; }
}
// Conservative script hints, not guesses at X's own language metadata.
// Kanji-only Japanese and Latin-script languages are left for the model.
export function inferPostLanguageHint(text) {
  if (typeof text !== "string" || !text.trim()) return "auto";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
  if (/\p{Script=Hangul}/u.test(text)) return "ko";
  if (/\p{Script=Thai}/u.test(text)) return "th";
  if (/\p{Script=Arabic}/u.test(text)) return "ar";
  if (/\p{Script=Devanagari}/u.test(text)) return "hi";
  if (/\p{Script=Cyrillic}/u.test(text)) return "auto"; // ru, uk, etc. are ambiguous
  return "auto";
}
