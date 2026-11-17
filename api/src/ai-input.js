// Shared input contract for hosted generation. No network or storage side effects.
export function normalizeAiInput(body) {
  const requestId = typeof body.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.requestId) ? body.requestId : "";
  const post = body.post && typeof body.post === "object" && !Array.isArray(body.post) ? body.post : {};
  const text = typeof post.text === "string" ? post.text.trim() : "";
  let url = typeof post.url === "string" ? post.url : "";
  if (url) {
    let parsed; try { parsed = new URL(url); } catch { throw new TypeError("Invalid AI input"); }
    if (parsed.username || parsed.password || parsed.port) throw new TypeError("Invalid AI input");
    url = parsed.origin + parsed.pathname;
  }
  if (!requestId || !text || text.length > 12_000 || (url && !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(url))) throw new TypeError("Invalid AI input");
  const profile = body.voiceProfile && typeof body.voiceProfile === "object" && !Array.isArray(body.voiceProfile) ? body.voiceProfile : undefined;
  const history = Array.isArray(body.recentHistory) ? body.recentHistory.slice(0, 20) : [];
  const styleStats = body.styleStats && typeof body.styleStats === "object" && !Array.isArray(body.styleStats) ? body.styleStats : undefined;
  const replyStyle = ["natural-friendly", "short", "balanced", "bold"].includes(String(body.replyStyle)) ? String(body.replyStyle) : "natural-friendly";
  // Protocol v2 opt-in is necessary for ja/ko. Keep v1 exactly unchanged so
  // existing request hashes and idempotent recovery remain byte-compatible.
  const v2 = body.outputSchemaVersion === 2;
  // Unspecified / explicit Reply stays byte-identical for old request hashes.
  const generationKind = body.generationKind === undefined ? "reply" : body.generationKind;
  if (!["reply","quote"].includes(generationKind) || (generationKind === "quote" && !v2)) throw new TypeError("Invalid AI input");
  return { requestId, post: { text, url }, profile, history, styleStats, replyStyle, ...(v2 ? {outputSchemaVersion:2} : {}), ...(generationKind === "quote" ? {generationKind:"quote"} : {}) };
}
