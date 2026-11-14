(() => {
  const STYLES = [["natural", "自然"], ["light_humor", "幽默"], ["thoughtful", "观点"]];
  const nextCandidateIndex = (index, length) => length ? (index + 1) % length : 0;

  function mount(anchor, onAction, { compact = false, dismissAfterMs = 0, preferences = {} } = {}) {
    const host = document.createElement("div"); host.dataset.replyCopilot = "true"; host.dataset.zaneReplyCopilot = "true";
    // Keep our live controls untranslated in Immersive Translate only.
    // No Google Translate compatibility path or extra runtime processing.
    host.setAttribute("translate","no");
    const pageTheme = getComputedStyle(document.documentElement).colorScheme || getComputedStyle(document.body).colorScheme;
    if (document.documentElement.dataset.theme === "dark" || document.documentElement.dataset.colorMode === "dark" || pageTheme === "dark") host.dataset.theme = "dark";
    host.style.cssText = `position:fixed;z-index:2147483000;margin:0;font:14px/1.45 system-ui,sans-serif;max-width:min(${compact ? "480px" : "560px"},calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;width:min(${compact ? "480px" : "560px"},calc(100vw - 24px));right:12px;bottom:12px;`;
    const shadow = host.attachShadow({ mode: "open" });
    try {
      const link = document.createElement("link"); link.rel = "stylesheet"; link.href = chrome.runtime.getURL("content/inline-assistant.css"); shadow.append(link);
      const momentumStyle = link.cloneNode();
      momentumStyle.href = chrome.runtime.getURL("content/momentum.css");
      shadow.append(momentumStyle);
    } catch {
      // The extension may have been reloaded while this tab still holds the old content script.
      // Keep mount failures from surfacing as uncaught errors; refreshing the tab loads the new context.
    }
    const root = document.createElement("section"); root.className = "panel"; root.setAttribute("aria-label", "x-Reply-Helper 回复助手");
    root.innerHTML = '<div class="top"><span class="drag-grip" title="按住拖动">⋮⋮</span><strong>x-Reply-Helper</strong><span class="disclaimer">AI 草稿</span><button data-action="settings" class="window-control" aria-label="打开设置" title="打开设置">⚙</button><button data-action="minimize" class="window-control" aria-label="收起悬浮框" title="收起悬浮框">−</button><button data-action="dismiss" class="window-control close" aria-label="关闭悬浮框" title="关闭悬浮框">×</button></div><div class="body"><div class="quick-control"><label for="auto-generate-toggle">自动生成建议</label><input id="auto-generate-toggle" type="checkbox" role="switch" aria-label="自动生成建议"></div><p class="status">正在准备…</p><div class="account-actions hidden"><button data-action="register">免费注册并连接</button><button data-action="login">已有账号？登录连接</button><button data-action="pricing" class="hidden">查看充值套餐</button><button data-action="check-account" class="hidden">查看绑定状态</button></div><button data-action="generate" class="generate hidden">手动生成建议</button><div class="reply hidden"></div><div class="actions hidden"><div class="style-tabs" role="group" aria-label="回复风格"></div><div class="action-row"><button data-action="change">换一个 ↻</button><button data-action="copy">复制</button></div></div><div class="feedback hidden"><span>这条建议有帮助吗？</span><button data-action="feedback-good">有帮助</button><button data-action="feedback-bad">不太像我</button></div><button data-action="retry" class="retry hidden">重试</button><button data-action="abandon-generation" class="retry hidden">放弃并重新生成</button><button data-action="sidepanel" class="text">打开侧边栏</button></div><div class="momentum-gate hidden" role="dialog" aria-modal="true" aria-labelledby="momentum-gate-title" tabindex="-1"></div>';
    let momentum;
    try { momentum = globalThis.ReplyCopilotMomentumPresenter?.mount(root.querySelector(".body"), onAction); } catch {}
    shadow.append(root);
    (document.documentElement || document.body).append(host);
    if (preferences.rememberFloatingPosition && preferences.floatingPosition) setPosition(preferences.floatingPosition.left, preferences.floatingPosition.top);
    let candidates = [], index = 0, cycled = false, drag = null, appliedValue = null, postReplyMode = false;
    const dismissTimer = dismissAfterMs ? setTimeout(() => host.remove(), dismissAfterMs) : null;
    const status = root.querySelector(".status"), reply = root.querySelector(".reply"), actions = root.querySelector(".actions");
    const accountBadge = document.createElement("span"); accountBadge.className = "account-badge"; accountBadge.setAttribute("aria-live", "polite");
    root.querySelector(".top .disclaimer").after(accountBadge);
    const styleTabs = root.querySelector(".style-tabs");
    function markSelectedStyle(style) {
      for (const tab of styleTabs.querySelectorAll("button[data-style]")) {
        const selected = tab.dataset.style === style;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-pressed", String(selected));
      }
    }
    function setStatus(message) { status.textContent = message; }
    function setPosition(left, top) {
      const width = host.getBoundingClientRect().width || Math.min(compact ? 480 : 560, window.innerWidth - 24);
      host.style.position = "fixed"; host.style.margin = "0"; host.style.right = "auto"; host.style.bottom = "auto"; host.style.width = `${Math.min(width, window.innerWidth - 24)}px`;
      const height = Math.min(host.getBoundingClientRect().height || 240, window.innerHeight - 16);
      host.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`; host.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    }
    function showReady(autoGenerate = true) { setStatus(autoGenerate ? "点击下方按钮生成回复建议。" : "自动生成已关闭。需要时可手动生成建议。"); root.querySelector('[data-action="generate"]').classList.remove("hidden"); }
    function setAutoGenerate(enabled) { root.querySelector('#auto-generate-toggle').checked = Boolean(enabled); }
    function showAccount(status, quota, pending) {
      const group = root.querySelector('.account-actions'); group.classList.toggle('hidden', !['guest','auth_expired','auth_unavailable','credits_exhausted'].includes(status) && !pending);
      for (const action of ['register','login','pricing','check-account']) root.querySelector(`[data-action="${action}"]`).classList.add('hidden');
      if (status !== 'credits_available') root.querySelector('[data-action="generate"]').classList.add('hidden');
      accountBadge.textContent = status === 'credits_available' && quota?.totalRemaining != null ? `剩余 ${quota.totalRemaining} 次` : '';
      if (pending) { setStatus('正在等待官网确认，请在官网完成绑定。'); root.querySelector('[data-action="check-account"]').classList.remove('hidden'); }
      else if (status === 'guest' || status === 'auth_expired') { setStatus(status === 'guest' ? '免费领取 200 次 AI 回复。注册并验证邮箱后，即可使用自然、幽默、观点三种建议。' : '登录已过期，请重新连接账户。'); root.querySelector('[data-action="register"]').classList.toggle('hidden', status !== 'guest'); root.querySelector('[data-action="login"]').classList.remove('hidden'); }
      else if (status === 'credits_exhausted') { setStatus('生成次数已用完。'); root.querySelector('[data-action="pricing"]').classList.remove('hidden'); }
      else if (status === 'frozen') setStatus('账户已冻结，无法生成回复。请到官网账户中心查看状态。');
      else if (status === 'auth_unavailable') { setStatus('暂时无法连接账户服务，请重试。'); root.querySelector('[data-action="check-account"]').classList.remove('hidden'); }
      if (group.classList.contains('hidden')) return;
      root.querySelector('[data-action="generate"]').classList.add('hidden');
    }
    function showLoading(message = "正在生成回复建议…") { clearRecovery(); setStatus(message); root.querySelector('[data-action="generate"]').classList.add("hidden"); root.querySelector('[data-action="retry"]').classList.add("hidden"); }
    function enterPostReplyMode() {
      postReplyMode = true;
      clearRecovery();
      root.querySelector('[data-action="generate"]').classList.add('hidden');
      root.querySelector('[data-action="retry"]').classList.add('hidden');
      const change = root.querySelector('[data-action="change"]');
      change.textContent = '换一个 ↻';
      const selected = candidates[index]?.[1] || '';
      reply.textContent = selected;
      reply.classList.toggle('hidden', !selected);
      setStatus('回复窗口已关闭。仍可切换风格、复制建议或打开设置。');
    }
    function showApplied() {
      appliedValue = candidates[index]?.[1] || null;
      reply.textContent = ""; reply.classList.add("hidden");
      root.querySelector('[data-action="generate"]').classList.add("hidden");
      setStatus("已填入，可继续编辑。");
    }
    function showResult(replies, selectedStyle = "natural") { clearRecovery();
      appliedValue = null;
      candidates = STYLES.map(([key]) => [key, replies[key]]).filter(([, value]) => typeof value === "string" && value.trim());
      cycled = false; index = Math.max(0, candidates.findIndex(([key]) => key === selectedStyle));
      root.querySelector('[data-action="change"]').textContent = "换一个 ↻";
      if (!candidates.length) { setStatus("这次没有可用的回复建议，请重试。"); showRetry(); return; }
      const [style, value] = candidates[index]; reply.textContent = value; reply.classList.remove("hidden"); actions.classList.remove("hidden"); setStatus("建议已生成。");
      styleTabs.replaceChildren();
      for (const [key, label] of STYLES) { const tab = document.createElement("button"); tab.type = "button"; tab.dataset.style = key; tab.textContent = label; tab.addEventListener("click", () => selectStyle(key)); styleTabs.append(tab); }
      markSelectedStyle(style);
      root.querySelector(".feedback").classList.remove("hidden"); root.querySelector('[data-action="retry"]').classList.add("hidden");
    }
    function selectStyle(key) {
      const selected = candidates.findIndex(([candidate]) => candidate === key); if (selected < 0) return;
      index = selected; const [style, value] = candidates[index]; reply.textContent = value; reply.classList.toggle("hidden", !postReplyMode && value === appliedValue);
      markSelectedStyle(style);
      if (postReplyMode) setStatus('回复窗口已关闭。可复制当前建议。');
      else if (appliedValue && value !== appliedValue) setStatus("可复制此建议，原草稿保持不变。");
      onAction("selected", { style, reply: value, userGesture: true });
    }
    function showRecovery(){showRetry();root.querySelector('[data-action="retry"]').textContent='恢复上一条';root.querySelector('[data-action="retry"]').dataset.recovery='true';root.querySelector('[data-action="abandon-generation"]').classList.remove('hidden');}
    function clearRecovery(){root.querySelector('[data-action="abandon-generation"]').classList.add('hidden');const retry=root.querySelector('[data-action="retry"]');retry.textContent='重试';delete retry.dataset.recovery;}
    function showRetry() { root.querySelector('[data-action="retry"]').classList.remove("hidden"); }
    const header = root.querySelector(".top");
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button,input,label")) return;
      const rect = host.getBoundingClientRect(); drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      host.style.position = "fixed"; host.style.margin = "0"; host.style.width = `${rect.width}px`; host.style.right = "auto"; host.style.bottom = "auto"; host.style.left = `${rect.left}px`; host.style.top = `${rect.top}px`;
      header.setPointerCapture(event.pointerId); event.preventDefault();
    });
    header.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const left = Math.max(8, Math.min(drag.left + event.clientX - drag.x, window.innerWidth - host.offsetWidth - 8));
      const top = Math.max(8, Math.min(drag.top + event.clientY - drag.y, window.innerHeight - 48));
      host.style.left = `${left}px`; host.style.top = `${top}px`;
    });
    header.addEventListener("pointerup", () => { if (!drag) return; drag = null; onAction("position_changed", { left: host.getBoundingClientRect().left, top: host.getBoundingClientRect().top }); });
    header.addEventListener("pointercancel", () => { drag = null; });
    root.querySelector('#auto-generate-toggle').checked = Boolean(preferences.autoGenerateOnReply);
    root.querySelector('#auto-generate-toggle').addEventListener('change', (event) => onAction('toggle_auto_generate', { enabled: event.target.checked }));
    const momentumGate=root.querySelector('.momentum-gate');
    let lastAnimatedGate;
    let gatePreview = false;
    function renderGate(reminder, policy, preview) {
      if (!momentumGate.firstChild) {
        momentumGate.innerHTML = `<header class="momentum-gate-header"><span aria-hidden="true">✦</span><span class="momentum-gate-engine"></span><b class="momentum-gate-pro">PRO</b><button class="momentum-gate-close" data-action="momentum-gate-continue">×</button></header>
          <div class="momentum-gate-milestone">
            <strong class="momentum-gate-unlocked"></strong>
            <span class="momentum-gate-stage" id="momentum-gate-stage"></span>
            <div class="momentum-gate-track" aria-hidden="true"><i></i><i></i><i></i></div>
          </div>
          <small class="momentum-gate-preview"></small>
          <h2 id="momentum-gate-title"></h2><p class="momentum-gate-copy"></p><small class="momentum-gate-error" role="status"></small><div class="momentum-gate-actions"><button class="momentum-gate-primary" data-action="momentum-gate-continue">我知道了，继续回复</button><button class="momentum-gate-secondary" data-action="momentum-gate-dnd">今日不再提醒</button></div>`;
        momentumGate.setAttribute('aria-describedby', 'momentum-gate-stage');
      }
      const stage = [1, 2, 3].includes(reminder.stage) ? reminder.stage : 1;
      const english = preferences.uiLanguage === 'en';
      const label = (zh, en) => english ? en : zh;
      const set = (selector, text) => { momentumGate.querySelector(selector).textContent = text; };
      set('.momentum-gate-engine', label('势能分析引擎', 'Momentum Analysis Engine'));
      set('.momentum-gate-unlocked', label('势能阶段已解锁', 'Momentum milestone unlocked'));
      set('.momentum-gate-stage', label(`阶段 ${stage} 已激活`, `Stage ${stage} activated`));
      set('.momentum-gate-preview', preview ? label('Staging 测试预览', 'Staging preview') : '');
      set('#momentum-gate-title', (english ? policy.titleEn : policy.titleZh) || label('今日活跃信号', 'Today’s activity signal'));
      set('.momentum-gate-copy', (english ? policy.bodyEn : policy.bodyZh) || label('可以考虑把讨论中的想法整理成一条原创帖。是否发布由你决定。', 'Consider turning an idea from the discussion into an original post.'));
      set('.momentum-gate-primary', label('我知道了，继续回复', 'Got it, continue replying'));
      set('.momentum-gate-secondary', label('今日不再提醒', 'Mute for today'));
      momentumGate.querySelector('.momentum-gate-close').setAttribute('aria-label', label('关闭提醒', 'Close reminder'));
      momentumGate.querySelectorAll('.momentum-gate-track i').forEach((node, index) => {
        node.dataset.state = index + 1 === stage ? 'current' : index < stage ? 'complete' : 'upcoming';
      });
      const animationKey = preview ? `preview:${stage}` : reminder.id;
      if (momentumGate.classList.contains('hidden')) {
        momentumGate.classList.toggle('activate', lastAnimatedGate !== animationKey);
        lastAnimatedGate = animationKey;
      }
    }
    let momentumGateReturnFocus=null;
    function setGateBusy(busy,error=''){
      for(const button of momentumGate.querySelectorAll('button'))button.disabled=busy;
      momentumGate.querySelector('.momentum-gate-error').textContent=error;
      momentumGate.dataset.busy=String(busy);
    }
    function showMomentumGate(reminder,policy={},preview=false){
      if (preview && !momentumGate.classList.contains('hidden') && !gatePreview) return null;
      if (momentumGate.classList.contains('hidden')) momentumGateReturnFocus=shadow.activeElement || document.activeElement;
      gatePreview = preview;
      renderGate(reminder, policy, preview);
      momentumGate.dataset.id=reminder.id||'';momentumGate.dataset.lease=reminder.lease||'';momentumGate.dataset.stage=String(reminder.stage);
      root.classList.add('gate-open');
      setGateBusy(false);momentumGate.classList.remove('hidden');
      if (host.style.top) setPosition(parseFloat(host.style.left), parseFloat(host.style.top));
      momentumGate.focus({preventScroll:true});
      return momentumGate;
    }
    function hideMomentumGate(){
      if (momentumGate.classList.contains('hidden')) return;
      momentumGate.classList.add('hidden');root.classList.remove('gate-open');setGateBusy(false);
      gatePreview = false;
      if(momentumGateReturnFocus?.isConnected)momentumGateReturnFocus.focus?.({preventScroll:true});
      momentumGateReturnFocus=null;
    }
    momentumGate.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(gatePreview){hideMomentumGate();return;}onAction('momentum_gate_dismiss',{id:momentumGate.dataset.id,lease:momentumGate.dataset.lease});return;}
      if(event.key==='Tab'){
        const controls=[...momentumGate.querySelectorAll('button:not(:disabled)')];
        if(!controls.length)return;
        const first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&(shadow.activeElement===first||shadow.activeElement===momentumGate)){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&shadow.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    root.addEventListener('pointerdown', () => { if (postReplyMode) onAction('linger_interaction', {}); });
    root.addEventListener('keydown', () => { if (postReplyMode) onAction('linger_interaction', {}); });
    root.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]"); if (!button) return;
      const action = button.dataset.action;
      if((action==='abandon-generation'||(action==='retry'&&button.dataset.recovery))&&!event.isTrusted)return;
      if (action === "settings") { onAction("settings", {}); return; }
      if (["register", "login", "pricing", "check-account"].includes(action)) { onAction(action, {}); return; }
      if (action === "minimize") { root.classList.toggle("collapsed"); button.textContent = root.classList.contains("collapsed") ? "+" : "−"; button.title = root.classList.contains("collapsed") ? "展开悬浮框" : "收起悬浮框"; button.setAttribute("aria-label", button.title); if(postReplyMode)onAction('linger_interaction',{}); return; }
      if (action === "dismiss") { if (dismissTimer) clearTimeout(dismissTimer); host.remove(); onAction("dismiss", {}); return; }
      if(action==='momentum-gate-continue'||action==='momentum-gate-dnd'){
        if(gatePreview){hideMomentumGate();return;}
        if(!event.isTrusted||momentumGate.classList.contains('hidden'))return;
        setGateBusy(true);onAction(action==='momentum-gate-dnd'?'momentum_gate_dnd':'momentum_gate_dismiss',{id:momentumGate.dataset.id,lease:momentumGate.dataset.lease});return;
      }
      if (action === "generate") { onAction("generate", { userGesture: true }); return; }
      if (action === "change" && candidates.length) {
        if (cycled && !postReplyMode) { onAction("regenerate", { userGesture: true }); cycled = false; return; }
        index = nextCandidateIndex(index, candidates.length); if (index === 0) cycled = true;
        const [style, value] = candidates[index]; reply.textContent = value; reply.classList.toggle("hidden", !postReplyMode && value === appliedValue); markSelectedStyle(style); onAction("selected", { style, reply: value, userGesture: true });
        if (postReplyMode) setStatus('回复窗口已关闭。可复制当前建议。');
        else if (appliedValue && value !== appliedValue) setStatus("可复制此建议，原草稿保持不变。");
        button.textContent = postReplyMode ? "换一个 ↻" : cycled ? "再生成" : "换一个 ↻";
      } else if (action === "copy" && candidates.length) { const [style, value] = candidates[index]; try { await navigator.clipboard.writeText(value.trim()); setStatus("已复制，请检查后再发送。"); onAction("copied", { style, reply: value }); } catch { setStatus("复制失败，请手动选择文字。"); } }
      else if(action === "abandon-generation") onAction("abandon-generation",{userGesture:true});
      else if (action === "retry") onAction(button.dataset.recovery?"recover-generation":"regenerate", { userGesture: true });
      else if (action === "feedback-good") { onAction("feedback", { feedback: "good", style: candidates[index]?.[0] }); button.disabled = true; button.textContent = "已记录 ✓"; }
      else if (action === "feedback-bad") { onAction("feedback", { feedback: "not_my_style", style: candidates[index]?.[0] }); button.disabled = true; button.textContent = "已记录 ✓"; }
      else if (action === "sidepanel") onAction("sidepanel", { userGesture: true });
    });
    function showPanelError(message) {
      let notice = root.querySelector(".panel-open-error");
      if (!message) { notice?.remove(); return; }
      if (!notice) {
        notice = document.createElement("small");
        notice.className = "panel-open-error";
        notice.setAttribute("role","status");
        root.querySelector('[data-action="sidepanel"]').after(notice);
      }
      notice.textContent = message;
    }
    return { enterPostReplyMode, showPanelError, isMomentumPreview: () => gatePreview, previewMomentum: data => showMomentumGate(data, data, true), setMomentum(value, request) { try { momentum?.update(value, request); } catch {} }, showMomentumGate, resolveMomentumGate(){hideMomentumGate();}, momentumGateError(message){setGateBusy(false,message||'暂时无法确认，请重试。');}, host, showResult, showApplied, showReady, showLoading, showAccount, setAutoGenerate, setAccountLabel(value) { accountBadge.textContent = value || ""; }, setStatus(message) { setStatus(message); root.querySelector('[data-action="retry"]').classList.add("hidden"); }, showRetry, showRecovery, close() { if (dismissTimer) clearTimeout(dismissTimer); host.remove(); }, setPosition, setCollapsed(value) { root.classList.toggle("collapsed", value); } };
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  globalThis.ZaneReplyCopilotContent.inlineAssistant = { mount, nextCandidateIndex };
})();
