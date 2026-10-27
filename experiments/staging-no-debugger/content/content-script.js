(() => {
  const api = globalThis.ZaneReplyCopilotContent;
  let active = null;
  let contextAlive = true;
  let nativeInputHealthy = true;
  let bindingTimer = null;
  let settingsRevision = 0;
  const isX = /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//.test(location.href);
  if (!isX) return;
  const installKey = Symbol.for("zane-reply-copilot.content-script-installed");
  if (globalThis[installKey]) return;
  globalThis[installKey] = true;

  function stopInvalidContext() {
    if (!contextAlive) return;
    contextAlive = false;
    try { active?.observer?.disconnect(); } catch {}
    try { active?.editor?.removeEventListener("input", active.onComposerInput, true); } catch {}
    try { active?.assistant?.host?.remove(); } catch {}
    if (bindingTimer) clearInterval(bindingTimer);
    active = null;
    try { document.removeEventListener("click", onDocumentClick, true); } catch {}
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch {}
  }
  function hasRuntimeContext() {
    try {
      if (!chrome.runtime?.id) { stopInvalidContext(); return false; }
      return contextAlive;
    } catch { stopInvalidContext(); return false; }
  }
  function safeSend(message) {
    if (!hasRuntimeContext()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(message).catch((error) => {
        if (/extension context invalidated/i.test(error?.message || "")) stopInvalidContext();
        return { ok: false, error: "插件后台连接已中断，请重新加载扩展并刷新 X 页面。" };
      });
    } catch (error) {
      if (/extension context invalidated/i.test(error?.message || "")) stopInvalidContext();
      return Promise.resolve({ ok: false, error: "插件后台连接已中断，请重新加载扩展并刷新 X 页面。" });
    }
  }

  function record(eventName, data = {}) {
    if (!active) return;
    void safeSend({ type: "REPLY_COPILOT_HISTORY", requestId: active.requestId, sourceText: active.post.sourceText, sourceUrl: active.post.sourceUrl, event: eventName, ...data });
  }
  function localizeError(message) {
    if (/[\u3400-\u9fff]/.test(message || "")) return message;
    if (/timed out|timeout|AbortError/i.test(message || "")) return "云端 AI 请求超时，请稍后重试。";
    if (/Could not reach|network request failed|fetch/i.test(message || "")) return "无法连接云端服务，请检查网络后重试。";
    if (/unauthorized/i.test(message || "")) return "账户授权已过期，请重新连接官网账户。";
    if (/rate limit/i.test(message || "")) return "请求次数已达限制，请稍后重试。";
    if (/invalid JSON|invalid.*response|empty response|structured response/i.test(message || "")) return "AI 返回内容暂时无法识别，请重新生成。";
    return "回复生成失败，请稍后重试。";
  }
  function matchedComposer(post) {
    if (!hasRuntimeContext()) return { editor: null, matchedPost: false };
    const livePost = post.article?.isConnected ? api.postExtractor.extractPost(post.article) : null;
    if (!livePost?.ok || livePost.statusId !== post.statusId || livePost.sourceUrl !== post.sourceUrl) return { editor: null, matchedPost: false };
    const selectors = '[contenteditable="true"][role="textbox"], [data-testid="tweetTextarea_0"][contenteditable="true"]';
    const articleEditors = [...(post.article?.querySelectorAll?.(selectors) || [])].filter(node => node.isConnected && !node.closest('[aria-hidden="true"]'));
    let editor = articleEditors.length === 1 ? articleEditors[0] : null;
    let matchedPost = Boolean(editor);
    if (!editor) {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        const statusLink = [...dialog.querySelectorAll('a[href*="/status/"]')].some((anchor) => { try { const u = new URL(anchor.href); return ['x.com','twitter.com','www.x.com','www.twitter.com'].includes(u.hostname) && new RegExp(`/status/${post.statusId}(?:/|$)`).test(u.pathname); } catch { return false; } });
        const candidates = [...dialog.querySelectorAll('[contenteditable="true"][role="textbox"], [data-testid="tweetTextarea_0"][contenteditable="true"]')].filter((node) => node.isConnected);
        if (statusLink && candidates.length === 1) { editor = candidates[0]; matchedPost = true; }
      }
    }
    return { editor, matchedPost };
  }
  function begin(control, post) {
    if (active?.post?.statusId === post.statusId && active.editor?.isConnected && !active.cancelled && (active.initializing || active.generating || active.assistant?.host?.isConnected)) return;
    if (!hasRuntimeContext()) return;
    if (active?.requestId) void safeSend({ type: "REPLY_COPILOT_CANCEL", requestId: active.requestId });
    if (bindingTimer) { clearInterval(bindingTimer); bindingTimer = null; }
    try { active?.editor?.removeEventListener("input", active.onComposerInput, true); } catch {}
    if (active?.observer) active.observer.disconnect();
    if (active?.assistant?.host?.isConnected) active.assistant.host.remove();
    const requestId = crypto.randomUUID();
    active = { requestId, post, control, editor: null, assistant: null, generated: false, cancelled: false, initializing: true, attemptedInput: new Set() };
    const setTimeoutId = setTimeout(() => {
      active?.observer?.disconnect();
      if (active?.requestId === requestId && !active.assistant) showFallback("没有找到与这条帖子明确关联的回复框。请用侧边栏继续。", post.article);
    }, 9000);
    const locate = () => {
      if (!hasRuntimeContext()) return false;
      if (!active || active.requestId !== requestId || active.cancelled) return false;
      let found;
      try { found = matchedComposer(post); }
      catch (error) { if (/extension context invalidated/i.test(error?.message || "")) stopInvalidContext(); return false; }
      if (!found.editor || !found.matchedPost) return false;
      clearTimeout(setTimeoutId); active.editor = found.editor; active.matchedPost = found.matchedPost;
      const session = active;
      session.initialComposerText = api.composerAdapter.hasContent(found.editor);
      session.userTouchedComposer = false;
      session.onComposerInput = () => { if (!session.applyingReply) session.userTouchedComposer = true; };
      found.editor.addEventListener("input", session.onComposerInput, true);
      active.anchor = found.editor.parentElement || found.editor;
      active.observer?.disconnect(); active.observer = null;
      void prepareCurrent(requestId);
      return true;
    };
    if (!locate()) {
      const observer = new MutationObserver(() => { try { if (locate()) observer.disconnect(); } catch (error) { if (/extension context invalidated/i.test(error?.message || "")) stopInvalidContext(); } });
      active.observer = observer;
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["contenteditable", "role"] });
    }
  }
  async function prepareCurrent(requestId) {
    const current = active;
    try {
      const response = await safeSend({ type: "REPLY_COPILOT_GET_BEHAVIOR" });
      if (!contextAlive) return;
      if (!active || active.requestId !== requestId) return;
      if (!response?.ok) throw new Error("无法读取插件设置");
      current.preferences = response.preferences; current.initializing = false;
      if (current.preferences.showFloatingWindow) current.assistant = api.inlineAssistant.mount(current.anchor, handleAction, { preferences: current.preferences });
      const account = await refreshAccount(current);
      if (!active || active.requestId !== requestId) return;
      if (account?.status === "credits_available") {
        if (current.preferences.autoGenerateOnReply && current.preferences.showFloatingWindow) void generateActive(requestId);
        else current.assistant?.showReady(current.preferences.autoGenerateOnReply);
      }
    } catch { if (!contextAlive) return; current.initializing = false; current.assistant = api.inlineAssistant.mount(current.anchor, handleAction); current.assistant.setStatus("无法读取插件设置，请打开设置中心检查。"); }
  }
  async function refreshAccount(current) {
    const previousStatus = current.accountStatus;
    const wasPending = current.pendingBinding;
    const response = await safeSend({ type: "REPLY_COPILOT_ACCOUNT_STATE" });
    if (active !== current || !current.assistant) return response;
    current.accountStatus = response?.ok ? response.status : "auth_unavailable";
    current.pendingBinding = Boolean(response?.pending);
    current.assistant.showAccount(current.accountStatus, response?.quota, response?.pending);
    if ((wasPending || previousStatus !== "credits_available") && !response?.pending && current.accountStatus === "credits_available" && !current.result && !current.generating) current.assistant.showReady(current.preferences?.autoGenerateOnReply);
    if (response?.pending && !bindingTimer) bindingTimer = setInterval(() => void refreshAccount(current), 3500);
    if (!response?.pending && bindingTimer) { clearInterval(bindingTimer); bindingTimer = null; }
    return response;
  }
  function remountAssistant(current, preferences) {
    current.assistant?.close(); current.assistant = null;
    if (!preferences.showFloatingWindow || current.dismissed || !current.anchor?.isConnected) return;
    current.preferences = preferences;
    current.assistant = api.inlineAssistant.mount(current.anchor, handleAction, { preferences });
    if (current.appliedText) { current.assistant.showResult(current.result.replies, current.appliedStyle || "natural"); current.assistant.showApplied(); }
    else if (current.result) current.assistant.showResult(current.result.replies, preferences.defaultReplyMode || current.result.defaultStyle || "natural");
    else if (current.generating) current.assistant.showLoading();
    else if (current.accountStatus === "credits_available") current.assistant.showReady(preferences.autoGenerateOnReply);
    else void refreshAccount(current);
  }
  function showFallback(message, anchor) {
    const fallback = api.inlineAssistant.mount(anchor, handleAction, { compact: true, dismissAfterMs: 12_000 });
    active.assistant = fallback; fallback.setStatus(message);
  }
  async function autoFillCurrent(current, requestId, style) {
    const candidate = current.result?.replies?.[style];
    if (current.result?.recommendation === "skip" || typeof candidate !== "string" || !candidate.trim() || current.attemptedInput.has(requestId)) return;
    const normalized = candidate.trim();
    if (normalized.length % 2 === 0 && normalized.slice(0, normalized.length / 2) === normalized.slice(normalized.length / 2)) {
      current.assistant?.setStatus("AI 建议本身含有重复文字，请换一种表达；这条未填入回复框。");
      return;
    }
    if (!nativeInputHealthy) { current.assistant?.setStatus("本页面的自动填入已停止，可复制建议后粘贴。"); return; }
    if (current.initialComposerText || current.userTouchedComposer || api.composerAdapter.hasContent(current.editor)) {
      current.assistant?.setStatus("回复框已有内容，已保留原文；可以复制建议后自行调整。");
      return;
    }
    current.attemptedInput.add(requestId);
    const valid = () => contextAlive && document.visibilityState === "visible" && document.hasFocus() && active === current && current.requestId === requestId && !current.cancelled && current.editor?.isConnected && !current.userTouchedComposer && !api.composerAdapter.hasContent(current.editor) && matchedComposer(current.post).editor === current.editor;
    if (!valid() || document.activeElement !== current.editor || !api.composerAdapter.focusEmpty(current.editor)) {
      current.assistant?.setStatus("回复框已变化，已保留现有内容；可以复制建议后粘贴。");
      return;
    }
    current.applyingReply = true;
    const inserted = api.composerAdapter.insertOnce(current.editor, requestId, candidate, valid);
    current.applyingReply = false;
    if (!contextAlive || active !== current || current.requestId !== requestId || current.cancelled) return;
    if (!inserted) { current.assistant?.setStatus("X 回复框未接受自动填入，可复制建议后粘贴。"); return; }
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (!contextAlive || active !== current || current.requestId !== requestId || current.cancelled) return;
    if (current.userTouchedComposer) {
      current.assistant?.setStatus("回复框已被修改，请核对草稿；建议仍可复制。"); return;
    }
    if (!current.editor?.isConnected || api.composerAdapter.readText(current.editor) !== candidate.trim()) {
      nativeInputHealthy = false;
      current.assistant?.setStatus("X 回复框显示与候选不一致。请关闭这个草稿并刷新 X 后再试；当前建议可复制。");
      return;
    }
    current.appliedText = candidate.trim(); current.appliedStyle = style;
    current.assistant?.showApplied();
    record("applied", { style, reply: candidate });
  }
  async function generateActive(requestId) {
    const current = active;
    if (!current || current.requestId !== requestId || current.cancelled || current.generating || current.generated) return;
    if (!['credits_available'].includes(current.accountStatus)) { void refreshAccount(current); return; }
    if (!current.editor?.isConnected || !current.matchedPost) { current.assistant?.setStatus("无法准确匹配原帖和回复框，请打开侧栏继续。"); return; }
    current.generating = true; current.assistant?.showLoading();
    try {
      const response = await safeSend({ type: "REPLY_COPILOT_GENERATE", requestId, sourceText: current.post.sourceText, sourceUrl: current.post.sourceUrl });
      if (!contextAlive) return;
      if (!active || active.requestId !== requestId || active.cancelled || !active.editor?.isConnected) return;
      if (!response?.ok) throw Object.assign(new Error(response?.error || "生成失败，请打开侧边栏重试。"), { code: response?.code || "" });
      current.generated = true; current.generating = false; current.result = response.result;
      current.retrySameRequestId = false;
      current.assistant?.setAccountLabel(response.accountLabel);
      const selectedStyle = current.preferences?.defaultReplyMode || response.result.defaultStyle || response.result.default_style || "natural";
      current.assistant?.showResult(response.result.replies, selectedStyle);
      void safeSend({ type: "REPLY_COPILOT_ACCOUNT_STATE" }).then((state) => { if (active === current && state?.ok) { current.accountStatus = state.status; current.assistant?.setAccountLabel(state.quota?.totalRemaining != null ? `剩余 ${state.quota.totalRemaining} 次` : response.accountLabel); } });
      if (response.result.recommendation === "skip") current.assistant?.setStatus(`建议先跳过：${response.result.reason}`);
      else await autoFillCurrent(current, requestId, selectedStyle);
    } catch (error) {
      current.generating = false;
      current.retrySameRequestId = error?.code === "DELIVERY_CONFIRMATION_PENDING" || error?.code === "NETWORK_ERROR";
      if (active?.requestId === requestId) { current.assistant?.setStatus(localizeError(error.message || "")); current.assistant?.showRetry(); }
    }
  }
  function handleAction(action, data) {
    if (!active) return;
    const current = active;
    if (action === "dismiss") {
      current.cancelled = true; current.dismissed = true;
      current.observer?.disconnect();
      try { current.editor?.removeEventListener("input", current.onComposerInput, true); } catch {}
      void safeSend({ type: "REPLY_COPILOT_CANCEL", requestId: current.requestId });
      current.assistant = null;
      if (bindingTimer) { clearInterval(bindingTimer); bindingTimer = null; }
      return;
    }
    if (!hasRuntimeContext()) return;
    if (action === "sidepanel") { void safeSend({ type: "REPLY_COPILOT_OPEN_SIDEPANEL", sourceText: current.post?.sourceText, sourceUrl: current.post?.sourceUrl }); return; }
    if (action === "settings") { void safeSend({ type: "REPLY_COPILOT_OPEN_SETTINGS" }); return; }
    if (action === "toggle_auto_generate") {
      if (typeof data.enabled !== "boolean") return;
      current.preferences = { ...current.preferences, autoGenerateOnReply: data.enabled };
      void safeSend({ type: "REPLY_COPILOT_SET_AUTO_GENERATE", enabled: data.enabled }).then((response) => { if (!response?.ok) { current.assistant?.setAutoGenerate(!data.enabled); current.assistant?.setStatus("保存开关失败，请重试。"); } });
      if (!current.generating && !current.result && ['credits_available'].includes(current.accountStatus)) current.assistant?.showReady(data.enabled);
      return;
    }
    if (action === "register" || action === "login") { void safeSend({ type: "REPLY_COPILOT_BEGIN_BINDING", mode: action }).then((response) => { if (response?.ok) void refreshAccount(current); else current.assistant?.setStatus(response?.error || "无法打开官网，请重试。"); }); return; }
    if (action === "pricing") { void safeSend({ type: "REPLY_COPILOT_OPEN_PRICING" }); return; }
    if (action === "check-account") { void refreshAccount(current); return; }
    if (action === "position_changed") { void safeSend({ type: "REPLY_COPILOT_SET_FLOATING_POSITION", left: data.left, top: data.top }); return; }
    if (action === "generate") { void generateActive(current.requestId); return; }
    if (action === "regenerate") {
      const retryPending = current.retrySameRequestId;
      if (!retryPending) void safeSend({ type: "REPLY_COPILOT_CANCEL", requestId: current.requestId });
      const requestId = retryPending ? current.requestId : crypto.randomUUID();
      current.requestId = requestId; current.generated = false; current.generating = false;
      current.retrySameRequestId = false;
      current.assistant?.showLoading("正在重新生成…");
      void generateActive(requestId);
      return;
    }
    if (action === "selected" || action === "select") { record("selected", data); return; }
    if (action === "copied") { record("copied", data); return; }
    if (action === "feedback") { void safeSend({ type: "REPLY_COPILOT_FEEDBACK", requestId: current.requestId, ...data }); return; }
    if (action === "manually_confirmed") { record("manually_confirmed", data); return; }
  }
  function onRuntimeMessage(message) {
    if (!hasRuntimeContext()) return false;
    if (message?.type !== "REPLY_COPILOT_SETTINGS_CHANGED" || !active?.editor?.isConnected) return false;
    const current = active, requestId = current.requestId, revision = ++settingsRevision;
    void safeSend({ type: "REPLY_COPILOT_GET_BEHAVIOR" }).then((response) => {
      if (!contextAlive) return;
      if (!active || active.requestId !== requestId || !response?.ok || revision !== settingsRevision) return;
      const needsRemount = current.preferences?.showFloatingWindow !== response.preferences.showFloatingWindow;
      current.preferences = response.preferences;
      if (needsRemount) remountAssistant(current, response.preferences);
      else { current.assistant?.setAutoGenerate(response.preferences.autoGenerateOnReply); if (!current.generating && !current.result && ['credits_available'].includes(current.accountStatus)) current.assistant?.showReady(response.preferences.autoGenerateOnReply); void refreshAccount(current); }
    }).catch(() => {});
    return false;
  }
  try { chrome.runtime.onMessage.addListener(onRuntimeMessage); } catch { stopInvalidContext(); return; }
  function onDocumentClick(event) {
    if (!hasRuntimeContext()) return;
    if (!event.isTrusted) return;
    const control = api.replyDetector.findReplyControl(event.target);
    if (!control || control.closest("[data-zane-reply-copilot]")) return;
    const article = control.closest("article");
    const post = api.postExtractor.extractPost(article);
    if (!post.ok) {
      if (active?.requestId) void safeSend({ type: "REPLY_COPILOT_CANCEL", requestId: active.requestId });
      try { active?.editor?.removeEventListener("input", active.onComposerInput, true); } catch {}
      active?.observer?.disconnect(); active?.assistant?.close?.();
      active = { requestId: crypto.randomUUID(), post: { article, sourceText: "", sourceUrl: "" }, assistant: null };
      showFallback("无法准确识别这条帖子，因此未发送文本给 AI。", article || control.parentElement || control);
      return;
    }
    begin(control, post);
  }
  document.addEventListener("click", onDocumentClick, true);
})();
