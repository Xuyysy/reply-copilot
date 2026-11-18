(() => {
  // Read-only account + local context warmup in verified packaged builds.
  // Production requires the exact store extension ID; dev/test installs never
  // activate this optional network prewarm.
  if (window.top !== window) return;
  try {
    const sw = chrome.runtime.getManifest()?.background?.service_worker;
    const packagedStaging = sw === "staging/service-worker.js";
    const storeId = "fgfjajofkapebgphfidblngcjomkbdaj";
    const packagedProduction = sw === "background/service-worker.js" && chrome.runtime.id === storeId;
    if (!packagedStaging && !packagedProduction) return;
  } catch { return; }
  if (!/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//.test(location.href)) return;
  const api = globalThis.ZaneReplyCopilotContent;
  if (!api?.replyDetector) return;
  const key = Symbol.for("zane-reply-copilot.coldstart-prewarm-v2");
  if (globalThis[key]) return;
  globalThis[key] = true;
  const MIN_INTERVAL_MS = 30_000;
  let lastSentAt = null;
  let pending = false;
  const stats = {attempts:0,prepared:0,cooldowns:0,failures:0,lastRttMs:null,lastWorkerUptimeMs:null,lastWorkerReadyAfterImportsMs:null,lastPreparationMs:null};
  const active = () => {
    try { return Boolean(chrome.runtime?.id && document.visibilityState === "visible" && document.hasFocus() !== false); }
    catch { return false; }
  };
  const report = () => ({
    ...stats, pending, foreground: active(),
    msSinceLastAttempt: lastSentAt === null ? null : Math.max(0, Date.now() - lastSentAt),
  });
  // Isolated-world local diagnostic. Never includes post text, URL, identity or token.
  globalThis.replyCopilotColdStartReport = report;
  function prewarm() {
    if (!active() || pending) return;
    const now = Date.now();
    if (lastSentAt !== null && now - lastSentAt < MIN_INTERVAL_MS) return;
    pending = true;
    lastSentAt = now;
    stats.attempts++;
    const started = performance.now();
    try {
      void chrome.runtime.sendMessage({type:"REPLY_COPILOT_PREWARM_ACCOUNT"}).then(result => {
        if (result?.ok === true) {
          if (result.kind === "cooldown") stats.cooldowns++;
          else stats.prepared++;
          if (Number.isFinite(result.workerUptimeMs)) stats.lastWorkerUptimeMs = result.workerUptimeMs;
          if (Number.isFinite(result.workerReadyAfterImportsMs)) stats.lastWorkerReadyAfterImportsMs = result.workerReadyAfterImportsMs;
          if (Number.isFinite(result.elapsedMs)) stats.lastPreparationMs = result.elapsedMs;
        } else stats.failures++;
      }).catch(() => { stats.failures++; }).finally(() => {
        stats.lastRttMs = Math.max(0, Math.round(performance.now() - started));
        pending = false;
      });
    } catch {
      stats.failures++; pending = false;
    }
  }
  function onIntent(event) {
    if (!event.isTrusted || !active()) return;
    // Hover, keyboard focus or pointer-down on a real X Reply control only.
    // Never infer a post or dispatch a model request here.
    const control = api.replyDetector.findReplyControl(event.target, event);
    if (!control?.closest?.("article")) return;
    prewarm();
  }
  document.addEventListener("pointerover",onIntent,true);
  document.addEventListener("pointerdown",onIntent,true);
  document.addEventListener("focusin",onIntent,true);
  document.addEventListener("visibilitychange",prewarm);
  window.addEventListener("focus",prewarm);
  // A page boot automatically wakes the Worker already; prepare account in
  // parallel with React hydration, before a first human Reply click.
  queueMicrotask(prewarm);
})();
