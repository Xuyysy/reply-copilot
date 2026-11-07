(() => {
  // Interface locale is independent of the page and of AI reply preferences.
  const zh = {
    name: '互动势能临界值', intro: '势能分析引擎', fullIntro: '查看完整介绍',
    summary: '基于创作者活跃信号监测，融合互动势能评估模型、分阶段阈值算法与后台动态策略更新，持续识别原创内容的潜在黄金发布窗口。', guest: '待登录',
    free: '未解锁', unverified: '权益未确认', checking: '正在验证…',
    enabled: '势能监测运行中', disabled: '监测已关闭', paused: '系统暂未开放',
    saving: '正在保存…', saveFailed: '设置未保存，请重试', saveTimeout: '保存结果未确认，请重试', verify: '刷新购买权益', plans: '查看套餐',
    current: '当前机制', future: '后续研究规划',
    dnd: '今日不再提醒', dismiss: '关闭当前提醒', original: '去发布原创帖', dndOn: '今日免打扰'
  };

  function request(send, message, timeoutMs = 15000) {
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve({ok:false, timeout:true}), timeoutMs);
    });
    return Promise.race([Promise.resolve().then(() => send(message)), timeout]).finally(() => clearTimeout(timer));
  }

  function mount(container, onAction, {mode = 'compact', copy = zh} = {}) {
    const full = mode === 'full';
    const make = (tag, text) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      return node;
    };
    const button = (text, handler) => {
      const node = make('button', text);
      node.type = 'button';
      node.onclick = handler;
      return node;
    };

    const box = make('section');
    box.className = full ? 'momentum momentum-full' : 'momentum';
    box.setAttribute('aria-label', copy.name);
    const label = make('label');
    const title = make('span', copy.name);
    const pro = make('span', 'PRO');
    pro.className = 'momentum-pro';
    title.append(pro);
    const toggle = make('input');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', copy.name);
    label.append(title, toggle);

    const note = make('small');
    note.setAttribute('aria-live', 'polite');
    const details = make('details');
    details.className = 'momentum-details';
    details.append(make('summary', full ? copy.fullIntro : copy.intro));
    const intro = make('div');
    intro.className = 'momentum-intro';
    details.append(intro);
    const verify = full ? button(copy.verify, () => act('momentum_refresh')) : null;
    const plans = full ? button(copy.plans, () => onAction('pricing', {})) : null;

    box.append(label, note);
    if (full) {
      const actions = make('div');
      actions.className = 'momentum-tools';
      actions.append(verify, plans);
      box.append(actions);
    }
    box.append(details);
    container.prepend(box);

    let value = null;
    let pending = false;
    let checking = false;
    let desired;
    let saveFailed = "";
    let scope;
    let reminder;
    let preview;
    const seen = new Set();

    function clearReminder() {
      reminder?.remove();
      reminder = null;
    }

    function showReminder(event, sample) {
      if (sample) preview?.remove();
      else if (preview?.isConnected) return;
      const acknowledge = () => {
        if (event.lease) onAction('momentum_presented', {id:event.id, lease:event.lease});
      };
      if (!sample && seen.has(event.id)) { acknowledge(); return; }
      if (reminder?.dataset.lease === event.lease && event.lease) return;
      if (!sample) clearReminder();
      const node = make('aside');
      if (sample) preview = node; else reminder = node;
      node.dataset.lease = event.lease || '';
      node.className = 'momentum-reminder';
      node.setAttribute('role', 'status');
      const presented = () => {
        if (!seen.has(event.id)) {
          seen.add(event.id);
          if (seen.size > 12) seen.delete(seen.values().next().value);
          acknowledge();
        }
      };
      const dismiss = () => sample ? node.remove() : clearReminder();
      const close = button('×', event => {
        if (event.isTrusted && visible()) presented();
        dismiss();
      });
      close.className = 'momentum-close';
      close.setAttribute('aria-label', copy.dismiss);
      const dnd = button(copy.dnd, () => { dismiss(); if (!sample) act('momentum_dnd'); });
      const policy = sample || value?.policy;
      if (sample) node.append(make('small', 'Staging 测试预览 · 阶段 ' + sample.stage));
      node.append(make('strong', policy?.titleZh || '今日活跃信号'), close,
        make('p', policy?.bodyZh || '可以考虑整理一条原创帖。'),
        button(copy.original, () => { if (!sample) onAction('momentum_original', {}); }), dnd);
      box.append(node);
      if (sample) return node;
      if (!event.lease) { presented(); return; }
      function visible() {
        if (reminder !== node || !node.isConnected || document.visibilityState !== 'visible' ||
            Date.now() >= event.expiresAt) return false;
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        const x = Math.max(0, rect.left) + Math.min(12, rect.width / 2);
        const y = Math.max(0, rect.top) + Math.min(12, rect.height / 2);
        const root = node.getRootNode();
        const hit = root.elementFromPoint?.(x,y);
        return node.contains(hit) && (!root.host || document.elementFromPoint(x,y) === root.host);
      }
      requestAnimationFrame(() => {
        if (!visible()) { if (reminder === node) clearReminder(); return; }
        requestAnimationFrame(() => {
          if (visible()) presented();
          else if (reminder === node) clearReminder();
        });
      });
    }

    function act(action, data = {}) {
      if (pending) return;
      pending = true;
      saveFailed = "";
      if (action === "momentum_toggle") desired = data.enabled;
      checking = (action === "momentum_refresh" && !(value?.refreshAfter > Date.now())) ||
        (action === "momentum_toggle" && !(value?.proofUntil > Date.now()));
      renderStatus();
      onAction(action, action === "momentum_toggle" ? {...data, scope} : data);
    }

    function renderStatus() {
      const status = value?.status ?? (value?.available ? (value.eligible ? 'paid' : 'free') : 'unverified');
      const paid = status === 'paid';
      const paused = paid && value.policy?.enabled === false;
      const enabled = desired ?? value?.enabled;
      const running = paid && !paused && value?.enabled === true && enabled === true && !value.dnd;
      box.dataset.running = String(running);
      toggle.disabled = pending || !paid || paused;
      toggle.checked = paid && enabled === true;
      toggle.title = paused && enabled ? '个人偏好已开启，当前系统暂停' : '';
      note.textContent = saveFailed || (pending && checking ? copy.checking : pending && desired !== undefined ? copy.saving : !value ? '' : paid
        ? paused ? copy.paused : enabled && value.dnd ? copy.dndOn : enabled ? copy.enabled : copy.disabled
        : copy[status] || copy.unverified);
      if (full) {
        plans.hidden = status !== 'free' && status !== 'guest';
        verify.disabled = pending;
      }
      if (!paid || !value?.enabled || value.dnd || value.policy?.enabled === false) clearReminder();
      else if (value.reminder) showReminder(value.reminder);
    }

    function renderIntro() {
      if (!details.open) return;
      if (full) {
        intro.replaceChildren(make('strong', copy.current),
          make('p', value?.policy?.overviewZh || copy.summary), make('strong', copy.future),
          make('p', value?.policy?.researchZh || '研究公开推荐机制、互动节奏、中文创作者趋势及个性化提醒。相关外部数据尚未接入。'));
      } else if (!intro.firstChild) {
        intro.append(make('p', copy.summary), button(copy.fullIntro, () => onAction('momentum_details', {})));
      }
    }

    toggle.onchange = () => act('momentum_toggle', {enabled: toggle.checked});
    details.ontoggle = renderIntro;
    renderStatus();
    return {
      update(next, request = {}) {
        const saving = typeof request.enabled === 'boolean';
        const changingAccount = next?.scope !== undefined && next.scope !== scope;
        if (changingAccount) {
          scope = next?.scope;
          seen.clear();
          clearReminder();
        }
        if (saving) {
          desired = undefined;
          pending = false;
          saveFailed = !changingAccount && next?.saved !== true ? (next?.timeout ? copy.saveTimeout : copy.saveFailed) : "";
        } else if (changingAccount) {
          desired = undefined;
          pending = false;
          saveFailed = "";
        } else if (desired === undefined) {
          pending = false;
        }
        if (!saving || next && next.ok !== false) value = next;
        renderStatus();
        renderIntro();
      },
      expand() { details.open = true; renderIntro(); },
      preview(sample) { return showReminder({}, sample); }
    };
  }

  function connect(container, send, onNavigate, {mode} = {}) {
    let revision = 0;
    let pending = false;
    let queued;
    const presenter = mount(container, (action, data) => {
      if (action === 'momentum_toggle') void refresh({enabled: data.enabled, scope: data.scope});
      else if (action === 'momentum_refresh') void refresh({refresh: true});
      else if (action === 'momentum_dnd') void refresh({dnd: true});
      else if (action === 'momentum_presented') void send({type:'REPLY_COPILOT_MOMENTUM',presented:data}).catch(() => {});
      else onNavigate(action);
    }, {mode});
    async function refresh(options = {}) {
      if (pending) { queued = {...queued, ...options}; return; }
      pending = true;
      const current = ++revision;
      try {
        const response = await request(send, {type: 'REPLY_COPILOT_MOMENTUM', ...options});
        if (current === revision) presenter.update(response, options);
        if (response?.timeout && typeof options.enabled === 'boolean') queued = {...queued};
      } catch {
        if (current === revision) presenter.update(null, options);
      } finally {
        if (current === revision) {
          pending = false;
          if (queued) { const next = queued; queued = null; void refresh(next); }
        }
      }
    }
    return {refresh, expand: presenter.expand};
  }

  function mountEntry(send) {
    if (window.top !== window) return;
    const host = document.createElement('div');
    host.dataset.zaneReplyCopilot = 'true';
    host.style.cssText = 'position:fixed;bottom:68px;right:12px;z-index:2147482999;max-width:calc(100vw - 24px)';
    const root = host.attachShadow({mode: 'open'});
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = chrome.runtime.getURL('content/momentum.css');
    const entry = document.createElement('details');
    entry.className = 'momentum-entry';
    const summary = document.createElement('summary');
    summary.textContent = '势能';
    summary.setAttribute('aria-label', zh.name);
    entry.append(summary);
    const panel = document.createElement('div');
    panel.className = 'momentum-entry-panel';
    root.append(style, entry);
    let control;
    entry.ontoggle = () => {
      if (!entry.open) return;
      if (!control) {
        entry.append(panel);
        const error = document.createElement("small");
        error.setAttribute("role","status");
        panel.append(error);
        let opening = false;
        control = connect(panel, send, action => {
          if (action === 'momentum_details' && !opening) {
            opening = true;
            void send({type:'REPLY_COPILOT_OPEN_SIDEPANEL', momentumDetails:true}).then(response => {
              error.textContent = response?.ok ? '' : response?.error || '无法打开侧边栏，请重试。';
            }).catch(() => { error.textContent = '无法打开侧边栏，请重试。'; }).finally(() => { opening = false; });
          }
          if (action === 'momentum_original') void send({type: 'REPLY_COPILOT_OPEN_ORIGINAL'});
        });
        void control.refresh({ensure: true});
      } else void control.refresh({ensure: true});
    };
    (document.body || document.documentElement).append(host);
    return {sync() { if (entry.open) void control?.refresh(); }, remove() { host.remove(); }};
  }

  globalThis.ReplyCopilotMomentumPresenter = {mount, connect, mountEntry, request};
})();
