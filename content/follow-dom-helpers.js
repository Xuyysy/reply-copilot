// DOM-only helpers for voluntarily opened X follower/following pages.
// Uses rendered user cards, never cookies, hidden client stores, or network APIs.
(() => {
  const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
  const RESERVED = new Set(["home","explore","notifications","messages","settings","search",
    "compose","i","jobs","premium","communities","login","signup","tos","privacy","help"]);
  const normalize = raw => {
    const handle = String(raw ?? "").trim().replace(/^@/, "");
    return HANDLE.test(handle) && !RESERVED.has(handle.toLowerCase()) ? handle.toLowerCase() : "";
  };
  function route(pathname) {
    const match = /^\/([A-Za-z0-9_]{1,15})\/(following|followers)\/?$/i.exec(String(pathname ?? ""));
    if (!match) return null;
    const owner = normalize(match[1]);
    return owner ? {owner, kind:match[2].toLowerCase()} : null;
  }
  function loggedInHandle(doc) {
    const link = doc.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const path = link?.getAttribute?.("href") || "";
    const match = /^\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/.exec(path);
    return match ? normalize(match[1]) : null;
  }
  function cells(doc) {
    const primary = doc.querySelector('[data-testid="primaryColumn"]');
    if (!primary) return [];
    return [...primary.querySelectorAll('[data-testid="UserCell"]')];
  }
  function parseCell(cell) {
    if (!cell || typeof cell.querySelectorAll !== "function") return null;
    // Name-area links are preferred to avoid copying unrelated navigation.
    const nameArea = cell.querySelector?.('[data-testid="User-Name"]');
    const candidates = nameArea?.querySelectorAll('a[href^="/"]') || cell.querySelectorAll('a[href^="/"]');
    for (const link of candidates) {
      const href = link.getAttribute("href") || "";
      const match = /^\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/.exec(href);
      if (!match) continue;
      const handle = normalize(match[1]);
      if (handle) return handle;
    }
    return null;
  }
  function collect(doc, target) {
    for (const cell of cells(doc)) {
      if (typeof cell.getBoundingClientRect === "function") {
        const rect = cell.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom < 0 || rect.top > (doc.defaultView?.innerHeight ?? 1000)) continue;
      }
      const handle = parseCell(cell);
      if (handle && target.size < 3000) target.add(handle);
    }
    return target.size;
  }
  function compare(followers, following) {
    const a = new Set((followers || []).map(normalize).filter(Boolean));
    const b = new Set((following || []).map(normalize).filter(Boolean));
    return {
      mutual: [...b].filter(handle => a.has(handle)),
      notFollowingBack: [...b].filter(handle => !a.has(handle)),
      iHaveNotFollowedBack: [...a].filter(handle => !b.has(handle))
    };
  }
  globalThis.ReplyCopilotFollowDom = Object.freeze({normalize,route,loggedInHandle,cells,parseCell,collect,compare});
})();
