// Defensive parsers for X web client follow-relationship timelines.
// The internal X schema is undocumented; malformed or changed shapes fail closed.
// These helpers never access credentials, make requests, or execute page scripts.
(() => {
  const VALID_HANDLE = /^[a-z0-9_]{1,15}$/i;
  const VALID_ID = /^[1-9]\d{0,19}$/;
  function userInfo(result) {
    const user = result?.__typename === "User" ? result : result?.result || result;
    const handle = user?.core?.screen_name || user?.legacy?.screen_name;
    const id = user?.rest_id;
    if (typeof handle !== "string" || !VALID_HANDLE.test(handle) ||
        typeof id !== "string" || !VALID_ID.test(id)) return null;
    const verifiedType=user?.verified_type || user?.legacy?.verified_type;
    // Blue is distinct from gold business and grey government verification.
    // Never infer blue from legacy.verified or a generic badge.
    const blue=typeof user?.is_blue_verified === "boolean" ?
      (user.is_blue_verified && !["Business","Government"].includes(verifiedType)) : null;
    return {
      handle:handle.toLowerCase(),id,
      ...(blue === null ? {} : {blueVerified:blue})
    };
  }
  function parseProfile(payload) {
    const raw = payload?.data?.user?.result;
    const user = userInfo(raw);
    if (!user) throw new Error("账号信息接口没有返回可识别的账号。");
    return user;
  }
  function parsePage(payload) {
    const timeline = payload?.data?.user?.result?.timeline?.timeline ||
      payload?.data?.user?.result?.timeline_v2?.timeline;
    const instructions = timeline?.instructions;
    if (!Array.isArray(instructions)) {
      throw new Error("X 网页接口返回格式有变化，本次同步已停止。");
    }
    const entries = [];
    for (const instruction of instructions) {
      if (Array.isArray(instruction?.entries)) entries.push(...instruction.entries);
      if (Array.isArray(instruction?.moduleItems)) entries.push(...instruction.moduleItems);
      if (instruction?.entry) entries.push(instruction.entry);
    }
    const users = [];
    const seen = new Set();
    let bottomCursor = null;
    for (const entry of entries) {
      const c = entry?.content;
      if (!c || typeof c !== "object") continue;
      const cursorType = c.cursorType || c.content?.cursorType;
      const value = c.value || c.content?.value;
      if ((cursorType === "Bottom" || String(entry.entryId||"").includes("cursor-bottom")) &&
          typeof value === "string" && value.length <= 512) {
        bottomCursor = value;
      }
      const pieces = [c.itemContent, c.content?.itemContent,
        c.item?.itemContent, c.item?.content?.itemContent,
        ...(Array.isArray(c.items) ? c.items.map(x => x?.item?.itemContent ||
          x?.item?.content?.itemContent || x?.itemContent || x?.content?.itemContent) : [])];
      for (const piece of pieces) {
        if (!piece) continue;
        const found = userInfo(piece.user_results?.result || piece.user_results);
        if (found && !seen.has(found.id)) { users.push(found); seen.add(found.id); }
      }
    }
    return {users, nextCursor:bottomCursor,hasEntries:entries.length>0};
  }
  globalThis.ReplyCopilotInternalFollowParser = Object.freeze({parseProfile,parsePage});
})();
