(() => {
  // Interface locale is independent of the page and of AI reply preferences.
  const zh = {
    name: '互动势能临界值', intro: '功能原理', fullIntro: '查看完整介绍',
    summary: '按本机今日已确认交付的生成次数提醒。', guest: '待登录',
    free: '未解锁', unverified: '权益未确认', checking: '正在验证…',
    enabled: '已开启', disabled: '已关闭', paused: '全局暂停',
    today: '本机今日确认生成', verify: '刷新购买权益', plans: '查看套餐',
    current: '当前机制', future: '后续研究规划', local: '数据按本机账户和自然日统计，不代表已发布评论或 X 曝光。',
    dnd: '今日不再提醒', dismiss: '关闭当前提醒', original: '去发布原创帖', dndOn: '今日免打扰'
  };

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
    const count = full ? make('p') : null;
    const verify = full ? button(copy.verify, () => act('momentum_refresh')) : null;
    const plans = full ? button(copy.plans, () => onAction('pricing', {})) : null;

    box.append(label, note);
    if (full) {
      const actions = make('div');
      actions.className = 'momentum-tools';
      actions.append(verify, plans);
      box.append(count, actions);
    }
    box.append(details);
    container.prepend(box);

    let value = null;
    let pending = false;
    let scope;
    let reminder;
    const seen = new Set();

    function clearReminder() {
      reminder?.remove();
      reminder = null;
    }

    function showReminder(event) {
      if (seen.has(event.id)) return;
      seen.add(event.id);
      if (seen.size > 12) seen.delete(seen.values().next().value);
      clearReminder();
      reminder = make('aside');
      reminder.className = 'momentum-reminder';
      reminder.setAttribute('role', 'status');
      const close = button('×', clearReminder);
      close.className = 'momentum-close';
      close.setAttribute('aria-label', copy.dismiss);
      const dnd = button(copy.dnd, () => { clearReminder(); act('momentum_dnd'); });
      reminder.append(make('strong', value.policy?.titleZh || '今日活跃信号'), close,
        make('p', value.policy?.bodyZh || '可以考虑整理一条原创帖。'),
        button(copy.original, () => onAction('momentum_original', {})), dnd);
      box.append(reminder);
    }

    function act(action, data = {}) {
      if (pending) return;
      pending = true;
      renderStatus();
      onAction(action, data);
    }

    function renderStatus() {
      const status = value?.status ?? (value?.available ? (value.eligible ? 'paid' : 'free') : 'unverified');
      const paid = status === 'paid';
      toggle.disabled = pending || !paid;
      toggle.checked = paid && value?.enabled === true;
      note.textContent = pending ? copy.checking : paid
        ? value.dnd ? copy.dndOn : value.policy?.enabled === false ? copy.paused : value.enabled ? copy.enabled : copy.disabled
        : copy[status] || copy.unverified;
      if (full) {
        count.textContent = copy.today + ' · ' + (value?.count ?? '—');
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
          make('p', value?.policy?.researchZh || '研究公开推荐机制、互动节奏、中文创作者趋势及个性化提醒。相关外部数据尚未接入。'),
          make('p', copy.local));
      } else if (!intro.firstChild) {
        intro.append(make('p', copy.summary), button(copy.fullIntro, () => onAction('momentum_details', {})));
      }
    }

    toggle.onchange = () => act('momentum_toggle', {enabled: toggle.checked});
    details.ontoggle = renderIntro;
    renderStatus();
    return {
      update(next) {
        if (next?.scope !== scope) {
          scope = next?.scope;
          seen.clear();
          clearReminder();
        }
        value = next;
        pending = false;
        renderStatus();
        renderIntro();
      },
      expand() { details.open = true; renderIntro(); }
    };
  }

  function connect(container, send, onNavigate, {mode} = {}) {
    let revision = 0;
    let pending = false;
    let queued;
    const presenter = mount(container, (action, data) => {
      if (action === 'momentum_toggle') void refresh({enabled: data.enabled});
      else if (action === 'momentum_refresh') void refresh({refresh: true});
      else if (action === 'momentum_dnd') void refresh({dnd: true});
      else onNavigate(action);
    }, {mode});
    async function refresh(options = {}) {
      const explicit = typeof options.enabled === "boolean" || options.refresh || options.dnd;
      if (pending && !explicit) { queued = {...queued, ...options}; return; }
      if (explicit) pending = true;
      const current = ++revision;
      try {
        const response = await send({type: 'REPLY_COPILOT_MOMENTUM', ...options});
        if (current === revision) presenter.update(response);
      } catch {
        if (current === revision) presenter.update(null);
      } finally {
        if (explicit && current === revision) {
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
        control = connect(panel, send, action => {
          if (action === 'momentum_details') void send({type: 'REPLY_COPILOT_OPEN_SIDEPANEL', momentumDetails: true});
          if (action === 'momentum_original') void send({type: 'REPLY_COPILOT_OPEN_ORIGINAL'});
        });
        void control.refresh({ensure: true});
      } else void control.refresh({ensure: true});
    };
    (document.body || document.documentElement).append(host);
    return {sync() { if (entry.open) void control?.refresh(); }, remove() { host.remove(); }};
  }

  globalThis.ReplyCopilotMomentumPresenter = {mount, connect, mountEntry};
})();
