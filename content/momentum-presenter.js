// Small independent UI; research text and reminder DOM are only created on demand.
(() => {
 function mount(container,onAction){
  const en=document.documentElement.lang==='en',t=(zh,enText)=>en?enText:zh;
  const box=document.createElement('section');box.className='momentum';box.setAttribute('aria-label',t('互动势能临界值','Interaction Momentum Threshold'));
  const label=document.createElement('label'),title=document.createElement('strong'),toggle=document.createElement('input');title.textContent=t('互动势能临界值','Interaction Momentum Threshold');toggle.type='checkbox';toggle.role='switch';toggle.disabled=true;toggle.setAttribute('aria-label',title.textContent);label.append(title,toggle);
  const info=document.createElement('button');info.type='button';info.textContent=t('查看功能原理与分析体系','View principles and analysis framework');info.setAttribute('aria-expanded','false');
  const note=document.createElement('small'),upgrade=document.createElement('button');upgrade.type='button';upgrade.textContent=t('查看套餐，解锁专属监测','View plans to unlock monitoring');upgrade.onclick=()=>onAction('pricing',{});
  const verify=document.createElement('button');verify.type='button';verify.textContent=t('验证购买权益','Verify purchase eligibility');verify.onclick=()=>{busy();onAction('momentum_refresh',{});};note.setAttribute('aria-live','polite');
  box.append(label,note,info,upgrade,verify);container.prepend(box);let policy={},intro=null,reminder=null;const shown=new Set();
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
  function busy(){toggle.disabled=true;verify.hidden=true;note.textContent=t('正在验证购买权益…','Checking purchase eligibility…');}
  function update(value){
   const prior=policy;
   policy=value?.policy||policy;
   const status=value?.status||(value?.available?(value.eligible?'paid':'free'):'unverified'),eligible=status==='paid';
   toggle.disabled=!eligible;toggle.checked=eligible&&value?.enabled===true;
   upgrade.hidden=status!=='guest'&&status!=='free';verify.hidden=status!=='unverified';
   note.textContent=status==='guest'?t('登录后可验证购买权益。','Sign in to verify purchase eligibility.'):status==='free'?t('购买后解锁监测；免费账号也持续累计。','Purchase to unlock monitoring. Free accounts are also counted.'):eligible?t('按本机当日确认生成记录提醒；不代表已发送评论。','Uses this installation’s daily confirmed generations, not sent comments.'):t('暂时无法确认购买权益。你可以重试，回复功能可照常使用。','Purchase eligibility could not be confirmed. You can retry; replies remain available.');
   if(!eligible||!value?.enabled||policy.enabled===false)closeReminder();else if(value.reminder)showReminder(value.reminder);
   if(intro&&prior!==policy)renderIntro();
  }
  toggle.onchange=()=>{const enabled=toggle.checked;busy();onAction('momentum_toggle',{enabled});};
  info.onclick=()=>{
   if(intro){intro.remove();intro=null;info.setAttribute('aria-expanded','false');return;}
   onAction('momentum_refresh',{});
   intro=document.createElement('div');intro.className='momentum-intro';intro.setAttribute('role','region');intro.setAttribute('aria-label',info.textContent);
   box.append(intro);info.setAttribute('aria-expanded','true');renderIntro();
  };
  function renderIntro(){
   intro.replaceChildren();
   for(const [heading,text] of [[t('当前 V1 机制','Current V1 mechanism'),policy[en?'overviewEn':'overviewZh']||t('按本机当日已完成交付确认的 AI 生成记录，使用隐藏的多阶段阈值提醒。不是实际发送评论数，不代表官方曝光系数。','Uses this installation’s ACK-confirmed generations and hidden stages, not sent posts or official exposure scores.')],[t('未来研究规划（尚未接入 V1）','Future research (not connected in V1)'),policy[en?'researchEn':'researchZh']||t('后续研究规划（尚未接入 V1）：基于 X 公开材料研究推荐系统的候选召回、排序与信号演变；从互动时间、密度、节奏、连续性和活跃窗口建立多维行为模型，探索个性化发布时机；用可核验来源研究中文区创作者每日互动榜单、曝光趋势和热门议题，先验证数据口径；仅在研究验证后迭代个性化动态临界值、提醒时机与冷却策略。V1 未接入实时榜单或曝光数据，不保证流量。','Research roadmap (not live in V1): study candidate retrieval, ranking and changing signals using public X materials; model interaction timing, density, rhythm, continuity and active windows to explore personalized posting times; study daily Chinese-language creator engagement rankings, impression trends and trending topics using verifiable sources and validated methodology; refine personalized thresholds, reminder timing and cooldowns only after validation. V1 has no live rankings or impression data and does not guarantee reach.')]]){const h=document.createElement('strong'),p=document.createElement('p');h.textContent=heading;p.textContent=text;intro.append(h,p);}
   const boundary=document.createElement('p');boundary.textContent=t('统计仅保存在本机，按账户和自然日隔离；升级前历史不补算，不跨设备同步。是否发帖始终由你决定。','Local per-account, per-day statistics start with this version. No cross-device synchronization or historical backfill. Only you decide whether to publish.');intro.append(boundary);
  }
  update(null);
  return {update};
 }
 globalThis.ReplyCopilotMomentumPresenter={mount};
})();
