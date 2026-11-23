// Isolated content script; starts only when requested by an extension page.
// Reads visible X follower/following DOM and scrolls a bounded amount.
// No cookies, private endpoints, hidden page state, requests or bulk actions.
(() => {
  const api = globalThis.ReplyCopilotFollowDom;
  if (!api) return;
  const INSTALL_KEY = Symbol.for("xrh.follow-web-dom-scanner");
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const INTERVAL_MS = 1150;
  const MAX_DURATION_MS = 4 * 60 * 1000;
  const MAX_PASSES = 240;
  const MAX_USERS = 3000;
  const STABLE_ROUNDS = 7;
  let active = null;
  const send = message => {
    try { void chrome.runtime.sendMessage(message).catch(() => {}); } catch {}
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const safeURL = () => /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)$/.test(location.origin);
  const matches = (owner, kind) => {
    const here = api.route(location.pathname);
    return safeURL() && here?.owner === owner && here?.kind === kind;
  };
  function report(session, done, reason) {
    send({type:done ? "XRH_FOLLOW_WEB_DONE" : "XRH_FOLLOW_WEB_PROGRESS",
      scanId:session.scanId, kind:session.kind, count:session.handles.size,
      ...(done ? {handles:[...session.handles], verification:session.verification, reason} : {})});
  }
  async function run(session) {
    const started = Date.now();
    let lastCount = -1;
    let lastHeight = -1;
    let stable = 0;
    let lastReported = 0;
    let reason = "timeout";
    try {
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        if (session.cancelled) { reason = "cancelled"; break; }
        if (!matches(session.owner, session.kind)) { reason = "page_changed"; break; }
        const root = document.querySelector('[data-testid="primaryColumn"]');
        if (!root) {
          if (Date.now() - started > 18000) { reason = "page_unavailable"; break; }
          await sleep(INTERVAL_MS);
          continue;
        }
        api.collect(document, session.handles, session.verification);
        if (session.handles.size >= MAX_USERS) { reason = "limit"; break; }
        const now = Date.now();
        if (now - lastReported >= 2400) {
          report(session, false);
          lastReported = now;
        }
        if (now - started >= MAX_DURATION_MS) { reason = "timeout"; break; }
        const scrollRoot = document.scrollingElement || document.documentElement;
        const height = scrollRoot?.scrollHeight || 0;
        const bottom = (scrollRoot?.scrollTop || window.scrollY) + window.innerHeight >= height - 18;
        if (bottom && lastCount === session.handles.size && lastHeight === height) stable++;
        else stable = 0;
        if (bottom && stable >= STABLE_ROUNDS && session.handles.size) {
          reason = "bottom_observed";
          break;
        }
        lastCount = session.handles.size;
        lastHeight = height;
        // User opted in to a limited, read-only scan. No clicks or mutations.
        window.scrollBy({top:Math.max(400,Math.min(760,Math.floor(window.innerHeight * .8))),behavior:"auto"});
        await sleep(INTERVAL_MS);
      }
      if (session.handles.size === 0 && reason !== "cancelled") reason = "empty";
      else if (reason === "timeout" && Date.now() - started < MAX_DURATION_MS) reason = "limit";
    } catch {
      reason = "page_error";
    } finally {
      if (active === session) active = null;
      report(session, true, reason);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") return;
    if (message.type === "XRH_FOLLOW_WEB_PING") {
      respond({ok:safeURL(),route:api.route(location.pathname)});
      return;
    }
    if (message.type === "XRH_FOLLOW_WEB_CANCEL") {
      if (active && message.scanId === active.scanId) {
        active.cancelled = true;
        respond({ok:true});
      } else respond({ok:false});
      return;
    }
    if (message.type !== "XRH_FOLLOW_WEB_START") return;
    const owner = api.normalize(message.owner);
    const kind = message.kind;
    const currentAccount = api.loggedInHandle(document);
    if (!owner || !["following","followers"].includes(kind) ||
        !/^[a-f0-9-]{36}$/.test(String(message.scanId)) || !matches(owner, kind)) {
      respond({ok:false,error:"扫描页面或账号不匹配，请检查 X 登录状态。"});
      return;
    }
    // When the active-account link is visible, reject scanning someone else's list.
    if (currentAccount && currentAccount !== owner) {
      respond({ok:false,error:"当前登录 X 的账号和输入的用户名不一致。请切换到自己的账号。"});
      return;
    }
    if (active) { respond({ok:false,error:"此 X 标签页已有扫描任务。"}); return; }
    const session = {owner, kind, scanId:message.scanId, handles:new Set(),verification:Object.create(null),cancelled:false};
    active = session;
    respond({ok:true});
    void run(session);
  });
})();
