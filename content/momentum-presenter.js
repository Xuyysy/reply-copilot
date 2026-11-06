// Small independent UI; research text and reminder DOM are only created on demand.
(() => {
 function mount(container,onAction){
  const en=document.documentElement.lang==='en',t=(zh,enText)=>en?enText:zh;
  const box=document.createElement('section');box.className='momentum';box.setAttribute('aria-label',t('互动势能临界值','Interaction Momentum Threshold'));
  const label=document.createElement('label'),title=document.createElement('strong'),toggle=document.createElement('input');title.textContent=t('互动势能临界值','Interaction Momentum Threshold');toggle.type='checkbox';toggle.role='switch';toggle.disabled=true;toggle.setAttribute('aria-label',title.textContent);label.append(title,toggle);
  const info=document.createElement('button');info.type='button';info.textContent=t('查看功能原理与分析体系','View principles and analysis framework');info.setAttribute('aria-expanded','false');
  const note=document.createElement('small'),upgrade=document.createElement('button');upgrade.type='button';upgrade.textContent=t('查看套餐，解锁专属监测','View plans to unlock monitoring');upgrade.onclick=()=>onAction('pricing',{});
  box.append(label,note,info,upgrade);container.prepend(box);let policy={},intro=null,reminder=null;const shown=new Set();
  function closeReminder(){reminder?.remove();reminder=null;}
  function showReminder(event){
   if(!event||shown.has(event.id))return;shown.add(event.id);
   closeReminder();reminder=document.createElement('aside');reminder.className='momentum-reminder';reminder.dataset.event=event.id;reminder.setAttribute('role','status');
   const heading=document.createElement('strong'),body=document.createElement('p'),close=document.createElement('button'),dnd=document.createElement('button'),original=document.createElement('button');
   heading.textContent=policy[en?'titleEn':'titleZh']||t('今日活跃信号','Today’s activity signal');body.textContent=policy[en?'bodyEn':'bodyZh']||t('可以考虑整理一条原创帖。','Consider sharing an original post.');
   close.type=dnd.type=original.type='button';close.textContent='×';close.className='momentum-close';close.setAttribute('aria-label',t('关闭当前提醒','Dismiss this reminder'));close.onclick=closeReminder;
   dnd.textContent=t('今日不再提醒','Do not remind me today');dnd.onclick=()=>{closeReminder();onAction('momentum_dnd',{});};original.textContent=t('去发布原创帖','Write an original post');original.onclick=()=>onAction('momentum_original',{});
   reminder.append(heading,close,body,original,dnd);box.append(reminder);
  }
  function update(value){
   policy=value?.policy||policy;const eligible=value?.eligible===true;
   toggle.disabled=!eligible;toggle.checked=eligible&&value?.enabled===true;upgrade.hidden=eligible||!value?.available;
   note.textContent=!value?.available?t('权益暂未确认，回复功能可照常使用。','Eligibility is not confirmed. Replies remain available.'):eligible?t('按本机当日确认生成记录提醒；不代表已发送评论。','Uses this installation’s daily confirmed generations, not sent comments.'):t('仅有效购买用户可开启；免费账号也持续累计。','Available with a valid purchase. Free accounts are also counted.');
   if(!eligible||!value?.enabled||policy.enabled===false)closeReminder();else if(value.reminder)showReminder(value.reminder);
  }
  toggle.onchange=()=>{const enabled=toggle.checked;toggle.disabled=true;onAction('momentum_toggle',{enabled});};
  info.onclick=()=>{
   if(intro){intro.remove();intro=null;info.setAttribute('aria-expanded','false');return;}
   onAction('momentum_refresh',{});
   intro=document.createElement('div');intro.className='momentum-intro';intro.setAttribute('role','region');intro.setAttribute('aria-label',info.textContent);
   for(const [heading,text] of [[t('当前 V1 机制','Current V1 mechanism'),policy[en?'overviewEn':'overviewZh']||t('按本机当日已完成交付确认的 AI 生成记录，使用隐藏的多阶段阈值提醒。不是实际发送评论数，不代表官方曝光系数。','Uses this installation’s ACK-confirmed generations and hidden stages, not sent posts or official exposure scores.')],[t('未来研究规划（尚未接入 V1）','Future research (not connected in V1)'),policy[en?'researchEn':'researchZh']||t('X 公开推荐机制研究、互动行为建模、中文区每日互动与曝光榜单研究、动态临界策略。当前不采集实时榜单或曝光，也不保证流量。','Public X recommendation research, interaction modeling, daily Chinese-language engagement/exposure rankings and dynamic thresholds are planned. No live rankings or impressions are collected; exposure is not guaranteed.')]]){const h=document.createElement('strong'),p=document.createElement('p');h.textContent=heading;p.textContent=text;intro.append(h,p);}
   const boundary=document.createElement('p');boundary.textContent=t('统计仅保存在本机，按账户和自然日隔离；升级前历史不补算，不跨设备同步。是否发帖始终由你决定。','Local per-account, per-day statistics start with this version. No cross-device synchronization or historical backfill. Only you decide whether to publish.');intro.append(boundary);box.append(intro);info.setAttribute('aria-expanded','true');
  };
  return {update};
 }
 globalThis.ReplyCopilotMomentumPresenter={mount};
})();
