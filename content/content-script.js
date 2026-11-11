(() => {
  const api = globalThis.ZaneReplyCopilotContent;
  let active = null;
  let performanceEnabled = false;
  const performanceApi = globalThis.ReplyCopilotPerformance;
  const performanceSamples = performanceApi?.createCollector();
  // Available in the extension's isolated content-script console, not page JS.
  globalThis.replyCopilotPerformanceReport = () => performanceSamples?.report();
  globalThis.clearReplyCopilotPerformance = () => performanceSamples?.clear();
  function completeTrace(current, outcome) {
    if (!current?.trace?.enabled || !performanceEnabled || current.performanceReported) return;
    current.performanceReported = true;
    const sample = current.trace.snapshot(outcome);
    performanceSamples?.record(sample);
    void safeSend({type:"REPLY_COPILOT_PERFORMANCE_SAMPLE",sample});
  }
  let contextAlive = true;
  let nativeInputHealthy = true;
  let bindingTimer = null;
  let settingsRevision = 0;
  let pendingActivation = null;
  // After a completed draft's native editor closes, keep only the floating UI
  // available for review. The old editor, request and association are retired
  // immediately; this copy-only surface cannot generate or insert again.
  const POST_REPLY_LINGER_MS = 30_000; // Inactivity timeout, reset by interactions.
  let lingeringHost = null;
  let lingeringSession = null;
  let lingeringTimer = null;
  function clearLingeringHost() {
    if (lingeringTimer !== null) clearTimeout(lingeringTimer);
    lingeringTimer = null;
    lingeringHost?.remove();
    lingeringHost = null;
    lingeringSession = null;
  }
  function resetLingeringTimer() {
    if (lingeringTimer !== null) clearTimeout(lingeringTimer);
    const host = lingeringHost;
    lingeringTimer = host ? setTimeout(() => {
      if (lingeringHost === host) clearLingeringHost();
    }, POST_REPLY_LINGER_MS) : null;
  }
  // Local-only, text-free troubleshooting for disappearing reply windows.
  // No post text, URL, account data or telemetry is captured.
  const associationEvents=[];
  function traceAssociation(stage,reason){
    associationEvents.push({stage,reason,at:Math.round(performance.now())});
    if(associationEvents.length>20)associationEvents.shift();
  }
  globalThis.replyCopilotAssociationReport=()=>associationEvents.slice();
  let recoveryRequired = false;
  let recoveryReason = null;
  const quarantinedPosts = [];
  const isX = /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//.test(location.href);
  if (!isX) return;
  const installKey = Symbol.for("zane-reply-copilot.content-script-installed");
  if (globalThis[installKey]) return;
  globalThis[installKey] = true;
  let momentumEntry;
  let stagingGateNext=null;
  function stopInvalidContext() {
    if (!contextAlive) return;
    contextAlive = false;
    clearLingeringHost();
    momentumEntry?.remove();
    try { active?.observer?.disconnect(); } catch {}
    try { active?.editor?.removeEventListener("input", active.onComposerInput, true); } catch {}
    try { active?.assistant?.host?.remove(); } catch {}
    if (bindingTimer) clearInterval(bindingTimer);
    clearTimeout(active?.acquireTimer);clearTimeout(active?.expiryTimer);clearTimeout(active?.closeCheckTimer);
    active = null;
    try {
      document.removeEventListener("click",onDocumentClick,true);
      document.removeEventListener("pointerdown",captureActivation,true);
      document.removeEventListener("keydown",captureActivation,true);
      document.removeEventListener("focusin",refreshAssociation,true);
      document.removeEventListener("beforeinput",onBeforeInput,true);
      window.removeEventListener("popstate",refreshAssociation);
    } catch {}
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch {}
    try { chrome.storage.onChanged.removeListener(onMomentumPreference); } catch {}
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
    completeTrace(current,"cancelled");
    current.cancelled=true;
    current.observer?.disconnect();
    clearTimeout(current.acquireTimer);clearTimeout(current.expiryTimer);clearTimeout(current.closeCheckTimer);
    traceAssociation('closed',reason);
    if(bindingTimer){clearInterval(bindingTimer);bindingTimer=null;}
    current.editor?.removeEventListener("input",current.onComposerInput,true);
    clearLingeringHost();
    const host = current.assistant?.host;
    if (reason === 'reply_closed' && current.appliedText && host?.isConnected) {
      // The old native editor and request are already cancelled. Preserve a
      // fully interactive copy-only panel, never a live composer binding.
      current.assistant?.enterPostReplyMode?.();
      host.style.pointerEvents = '';
      host.style.opacity = '';
      lingeringHost = host;
      lingeringSession = {
        assistant: current.assistant,
        requestId: current.requestId,
        sourceText: current.post?.sourceText,
        sourceUrl: current.post?.sourceUrl,
        autoGenerateOnReply: current.preferences?.autoGenerateOnReply,
      };
      resetLingeringTimer();
    } else host?.remove();
    void safeSend({type:"REPLY_COPILOT_CANCEL",requestId:current.requestId});
    active=null;pendingActivation=null;
    if (reason === 'quiescent_recovery' || reason === 'reply_closed') { recoveryRequired=false; recoveryReason=null; }
  }
  function quarantineActivation(post) {
    if (!post?.statusId || typeof post.sourceText !== 'string') return;
    const retained = { statusId: post.statusId, sourceText: post.sourceText, hasCapturedPhoto: Boolean(post.hasCapturedPhoto) };
    const withoutSame = quarantinedPosts.filter(item => item.statusId !== retained.statusId);
    withoutSame.unshift(retained);
    quarantinedPosts.splice(0, quarantinedPosts.length, ...withoutSame.slice(0, 8));
  }
  function recoverAfterQuiescence() {
    if (!recoveryRequired) return true;
    const baseline = api.composerAssociation.baseline(document);
    // X's persistent home composer is not a reply dialog. Keep all page nodes
    // in the next activation baseline, but only reply UI blocks recovery.
    if (baseline.baselineModalCount !== 0 || baseline.visibleReplyEditorCount !== 0) {
      return false;
    }
    if (active?.cancelled) endSession('quiescent_recovery');
    else { recoveryRequired=false; recoveryReason=null; }
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
    completeTrace(current,"cancelled");
    traceAssociation('rejected',reason);
    current.cancelled=true;current.initializing=false;
    current.association?.interrupt(reason);
    current.observer?.disconnect();
    clearTimeout(current.acquireTimer);clearTimeout(current.expiryTimer);clearTimeout(current.closeCheckTimer);
    current.editor?.removeEventListener("input",current.onComposerInput,true);
    void safeSend({type:"REPLY_COPILOT_CANCEL",requestId:current.requestId});
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
    const facts=api.composerAssociation.snapshot(document,post,active.initialUrl,location.href,performance.now(),quarantinedPosts);
    const result=active.association.evaluate(facts);
    if (result.state==='rejected') {
      if (active?.editor && result.reason==='editor_replaced_or_closed' && facts.editors.length===0 && facts.visibleDialogCount===0) endSession('reply_closed');
      else rejectAssociation(result.reason);
    }
    return {editor:result.editor,matchedPost:result.state==='bound',reason:result.reason};
  }
  function begin(control, post, activation) {
    if (active?.post?.statusId === post.statusId && active.editor?.isConnected && !active.cancelled && (active.initializing || active.generating || active.assistant?.host?.isConnected)) return;
    if (!hasRuntimeContext()) return;
    clearLingeringHost(); // A new reply always starts with a clean visual surface.
    if (active?.requestId) void safeSend({ type: "REPLY_COPILOT_CANCEL", requestId: active.requestId });
    if (bindingTimer) { clearInterval(bindingTimer); bindingTimer = null; }
    try { active?.editor?.removeEventListener("input", active.onComposerInput, true); } catch {}
    if (active?.observer) active.observer.disconnect();
    if (active?.assistant?.host?.isConnected) active.assistant.host.remove();
    clearTimeout(active?.acquireTimer);clearTimeout(active?.expiryTimer);clearTimeout(active?.closeCheckTimer);
    const requestId = crypto.randomUUID();
    active = { requestId, post, control, editor: null, assistant: null, generated: false, cancelled: false, initializing: true, attemptedInput: new Set(), initialUrl:activation.initialUrl };
    traceAssociation('activated','trusted_reply_click');
    // The request ID changes on regeneration; the editor session does not.
    const session = active;
    active.trace = activation.trace;
    active.association=api.composerAssociation.create({trusted:true,statusId:post.statusId,requestId,now:activation.at,...activation.baseline});
    active.acquireTimer=setTimeout(()=>{
      if (active===session && !session.editor) { rejectAssociation('association_expired'); }
    },9000);
    const locate=()=>{
      if (!hasRuntimeContext() || active!==session || session.cancelled) return;
      const found=matchedComposer(post);
      if (!found.editor) return;
      if (active.editor) {
        if (active.editor!==found.editor) {
          // Preserve the verified session through a React media/quote remount.
          // Never repeat generation or silently replay an inserted draft.
          const current=active;
          current.editor.removeEventListener('input',current.onComposerInput,true);
          current.editor=found.editor;
          current.anchor=found.editor.parentElement||found.editor;
          found.editor.addEventListener('input',current.onComposerInput,true);
          clearTimeout(current.closeCheckTimer);current.closeCheckTimer=null;
          traceAssociation('rebound','verified_editor_remount');
          if(current.userTouchedComposer||current.appliedText){
            current.userTouchedComposer=true;
            current.assistant?.setStatus('回复编辑框已更新；原有草稿不会自动重填，可复制建议后自行确认。');
          }
        } else if (active.closeCheckTimer) {
          clearTimeout(active.closeCheckTimer);active.closeCheckTimer=null;
        }
        return;
      }
      clearTimeout(active.acquireTimer);
      active.editor=found.editor;active.matchedPost=true;
      active.trace?.mark("editor_bound");
      const current=active;
      current.initialComposerText=api.composerAdapter.hasContent(found.editor);
      current.userTouchedComposer=false;
      current.onComposerInput=()=>{if(!current.applyingReply)current.userTouchedComposer=true;};
      found.editor.addEventListener('input',current.onComposerInput,true);
      current.anchor=found.editor.parentElement||found.editor;
      current.expiryTimer=setTimeout(()=>{if(active===current){rejectAssociation('operation_expired');}},60000);
      void prepareCurrent(requestId);
    };
    active.refreshAssociation=locate;
    active.observer=new MutationObserver(records=>{
      if(active!==session)return;
      if(active.assistant?.host && !active.assistant.host.isConnected && !active.assistantDetachedReported) {
        active.assistantDetachedReported=true;
      }
      const removedEditor=Boolean(active.editor && (active.editor.isConnected===false || records?.some(record=>
        [...(record.removedNodes||[])].some(node=>node===active.editor||node.contains?.(active.editor)))));
      if(removedEditor) {
        // A single observer tick with no visible reply UI is not proof the
        // user closed it: X can detach and remount it around rich media.
        if(!session.closeCheckTimer) session.closeCheckTimer=setTimeout(()=>{
          session.closeCheckTimer=null;
          if(active!==session||session.cancelled)return;
          const facts=api.composerAssociation.snapshot(document,post,session.initialUrl,location.href,performance.now(),quarantinedPosts);
          if(facts.editors.length===0&&facts.visibleDialogCount===0)endSession('reply_closed');
          else locate();
        },350);
      }
      locate();
    });
    active.observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['contenteditable','role','aria-hidden','hidden','data-testid','href']});
    locate();
  }
  async function prepareCurrent(requestId) {
    const current = active;
    try {
      // Independent reads start together; both remain mandatory before AI.
      const precheckStart = performance.now();
      const accountPending = safeSend({ type: "REPLY_COPILOT_ACCOUNT_STATE" });
      const response = await safeSend({ type: "REPLY_COPILOT_GET_BEHAVIOR" });
      if (!contextAlive) return;
      if (active !== current || current.requestId !== requestId || current.cancelled) return;
      if (!response?.ok) throw new Error("无法读取插件设置");
      current.preferences = response.preferences; current.initializing = false;
      if (current.preferences.showFloatingWindow) current.assistant = api.inlineAssistant.mount(current.anchor, handleAction, { preferences: current.preferences });
      const account = await refreshAccount(current, accountPending);
      if (active !== current || current.requestId !== requestId || current.cancelled) return;
      current.trace?.addDurations({precheck:performance.now()-precheckStart});
      current.trace?.mark("precheck_complete");
      if (account?.status === "credits_available") {
        if(stagingGateNext){
          const sample=stagingGateNext;stagingGateNext=null;
          current.stagingMomentumGate=true;
          current.momentumGate={id:`staging:${sample.stage}`,stage:sample.stage,lease:`staging-${crypto.randomUUID()}`};
          current.momentumPolicy=sample;
          if(!current.assistant)current.assistant=api.inlineAssistant.mount(current.anchor,handleAction,{preferences:current.preferences});
          current.assistant?.showMomentumGate?.(current.momentumGate,current.momentumPolicy);
          current.trace?.mark('momentum_gate_shown');
          return;
        }
        if(account.momentumGatePending===true){
          const gate=await safeSend({type:'REPLY_COPILOT_MOMENTUM',gate:true});
          if(active!==current||current.requestId!==requestId||current.cancelled)return;
          if(gate?.reminder){
            current.momentumGate=gate.reminder;
            current.momentumPolicy=gate.policy;
            if(!current.assistant)current.assistant=api.inlineAssistant.mount(current.anchor,handleAction,{preferences:current.preferences});
            current.assistant?.showMomentumGate?.(gate.reminder,current.momentumPolicy);
            return;
          }
        }
        if (current.preferences.autoGenerateOnReply && current.preferences.showFloatingWindow) void generateActive(requestId);
        else { current.assistant?.showReady(current.preferences.autoGenerateOnReply); completeTrace(current,"incomplete"); }
      } else completeTrace(current,"incomplete");
    } catch { if (!contextAlive || active !== current || current.cancelled) return; completeTrace(current,"failed"); current.initializing = false; current.assistant = api.inlineAssistant.mount(current.anchor, handleAction); current.assistant.setStatus("无法读取插件设置，请打开设置中心检查。"); }
  }
  async function refreshAccount(current, pendingResponse = null) {
    const previousStatus = current.accountStatus;
    const wasPending = current.pendingBinding;
    const response = await (pendingResponse || safeSend({ type: "REPLY_COPILOT_ACCOUNT_STATE" }));
    if (active !== current) return response;
    current.accountStatus = response?.ok ? response.status : "auth_unavailable";
    current.pendingBinding = Boolean(response?.pending);
    refreshMomentum(current,{surface:true});
    current.assistant?.showAccount(current.accountStatus, response?.quota, response?.pending);
    if(response?.recoveryRequired){current.assistant?.setStatus('上一条生成未完成，额度仍在预占。可以恢复或放弃后继续。');current.assistant?.showRecovery?.();}
    if ((wasPending || previousStatus !== "credits_available") && !response?.pending && current.accountStatus === "credits_available" && !current.result && !current.generating) current.assistant?.showReady(current.preferences?.autoGenerateOnReply);
    if (response?.pending && !bindingTimer) bindingTimer = setInterval(() => void refreshAccount(current), 3500);
    if (!response?.pending && bindingTimer) { clearInterval(bindingTimer); bindingTimer = null; }
    return response;
  }
  function remountAssistant(current, preferences) {
    current.assistant?.close(); current.assistant = null;
    if ((!preferences.showFloatingWindow&&!current.momentumGate) || current.dismissed || !current.anchor?.isConnected) return;
    current.preferences = preferences;
    current.assistant = api.inlineAssistant.mount(current.anchor, handleAction, { preferences });
    if (current.appliedText) { current.assistant.showResult(current.result.replies, current.appliedStyle || "natural"); current.assistant.showApplied(); }
    else if (current.result) current.assistant.showResult(current.result.replies, preferences.defaultReplyMode || current.result.defaultStyle || "natural");
    else if (current.generating) current.assistant.showLoading();
    else if(current.momentumGate)current.assistant.showMomentumGate(current.momentumGate,current.momentumPolicy);
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
    current.trace?.mark("insert_started");
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
    current.trace?.mark("editor_verified");
    completeTrace(current,"success");
    current.appliedText = candidate.trim(); current.appliedStyle = style;
    current.assistant?.showApplied();
    record("applied", { style, reply: candidate });
  }
  function refreshMomentum(current, options = {}) {
    if (current.momentumRequestPending) {
      current.momentumQueued = {...current.momentumQueued, ...options};
      return;
    }
    current.momentumRequestPending = true;
    const revision = (current.momentumRevision || 0) + 1;
    current.momentumRevision = revision;
    function render(value) {
      if (current.momentumRevision === revision && contextAlive && active === current && !current.cancelled) {
        current.assistant?.setMomentum?.(value, options);
      }
    }
    const message = {type:'REPLY_COPILOT_MOMENTUM', ...options};
    const request = globalThis.ReplyCopilotMomentumPresenter?.request;
    void (request ? request(safeSend, message) : safeSend(message))
      .then(response => {
        render(response);
        if (response?.timeout && typeof options.enabled === 'boolean') current.momentumQueued = {...current.momentumQueued};
      }, () => render({ok:false, status:'unverified'}))
      .catch(() => {})
      .finally(() => {
        current.momentumRequestPending = false;
        const next = current.momentumQueued;
        current.momentumQueued = null;
        if (next && contextAlive && active === current && !current.cancelled) refreshMomentum(current, next);
      });
  }
  async function generateActive(requestId) {
    const current = active;
    if (!current || current.requestId !== requestId || current.cancelled || current.generating || current.generated || current.momentumGate) return;
    if (!['credits_available'].includes(current.accountStatus)) { void refreshAccount(current); return; }
    if (!current.editor?.isConnected || matchedComposer(current.post).editor!==current.editor) { current.assistant?.setStatus("无法准确匹配原帖和回复框，请打开侧栏继续。"); return; }
    current.generating = true; current.assistant?.showLoading();
    try {
      current.trace?.mark("background_dispatch");
      const response = await safeSend({ type: "REPLY_COPILOT_GENERATE", requestId, sourceText: current.post.sourceText, sourceUrl: current.post.sourceUrl, performanceEnabled: Boolean(current.trace?.enabled) });
      current.trace?.mark("background_return");
      current.trace?.addDurations(response?.performance?.durations);
      if (!contextAlive) return;
      if (!active || active.requestId !== requestId || active.cancelled || !active.editor?.isConnected) return;
      if (!response?.ok) throw Object.assign(new Error(response?.error || "生成失败，请打开侧边栏重试。"), { code: response?.code || "" });
      current.generated = true; current.generating = false; current.result = response.result;
      current.retrySameRequestId = false;
      current.assistant?.setAccountLabel(response.accountLabel);
      const selectedStyle = current.preferences?.defaultReplyMode || response.result.defaultStyle || response.result.default_style || "natural";
      current.assistant?.showResult(response.result.replies, selectedStyle);
      current.trace?.mark("candidates_shown");
      void safeSend({ type: "REPLY_COPILOT_ACCOUNT_STATE" }).then((state) => { if (active === current && state?.ok) { current.accountStatus = state.status; current.assistant?.setAccountLabel(state.quota?.totalRemaining != null ? `剩余 ${state.quota.totalRemaining} 次` : response.accountLabel); } });
      if (response.result.recommendation === "skip") current.assistant?.setStatus(`建议先跳过：${response.result.reason}`);
      else await autoFillCurrent(current, requestId, selectedStyle);
      // A protected draft, skip recommendation or unsafe focus is not a
      // successful automatic insertion. Count it separately, without text.
      completeTrace(current,"incomplete");
      refreshMomentum(current,{arm:true});
    } catch (error) {
      completeTrace(current,"failed");
      current.generating = false;
      current.retrySameRequestId = ["DELIVERY_CONFIRMATION_PENDING","NETWORK_ERROR","GENERATION_IN_PROGRESS","GENERATION_STATUS_UNKNOWN","GENERATION_RECOVERY_REQUIRED"].includes(error?.code);
      if (active?.requestId === requestId) { current.assistant?.setStatus(localizeError(error.message || "")); current.assistant?.showRetry(); if(current.retrySameRequestId)current.assistant?.showRecovery?.(); }
    }
  }
  function handleLingeringAction(action, data) {
    const session = lingeringSession;
    if (!session || (action !== 'dismiss' && !lingeringHost?.isConnected)) return;
    if (action === 'dismiss') { clearLingeringHost(); return; }
    if (!hasRuntimeContext()) return;
    resetLingeringTimer();
    if (action === 'linger_interaction') return;
    if (action === 'settings') { void safeSend({type:'REPLY_COPILOT_OPEN_SETTINGS'}); return; }
    if (action === 'sidepanel' || action === 'momentum_details') {
      if (session.panelOpenPending) return;
      session.panelOpenPending = true;
      const payload = action === 'sidepanel'
        ? {sourceText:session.sourceText,sourceUrl:session.sourceUrl} : {momentumDetails:true};
      void safeSend({type:'REPLY_COPILOT_OPEN_SIDEPANEL',...payload}).then(response => {
        if (lingeringSession === session) session.assistant?.showPanelError?.(response?.ok ? '' : response?.error || '无法打开侧边栏，请重试。');
      }).finally(() => {session.panelOpenPending = false;});
      return;
    }
    if (action === 'position_changed') {
      void safeSend({type:'REPLY_COPILOT_SET_FLOATING_POSITION',left:data.left,top:data.top}); return;
    }
    if (action === 'toggle_auto_generate' && typeof data.enabled === 'boolean') {
      const previous = session.autoGenerateOnReply;
      session.autoGenerateOnReply = data.enabled;
      void safeSend({type:'REPLY_COPILOT_SET_AUTO_GENERATE',enabled:data.enabled}).then(response => {
        if (!response?.ok && lingeringSession === session) {
          session.autoGenerateOnReply = previous;
          session.assistant?.setAutoGenerate?.(previous);
          session.assistant?.setStatus?.('设置保存失败，请重试。');
        }
      });
      return;
    }
    if (action === 'selected' || action === 'copied') {
      void safeSend({type:'REPLY_COPILOT_HISTORY',requestId:session.requestId,
        sourceText:session.sourceText,sourceUrl:session.sourceUrl,event:action,style:data.style,reply:data.reply});
      return;
    }
    if (action === 'feedback') {
      void safeSend({type:'REPLY_COPILOT_FEEDBACK',requestId:session.requestId,...data}); return;
    }
    if (action === 'momentum_original') { void safeSend({type:'REPLY_COPILOT_OPEN_ORIGINAL'}); return; }
    // An expired native reply editor must never be reused for generate,
    // regeneration, recovery, or automatic insertion (even after a click).
    session.assistant?.setStatus?.('本次回复窗口已关闭。请点击帖子下方的回复按钮开始新的回复。');
  }
  function handleAction(action, data) {
    if (!active) { handleLingeringAction(action, data); return; }
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
    if (action === "settings") { void safeSend({ type: "REPLY_COPILOT_OPEN_SETTINGS" }); return; }
    if (action === "sidepanel" || action === "momentum_details") {
      if (current.panelOpenPending) return;
      current.panelOpenPending = true;
      const payload = action === "sidepanel"
        ? {sourceText:current.post?.sourceText,sourceUrl:current.post?.sourceUrl} : {momentumDetails:true};
      void safeSend({type:"REPLY_COPILOT_OPEN_SIDEPANEL",...payload}).then(response => {
        if (active === current && !current.cancelled) {
          current.assistant?.showPanelError?.(response?.ok ? "" : response?.error || "无法打开侧边栏，请重试。");
        }
      }).finally(() => { current.panelOpenPending = false; });
      return;
    }
    if(action==='momentum_refresh'){refreshMomentum(current,{refresh:true});return;}
    if(action==='momentum_toggle'){refreshMomentum(current,{enabled:data.enabled,scope:data.scope});return;}
    if(action==='momentum_presented'){void safeSend({type:'REPLY_COPILOT_MOMENTUM',presented:data});return;}
    if(action==='momentum_dnd'){refreshMomentum(current,{dnd:true});return;}
    if(action==='momentum_original'){void safeSend({type:'REPLY_COPILOT_OPEN_ORIGINAL'});return;}
    if(action==='momentum_gate_dismiss'||action==='momentum_gate_dnd'){
      if(current.gateResolving||!current.momentumGate||current.momentumGate.id!==data.id||current.momentumGate.lease!==data.lease)return;
      current.gateResolving=true;
      if(current.stagingMomentumGate){
        current.gateResolving=false;current.stagingMomentumGate=false;current.momentumGate=null;
        current.assistant?.resolveMomentumGate?.();
        current.assistant?.setStatus('Staging 模拟已解除；本次未调用 AI，也未填入或修改真实提醒记录。');
        completeTrace(current,'incomplete');return;
      }
      void safeSend({type:'REPLY_COPILOT_MOMENTUM',presented:{id:data.id,lease:data.lease},dnd:action==='momentum_gate_dnd'}).then(response=>{
        if(active!==current||current.cancelled)return;
        if(!response?.confirmed){current.assistant?.momentumGateError?.('暂时无法保存选择，请保持页面开启后重试。');return;}
        current.momentumGate=null;current.assistant?.resolveMomentumGate?.();
        if(!current.editor?.isConnected||matchedComposer(current.post).editor!==current.editor)return;
        if(current.userTouchedComposer||api.composerAdapter.hasContent(current.editor)){
          current.assistant?.setStatus('已保留你正在编辑的草稿，本次不会自动填入。');return;
        }
        if(current.preferences?.autoGenerateOnReply&&current.accountStatus==='credits_available')void generateActive(current.requestId);
        else current.assistant?.showReady(current.preferences?.autoGenerateOnReply);
      }).catch(()=>{if(active===current)current.assistant?.momentumGateError?.('暂时无法保存选择，请重试。');}).finally(()=>{current.gateResolving=false;});
      return;
    }
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
    if(action==='recover-generation'||action==='abandon-generation'){
      if(current.recovering)return;
      current.recovering=true;current.assistant?.showLoading('正在检查上一条生成…');
      void safeSend({type:'REPLY_COPILOT_RECOVER_GENERATION',abandon:action==='abandon-generation'}).then(async response=>{
        if(active!==current||current.cancelled)return;
        if(!response?.ok)throw Error(response?.error||'恢复未完成，请稍后再试。');
        await refreshAccount(current);
        if(active!==current||current.cancelled)return;
        current.generating=false;current.generated=false;current.retrySameRequestId=false;
        if(response.state==='ready'&&response.requestId!==current.requestId){
          // A recovered result for a different post is copy-only. Never insert it
          // into the currently associated editor or mistake it for this request.
          current.assistant?.showResult(response.result.replies,response.result.defaultStyle||'natural');
          refreshMomentum(current,{arm:true});
          current.assistant?.setStatus('上一条回复已恢复，仅供复制；当前帖子可点击重试生成。');current.assistant?.showRetry();return;
        }
        if(response.state!=='ready')current.requestId=crypto.randomUUID();
        void generateActive(current.requestId);
      }).catch(error=>{if(active===current){current.assistant?.setStatus(error.message||'暂时无法恢复，请重试。');current.assistant?.showRecovery?.();}}).finally(()=>{current.recovering=false;});
      return;
    }
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
  globalThis.ReplyCopilotStagingSurface?.register({
    getAssistant(){const assistant=active?.assistant;return active?.editor?.isConnected&&!active.cancelled&&assistant?.host?.isConnected?assistant:null;},
    armNextReply(sample){if(!sample||![1,2,3].includes(sample.stage)||typeof sample.titleZh!=='string'||typeof sample.bodyZh!=='string')return false;stagingGateNext=Object.freeze({stage:sample.stage,titleZh:sample.titleZh,bodyZh:sample.bodyZh});return true;}
  });
  function onRuntimeMessage(message) {
    if (!hasRuntimeContext()) return false;
    if (message?.type === "REPLY_COPILOT_PERFORMANCE_STATE") { performanceEnabled=message.enabled===true; return false; }
    if(message?.type === "REPLY_COPILOT_MOMENTUM_CHANGED"){if(active)refreshMomentum(active);momentumEntry?.sync();return false;}
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
  function captureActivation(event) {
    if (!event.isTrusted || !hasRuntimeContext()) return;
    if (event.type==='keydown' && !['Enter',' '].includes(event.key)) {
      if(event.key==='Escape')rejectAssociation('cancelled_by_user');
      return;
    }
    const control=api.replyDetector.findReplyControl(event.target);
    if (recoveryRequired) recoverAfterQuiescence();
    // X's composer has its own Reply/submit controls, but a media viewer
    // may ALSO be a dialog containing a genuine post Reply button.
    // Only suppress dialog controls that are not inside a post article.
    if (control?.closest('[role="dialog"]') && !control.closest('article')) return;
    // X can remove/hide its modal before our MutationObserver callback runs.
    // Reconcile the already-bound node synchronously before classifying a new
    // trusted gesture as competition. Never reset an ambiguous unbound session.
    if (active?.editor && !active.cancelled) {
      // A new trusted Reply click is an explicit switch. If the old dialog
      // has actually disappeared, release it synchronously instead of
      // treating the new click as competition during the 350ms close grace.
      // A visible editor/dialog still blocks concurrent reply targets.
      if(control) {
        const prior=api.composerAssociation.snapshot(document,active.post,active.initialUrl,location.href,performance.now(),quarantinedPosts);
        if(prior.editors.length===0&&prior.visibleDialogCount===0) endSession('reply_closed');
        else refreshAssociation();
      } else refreshAssociation();
    }
    if (recoveryRequired && control) {pendingActivation=null;return;}
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
    if (!post.ok) {pendingActivation=null;return;}
    pendingActivation={control,post:Object.freeze(api.composerAssociation.capturePost(post)),baseline:api.composerAssociation.baseline(document),at:performance.now(),initialUrl:location.href};
  }
  function onDocumentClick(event) {
    const clickAt = performance.now();
    if (!hasRuntimeContext() || !event.isTrusted) return;
    const control=api.replyDetector.findReplyControl(event.target);
    if (control?.closest('[role="dialog"]') && !control.closest('article')) return;
    if (!control || control.closest('[data-zane-reply-copilot]')) return;
    const activation=pendingActivation;pendingActivation=null;
    if (!activation || activation.blocked || performance.now()-activation.at>1500) {
      return;
    }
    const live=api.postExtractor.extractPost(control.closest('article'));
    if (!live.ok || live.statusId!==activation.post.statusId) {
      return;
    }
    activation.trace = performanceApi?.createTrace({enabled:performanceEnabled,startAt:clickAt});
    activation.trace?.mark("reply_click",clickAt);
    begin(control,activation.post,activation);
  }
  function refreshAssociation(){active?.refreshAssociation?.();}
  function onBeforeInput(event) {
    if(event.isTrusted && active && !active.cancelled && !active.editor) rejectAssociation('user_input_before_binding');
  }
  function setMomentumEntry(show) {
    if (!contextAlive) return;
    if (show && !momentumEntry) {
      try { momentumEntry = globalThis.ReplyCopilotMomentumPresenter.mountEntry(safeSend); } catch {}
    } else if (!show) {
      momentumEntry?.remove();
      momentumEntry = null;
    }
  }
  let momentumPreferenceRevision = 0;
  function onMomentumPreference(changes, area) {
    if (area !== 'local' || !changes.behaviorPreferences) return;
    const {oldValue, newValue} = changes.behaviorPreferences;
    if ((oldValue?.showMomentumEntry !== false) === (newValue?.showMomentumEntry !== false)) return;
    momentumPreferenceRevision++;
    setMomentumEntry(newValue?.showMomentumEntry !== false);
  }
  if (globalThis.ReplyCopilotMomentumPresenter && window.top === window) try {
    chrome.storage.onChanged.addListener(onMomentumPreference);
    const initialRevision = momentumPreferenceRevision;
    void chrome.storage.local.get('behaviorPreferences').then(({behaviorPreferences}) => {
      if (initialRevision === momentumPreferenceRevision) setMomentumEntry(behaviorPreferences?.showMomentumEntry !== false);
    }).catch(() => {});
  } catch {}
  void safeSend({type:"REPLY_COPILOT_PERFORMANCE_STATE"}).then(response=>{performanceEnabled=response?.enabled===true;});
  document.addEventListener('pointerdown',captureActivation,true);
  document.addEventListener('keydown',captureActivation,true);
  document.addEventListener('focusin',refreshAssociation,true);
  document.addEventListener('beforeinput',onBeforeInput,true);
  window.addEventListener('popstate',refreshAssociation);
  document.addEventListener('click',onDocumentClick,true);
})();
