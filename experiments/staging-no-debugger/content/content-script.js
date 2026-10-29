(() => {
  const api = globalThis.ZaneReplyCopilotContent;
  let active = null;
  let contextAlive = true;
  let nativeInputHealthy = true;
  let bindingTimer = null;
  let settingsRevision = 0;
  let pendingActivation = null;
  let recoveryRequired = false;
  let recoveryReason = null;
  let sessionSequence = 0;
  let trustedGestureCount = 0;
  let replyControlPointerCount = 0;
  let replyControlClickCount = 0;
  const quarantinedPosts = [];
  const recentPostContexts = [];
  const diagnosticStartedAt = performance.now();
  let diagnosticSequence = 0;
  const diagnosticEvents = [];
  const diagnosticPathCounts = Object.create(null);
  const associationOnly = api.experimentConfig?.associationOnly !== false;
  const isX = /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//.test(location.href);
  if (!isX) return;
  const installKey = Symbol.for("zane-reply-copilot.content-script-installed");
  if (globalThis[installKey]) return;
  globalThis[installKey] = true;
  const diagnostic = (stage, detail = {}) => {
    const safeDetail = {};
    for (const [key, value] of Object.entries(detail || {})) {
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) safeDetail[key] = value;
      else if (typeof value === 'string' && /^(?:[a-z][a-z0-9_]{0,47})$/.test(value)) safeDetail[key] = value;
    }
    const entry = { n: ++diagnosticSequence, t: Math.max(0, Math.round(performance.now() - diagnosticStartedAt)), session: active?.diagnosticSession || null, stage, ...safeDetail };
    diagnosticEvents.push(entry);
    if (diagnosticEvents.length > 100) diagnosticEvents.shift();
    try { console.info('[xrh-staging-composer]', stage, JSON.stringify(entry)); } catch {}
  };
  const diagnosticPath = (reason, detail = {}) => {
    diagnosticPathCounts[reason] = (diagnosticPathCounts[reason] || 0) + 1;
    diagnostic('association_path', { reason, ...detail });
  };
  function postKindFlags(post) {
    const kinds = new Set(post?.postKinds || []);
    return { hasText: Boolean(post?.sourceText), hasPhoto: kinds.has('photo'), hasVideo: kinds.has('video'), hasPoll: kinds.has('poll'), hasQuote: kinds.has('quote'), hasLongform: kinds.has('longform') };
  }
  // DevTools content-script context: copy(__xrhStagingDiagnosticReport()). The
  // report contains only lifecycle enums, booleans, counters and relative time.
  globalThis.__xrhStagingDiagnosticReport = () => JSON.stringify({ build: 'staging-post-context-20261029-1', ageMs: Math.max(0, Math.round(performance.now() - diagnosticStartedAt)), runtimeAlive: contextAlive, recoveryRequired, trustedGestureCount, replyControlPointerCount, replyControlClickCount, pathCounts: { ...diagnosticPathCounts }, active: active ? { state: active.cancelled ? 'cancelled' : active.editor ? active.generating ? 'generating' : active.appliedText ? 'applied' : 'bound' : 'acquiring', editorConnected: Boolean(active.editor?.isConnected), assistantConnected: Boolean(active.assistant?.host?.isConnected) } : null, events: diagnosticEvents }, null, 2);

  function stopInvalidContext() {
    if (!contextAlive) return;
    diagnostic('runtime_context_invalidated',{hadActiveSession:Boolean(active)});
    contextAlive = false;
    try { active?.observer?.disconnect(); } catch {}
    try { active?.editor?.removeEventListener("input", active.onComposerInput, true); } catch {}
    try { active?.assistant?.host?.remove(); } catch {}
    if (bindingTimer) clearInterval(bindingTimer);
    clearTimeout(active?.acquireTimer);clearTimeout(active?.expiryTimer);
    active = null;
    try {
      document.removeEventListener("click",onDocumentClick,true);
      document.removeEventListener("pointerdown",captureActivation,true);
      document.removeEventListener("keydown",captureActivation,true);
      document.removeEventListener("focusin",refreshAssociation,true);
      document.removeEventListener("beforeinput",onBeforeInput,true);
      document.removeEventListener("visibilitychange",onVisibilityChange,true);
      window.removeEventListener("focus",onWindowFocus,true);
      window.removeEventListener("blur",onWindowBlur,true);
      window.removeEventListener("pageshow",onPageShow,true);
      window.removeEventListener("pagehide",onPageHide,true);
      window.removeEventListener("popstate",refreshAssociation);
    } catch {}
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
  function endSession(reason) {
    const current=active;
    if(!current)return;
    current.cancelled=true;
    current.observer?.disconnect();
    clearTimeout(current.acquireTimer);clearTimeout(current.expiryTimer);
    if(bindingTimer){clearInterval(bindingTimer);bindingTimer=null;}
    current.editor?.removeEventListener("input",current.onComposerInput,true);
    current.assistant?.host?.remove();
    if(!associationOnly)void safeSend({type:"REPLY_COPILOT_CANCEL",requestId:current.requestId});
    active=null;pendingActivation=null;
    if (reason === 'quiescent_recovery' || reason === 'reply_closed') { recoveryRequired=false; recoveryReason=null; }
    diagnostic('session_ended',{reason});
  }
  function quarantineActivation(post) {
    if (!post?.statusId || typeof post.sourceText !== 'string') return;
    const retained = { statusId: post.statusId, sourceText: post.sourceText, hasCapturedPhoto: Boolean(post.hasCapturedPhoto) };
    const withoutSame = quarantinedPosts.filter(item => item.statusId !== retained.statusId);
    withoutSame.unshift(retained);
    quarantinedPosts.splice(0, quarantinedPosts.length, ...withoutSame.slice(0, 8));
  }
  function rememberPost(post) {
    if (!post?.statusId || typeof post.sourceText !== 'string') return;
    const retained = { statusId: post.statusId, sourceText: post.sourceText, hasCapturedPhoto: Boolean(post.hasCapturedPhoto) };
    const withoutSame = recentPostContexts.filter(item => item.statusId !== retained.statusId);
    recentPostContexts.splice(0, recentPostContexts.length, retained, ...withoutSame.slice(0, 7));
  }
  function associationHistory() {
    const byStatus = new Map();
    for (const post of [...quarantinedPosts, ...recentPostContexts]) if (post?.statusId) byStatus.set(post.statusId, post);
    return [...byStatus.values()];
  }
  function recoverAfterQuiescence() {
    if (!recoveryRequired) return true;
    const baseline = api.composerAssociation.baseline(document);
    // X's persistent home composer is not a reply dialog. Keep all page nodes
    // in the next activation baseline, but only reply UI blocks recovery.
    if (baseline.baselineModalCount !== 0 || baseline.visibleReplyEditorCount !== 0) {
      diagnostic('recovery_waiting_for_quiescence',{visibleDialogs:baseline.baselineModalCount,visibleEditors:baseline.visibleEditorCount,visibleReplyEditors:baseline.visibleReplyEditorCount,reason:recoveryReason||'unknown'});
      return false;
    }
    if (active?.cancelled) endSession('quiescent_recovery');
    else { recoveryRequired=false; recoveryReason=null; }
    diagnostic('recovery_after_quiescence',{visibleDialogs:0,visibleEditors:baseline.visibleEditorCount,visibleReplyEditors:baseline.visibleReplyEditorCount});
    return true;
  }
  function rejectAssociation(reason) {
    const current=active;
    if (!current || current.cancelled) return;
    if (!current.editor) {
      recoveryRequired=true;
      recoveryReason=reason;
      quarantineActivation(current.post);
    }
    current.cancelled=true;current.initializing=false;
    current.association?.interrupt(reason);
    current.observer?.disconnect();
    clearTimeout(current.acquireTimer);clearTimeout(current.expiryTimer);
    current.editor?.removeEventListener("input",current.onComposerInput,true);
    if (!associationOnly) void safeSend({type:"REPLY_COPILOT_CANCEL",requestId:current.requestId});
    diagnosticPath(reason);
    // Lifecycle codes belong in diagnostics only. Never replace a successful
    // applied state with an internal teardown message.
    if (current.appliedText) return;
    const messages={
      competing_activation:"检测到另一个回复操作，已暂停本次操作。请关闭其他回复框后重新点击。",
      association_expired:"未能找到本次点击对应的回复框，请重新点击帖子下方的回复按钮。",
      operation_expired:"本次回复操作已结束，请重新点击回复按钮开始。",
      editor_replaced_or_closed:"回复框已关闭或发生变化，本次没有继续写入。",
      editor_removed:"回复框已关闭或发生变化，本次没有继续写入。",
      cancelled_by_user:"本次回复操作已取消。",
      user_input_before_binding:"检测到你已开始输入，已保留你的内容并停止自动填入。"
    };
    current.assistant?.setStatus(messages[reason]||"当前回复操作已停止，请重新点击回复按钮。 "+(recoveryRequired?"请先关闭当前回复框后重试。":""));
  }
  function matchedComposer(post) {
    if (!hasRuntimeContext() || active?.post!==post || active.cancelled) return {editor:null,matchedPost:false};
    const facts=api.composerAssociation.snapshot(document,post,active.initialUrl,location.href,performance.now(),associationHistory());
    const result=active.association.evaluate(facts);
    if (result.state==='rejected') {
      if(result.reason==='reply_context_unconfirmed')for(const candidate of facts.editors)diagnostic('reply_context_check',{articleCount:candidate.contextArticleCount,textPresent:candidate.contextTextPresent,textMatches:candidate.contextTextMatches,statusLinkPresent:Boolean(candidate.contextStatusId),editorFocused:candidate.focused});
      if (active?.editor && result.reason==='editor_replaced_or_closed' && facts.editors.length===0 && facts.visibleDialogCount===0) endSession('reply_closed');
      else rejectAssociation(result.reason);
    }
    return {editor:result.editor,matchedPost:result.state==='bound',reason:result.reason};
  }
  function begin(control, post, activation) {
    if (active?.post?.statusId === post.statusId && active.editor?.isConnected && !active.cancelled && (active.initializing || active.generating || active.assistant?.host?.isConnected)) return;
    if (!hasRuntimeContext()) return;
    if (active?.requestId) void safeSend({ type: "REPLY_COPILOT_CANCEL", requestId: active.requestId });
    if (bindingTimer) { clearInterval(bindingTimer); bindingTimer = null; }
    try { active?.editor?.removeEventListener("input", active.onComposerInput, true); } catch {}
    if (active?.observer) active.observer.disconnect();
    if (active?.assistant?.host?.isConnected) active.assistant.host.remove();
    clearTimeout(active?.acquireTimer);clearTimeout(active?.expiryTimer);
    const requestId = crypto.randomUUID();
    active = { requestId, post, control, editor: null, assistant: null, generated: false, cancelled: false, initializing: true, attemptedInput: new Set(), initialUrl:activation.initialUrl, diagnosticSession:++sessionSequence };
    // The request ID changes on regeneration; the editor session does not.
    const session = active;
    active.association=api.composerAssociation.create({trusted:true,statusId:post.statusId,requestId,now:activation.at,...activation.baseline});
    active.acquireTimer=setTimeout(()=>{
      if (active===session && !session.editor) { diagnostic('association_timeout_fired',{deadlineMs:9000}); rejectAssociation('association_expired'); }
    },9000);
    diagnostic('association_timeout_armed',{deadlineMs:9000});
    const locate=()=>{
      if (!hasRuntimeContext() || active!==session || session.cancelled) return;
      const found=matchedComposer(post);
      if (!found.editor) {
        if (['awaiting_editor_focus','awaiting_reply_context'].includes(found.reason) && session.lastAssociationWaitReason !== found.reason) {
          session.lastAssociationWaitReason = found.reason;
          const facts = api.composerAssociation.snapshot(document, post, session.initialUrl, location.href, performance.now(), associationHistory());
          diagnosticPath(found.reason, { visibleEditorCount: facts.editors.length, visibleDialogCount: facts.visibleDialogCount });
        }
        return;
      }
      if (active.editor) return; // Keep observing this same node; never rebind after replacement.
      clearTimeout(active.acquireTimer);
      active.editor=found.editor;active.matchedPost=true;
      diagnostic('association_bound',{reason:found.reason,mode:associationOnly?'association_only':'input_validation'});
      const current=active;
      current.initialComposerText=api.composerAdapter.hasContent(found.editor);
      current.userTouchedComposer=false;
      current.onComposerInput=()=>{if(!current.applyingReply)current.userTouchedComposer=true;};
      found.editor.addEventListener('input',current.onComposerInput,true);
      current.anchor=found.editor.parentElement||found.editor;
      diagnostic('editor_bound',{editorConnected:Boolean(found.editor.isConnected)});
      current.expiryTimer=setTimeout(()=>{if(active===current){diagnostic('operation_timeout_fired',{deadlineMs:60000});rejectAssociation('operation_expired');}},60000);
      diagnostic('operation_timeout_armed',{deadlineMs:60000});
      void prepareCurrent(requestId);
    };
    active.refreshAssociation=locate;
    active.observer=new MutationObserver(records=>{
      if(active!==session)return;
      if(active.assistant?.host && !active.assistant.host.isConnected && !active.assistantDetachedReported) {
        active.assistantDetachedReported=true;
        diagnostic('assistant_detached',{editorConnected:Boolean(active.editor?.isConnected),cancelled:Boolean(active.cancelled)});
      }
      if(active.editor && records?.some(record=>[...(record.removedNodes||[])].some(node=>node===active.editor||node.contains?.(active.editor)))) {
      const facts=api.composerAssociation.snapshot(document,active.post,active.initialUrl,location.href,performance.now(),quarantinedPosts);
        if(facts.editors.length===0&&facts.visibleDialogCount===0)endSession('reply_closed');else rejectAssociation('editor_removed');
        return;
      }
      locate();
    });
    active.observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['contenteditable','role','aria-hidden','hidden','data-testid','href']});
    diagnostic('association_waiting');
    locate();
  }
  async function prepareCurrent(requestId) {
    const current = active;
    if (associationOnly) {
      current.initializing=false;
      current.assistant=api.inlineAssistant.mount(current.anchor,()=>{},{});
      current.assistant.setStatus("关联验证通过：已绑定本次点击的唯一新回复框。当前模式不调用 AI、不填入文字。");
      diagnostic('association_only_ready');
      return;
    }
    try {
      const response = await safeSend({ type: "REPLY_COPILOT_GET_BEHAVIOR" });
      if (!contextAlive) return;
      if (!active || active.requestId !== requestId) return;
      if (!response?.ok) throw new Error("无法读取插件设置");
      current.preferences = response.preferences; current.initializing = false;
      diagnostic('assistant_mount_started',{enabled:Boolean(current.preferences.showFloatingWindow),anchorConnected:Boolean(current.anchor?.isConnected)});
      if (current.preferences.showFloatingWindow) current.assistant = api.inlineAssistant.mount(current.anchor, handleAction, { preferences: current.preferences });
      if (current.preferences.showFloatingWindow) diagnostic('assistant_mount_result',{connected:Boolean(current.assistant?.host?.isConnected)});
      const account = await refreshAccount(current);
      if (!active || active.requestId !== requestId) return;
      if (account?.status === "credits_available") {
        if (current.preferences.autoGenerateOnReply && current.preferences.showFloatingWindow) void generateActive(requestId);
        else current.assistant?.showReady(current.preferences.autoGenerateOnReply);
      } else diagnostic('account_not_ready');
    } catch { if (!contextAlive) return; diagnostic('settings_or_account_error'); current.initializing = false; current.assistant = api.inlineAssistant.mount(current.anchor, handleAction); current.assistant.setStatus("无法读取插件设置，请打开设置中心检查。"); }
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
      diagnostic('insert_context_changed',{visible:document.visibilityState==='visible',documentFocused:document.hasFocus(),editorFocused:document.activeElement===current.editor,connected:Boolean(current.editor?.isConnected),userTouched:Boolean(current.userTouchedComposer),empty:!api.composerAdapter.hasContent(current.editor),cancelled:Boolean(current.cancelled)});
      current.assistant?.setStatus("回复框已变化，已保留现有内容；可以复制建议后粘贴。");
      return;
    }
    current.applyingReply = true;
    const inserted = api.composerAdapter.insertOnce(current.editor, requestId, candidate, valid);
    current.applyingReply = false;
    if (!contextAlive || active !== current || current.requestId !== requestId || current.cancelled) return;
    if (!inserted) { diagnostic('insert_rejected'); current.assistant?.setStatus("X 回复框未接受自动填入，可复制建议后粘贴。"); return; }
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (!contextAlive || active !== current || current.requestId !== requestId || current.cancelled) return;
    if (current.userTouchedComposer) {
      current.assistant?.setStatus("回复框已被修改，请核对草稿；建议仍可复制。"); return;
    }
    if (!current.editor?.isConnected || api.composerAdapter.readText(current.editor) !== candidate.trim()) {
      nativeInputHealthy = false;
      diagnostic('insert_content_mismatch');
      current.assistant?.setStatus("X 回复框显示与候选不一致。请关闭这个草稿并刷新 X 后再试；当前建议可复制。");
      return;
    }
    current.appliedText = candidate.trim(); current.appliedStyle = style;
    diagnostic('insert_verified');
    current.assistant?.showApplied();
    record("applied", { style, reply: candidate });
  }
  async function generateActive(requestId) {
    if (associationOnly) {diagnostic('generation_blocked_association_only');return;}
    const current = active;
    if (!current || current.requestId !== requestId || current.cancelled || current.generating || current.generated) return;
    if (!['credits_available'].includes(current.accountStatus)) { void refreshAccount(current); return; }
    if (!current.editor?.isConnected || matchedComposer(current.post).editor!==current.editor) { current.assistant?.setStatus("无法准确匹配原帖和回复框，请打开侧栏继续。"); return; }
    current.generating = true; current.assistant?.showLoading();
    diagnostic('generation_started');
    try {
      const response = await safeSend({ type: "REPLY_COPILOT_GENERATE", requestId, sourceText: current.post.sourceText, sourceUrl: current.post.sourceUrl });
      if (!contextAlive) return;
      if (!active || active.requestId !== requestId || active.cancelled || !active.editor?.isConnected) return;
      if (!response?.ok) throw Object.assign(new Error(response?.error || "生成失败，请打开侧边栏重试。"), { code: response?.code || "" });
      current.generated = true; current.generating = false; current.result = response.result;
      diagnostic('generation_returned');
      current.retrySameRequestId = false;
      current.assistant?.setAccountLabel(response.accountLabel);
      const selectedStyle = current.preferences?.defaultReplyMode || response.result.defaultStyle || response.result.default_style || "natural";
      current.assistant?.showResult(response.result.replies, selectedStyle);
      void safeSend({ type: "REPLY_COPILOT_ACCOUNT_STATE" }).then((state) => { if (active === current && state?.ok) { current.accountStatus = state.status; current.assistant?.setAccountLabel(state.quota?.totalRemaining != null ? `剩余 ${state.quota.totalRemaining} 次` : response.accountLabel); } });
      if (response.result.recommendation === "skip") current.assistant?.setStatus(`建议先跳过：${response.result.reason}`);
      else await autoFillCurrent(current, requestId, selectedStyle);
    } catch (error) {
      current.generating = false;
      diagnostic('generation_failed',{reason:typeof error?.code==='string'?error.code.toLowerCase():'unknown_error'});
      current.retrySameRequestId = ["DELIVERY_CONFIRMATION_PENDING","NETWORK_ERROR","GENERATION_IN_PROGRESS","GENERATION_STATUS_UNKNOWN"].includes(error?.code);
      if (active?.requestId === requestId) { current.assistant?.setStatus(localizeError(error.message || "")); current.assistant?.showRetry(); }
    }
  }
  function handleAction(action, data) {
    if (!active || associationOnly) return;
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
    if (associationOnly || message?.type !== "REPLY_COPILOT_SETTINGS_CHANGED" || !active?.editor?.isConnected) return false;
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
  function captureActivation(event) {
    if (!event.isTrusted || !hasRuntimeContext()) return;
    trustedGestureCount++;
    if (event.type==='keydown' && !['Enter',' '].includes(event.key)) {
      if(event.key==='Escape')rejectAssociation('cancelled_by_user');
      return;
    }
    const control=api.replyDetector.findReplyControl(event.target);
    if (recoveryRequired) recoverAfterQuiescence();
    // X's modal contains its own Reply button and "Replying to" controls.
    // They are not a fresh activation on a timeline post.
    if (control?.closest('[role="dialog"]')) return;
    if(control){replyControlPointerCount++;diagnostic('reply_control_pointerdown',{eventKind:event.type});}
    // X can remove/hide its modal before our MutationObserver callback runs.
    // Reconcile the already-bound node synchronously before classifying a new
    // trusted gesture as competition. Never reset an ambiguous unbound session.
    if (active?.editor && !active.cancelled) refreshAssociation();
    if (control) {
      const facts=active?.editor?api.composerAssociation.snapshot(document,active.post,active.initialUrl,location.href,performance.now(),associationHistory()):null;
      diagnostic('activation_state',{hasSession:Boolean(active),cancelled:Boolean(active?.cancelled),hasEditor:Boolean(active?.editor),editorConnected:Boolean(active?.editor?.isConnected),visibleEditors:facts?.editors.length??null,recoveryRequired});
    }
    if (recoveryRequired && control) {pendingActivation=null;diagnosticPath('awaiting_quiescent_page');return;}
    if (!control || control.closest('[data-zane-reply-copilot]')) {
      pendingActivation=null;
      if(active&&!active.cancelled&&!active.editor&&!active.assistant?.host?.contains(event.target)) rejectAssociation('competing_activation');
      return;
    }
    if (active&&!active.cancelled) {
      recoveryRequired=true;
      recoveryReason='competing_activation';
      if (!active.editor) quarantineActivation(active.post);
      rejectAssociation('competing_activation');
      pendingActivation={control,blocked:true};return;
    }
    const post=api.postExtractor.extractPost(control.closest('article'));
    if (!post.ok) {pendingActivation=null;diagnosticPath('source_unverified',{extractorReason:post.reason||'unknown',statusLinkCount:post.statusLinkCount||0,textNodeCount:post.textNodeCount||0,...postKindFlags(post)});return;}
    diagnostic('source_verified',{statusIdentityVerified:true,...postKindFlags(post)});
    pendingActivation={control,post:Object.freeze(api.composerAssociation.capturePost(post)),baseline:api.composerAssociation.baseline(document),at:performance.now(),initialUrl:location.href};
  }
  function onDocumentClick(event) {
    if (!hasRuntimeContext() || !event.isTrusted) return;
    const control=api.replyDetector.findReplyControl(event.target);
    if (control?.closest('[role="dialog"]')) return;
    if (!control || control.closest('[data-zane-reply-copilot]')) return;
    replyControlClickCount++;
    const activation=pendingActivation;pendingActivation=null;
    const elapsed=activation?performance.now()-activation.at:Infinity;
    if (!activation || activation.blocked || elapsed>1500) {
      diagnosticPath('activation_not_captured',{hadPointerActivation:Boolean(activation),ageMs:Number.isFinite(elapsed)?Math.max(0,Math.round(elapsed)):null,reason:!activation?'pointerdown_missing':activation.blocked?'pointerdown_blocked':'pointerdown_expired'});
      if (recoveryRequired) {diagnosticPath('awaiting_quiescent_page');return;}
      if (active&&!active.cancelled) return;
      const post=api.postExtractor.extractPost(control.closest('article'));
      if (!post.ok) {diagnosticPath('source_unverified',{extractorReason:post.reason||'unknown',statusLinkCount:post.statusLinkCount||0,textNodeCount:post.textNodeCount||0,...postKindFlags(post)});return;}
      const baseline=api.composerAssociation.baseline(document);
      if (baseline.baselineModalCount || baseline.visibleReplyEditorCount) {diagnosticPath('preexisting_reply_ui',{visibleDialogs:baseline.baselineModalCount,visibleReplyEditors:baseline.visibleReplyEditorCount});return;}
      diagnosticPath('trusted_click_recovered_activation',{statusIdentityVerified:true});
      diagnostic('source_verified',{statusIdentityVerified:true,...postKindFlags(post)});
      const captured=api.composerAssociation.capturePost(post);rememberPost(captured);
      begin(control,captured,{initialUrl:location.href,at:performance.now(),baseline});
      return;
    }
    if (activation.control!==control) {
      const clickedArticle=control.closest('article');
      const live=api.postExtractor.extractPost(clickedArticle);
      if (activation.post?.article!==clickedArticle || !live.ok || live.statusId!==activation.post.statusId || live.sourceText!==activation.post.sourceText) {
        diagnosticPath('activation_not_captured',{hadPointerActivation:true,ageMs:Math.max(0,Math.round(elapsed)),reason:'control_or_source_changed'});return;
      }
      diagnosticPath('activation_control_replaced',{statusIdentityVerified:true});
    }
    const live=api.postExtractor.extractPost(control.closest('article'));
    if (!live.ok || live.statusId!==activation.post.statusId || live.sourceText!==activation.post.sourceText) {
      diagnosticPath('source_changed');return;
    }
    rememberPost(activation.post);
    diagnostic('reply_clicked');
    begin(control,activation.post,activation);
  }
  function refreshAssociation(){active?.refreshAssociation?.();}
  function onBeforeInput(event) {
    if(event.isTrusted && active && !active.cancelled && !active.editor) rejectAssociation('user_input_before_binding');
  }
  function onVisibilityChange(){diagnostic('visibility_changed',{visible:document.visibilityState==='visible'});}
  function onWindowFocus(){diagnostic('window_focus',{focused:true});}
  function onWindowBlur(){diagnostic('window_focus',{focused:false});}
  function onPageShow(){diagnostic('page_lifecycle',{state:'pageshow'});}
  function onPageHide(){diagnostic('page_lifecycle',{state:'pagehide'});}
  document.addEventListener('pointerdown',captureActivation,true);
  document.addEventListener('keydown',captureActivation,true);
  document.addEventListener('focusin',refreshAssociation,true);
  document.addEventListener('beforeinput',onBeforeInput,true);
  document.addEventListener('visibilitychange',onVisibilityChange,true);
  window.addEventListener('focus',onWindowFocus,true);
  window.addEventListener('blur',onWindowBlur,true);
  window.addEventListener('pageshow',onPageShow,true);
  window.addEventListener('pagehide',onPageHide,true);
  window.addEventListener('popstate',refreshAssociation);
  document.addEventListener('click',onDocumentClick,true);
  diagnostic('content_ready',{mode:associationOnly?'association_only':'input_validation',build:'staging-delivery-recovery-20261028-3'});
})();
