import {analyzeLiveDataset,interactionDetails} from '../interaction-manager/analytics/live-view.js';
import {diagnosticSummary} from '../interaction-manager/sync/diagnostic.js';
import {rankingCsv} from '../interaction-manager/ui/csv.js';
const $=id=>document.getElementById(id),PAGE=50;
const labels={like:'点赞',reply:'回复',repost:'转发',quote:'引用',mention:'提及'};
const syncStatus={source_exhausted:'本次同步完成（不代表完整历史）',interrupted:'上次同步已中断，本地检查点保留，确认后可继续',rate_limited:'接口限流，请等待后手动刷新；已提交记录保留',unauthenticated:'X 登录状态无效，请在原 X 标签页重新登录',forbidden:'X 拒绝访问，已停止；不会自动重试',identity_changed:'账号已变化，请从对应 X 页面重新打开',schema_changed:'X 接口结构已变化，已停止；已有记录保留',source_error:'X 接口暂不可用或已变更，已有记录保留',source_unavailable:'数据连接暂不可用，已有记录保留',session_limit:'本次同步达到安全上限，刷新可继续',time_limit:'本次同步已超时，刷新可从已提交进度继续',page_limit:'本次分页上限已到，刷新可继续',cancelled:'同步已停止，已提交记录保留'};
const sourceLabels={notification:'通知',post:'帖子'};
const taskSources=t=>Array.isArray(t?.sources)?t.sources.filter(s=>Object.hasOwn(sourceLabels,s.source)).map(s=>sourceLabels[s.source]+'：'+(s.state==='pending'?'未执行':s.state==='running'?(t.state==='interrupted'?'已中断':'同步中'):syncStatus[s.reason]??'已停止')+' · '+(Number.isSafeInteger(s.pages)?s.pages:0)+' 页 / 新增 '+(Number.isSafeInteger(s.inserted)?s.inserted:0)+' 条').join('；'):'';
const taskSuffix=t=>{const s=taskSources(t);return s?'｜'+s:'';};
let data=null,owner=null,people=[],page=0,selected=null,offset=0,busy=false,actionBusy=false,disposed=false,generation=0,sourceReady=false,waiting=false;
const msg=async(action,extra={})=>{const r=await chrome.runtime.sendMessage({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra});if(!r?.ok)throw Error(r?.error??'source_error');return r.value;};
const settings=()=>({direction:'inbound',type:$('type').value,days:$('days').value?Number($('days').value):null,sort:$('sort').value,query:$('search').value});
const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
let preferenceBusy=false,preferenceOwner=null;
function resetPreference(){preferenceOwner=null;$('auto-sync-enabled').checked=false;$('auto-sync-enabled').disabled=true;$('auto-sync-interval').disabled=true;$('auto-sync-interval').value='60';$('auto-sync-status').textContent='真实数据源尚未验收，自动同步不可启用。';}
async function loadPreference(){
 const g=generation,o=owner;if(!o||disposed||preferenceBusy||preferenceOwner===o.ownerUserId)return;
 preferenceBusy=true;try{const p=await msg('schedule-preferences');if(g!==generation||disposed||owner?.ownerUserId!==o.ownerUserId)return;
 if(p?.enabled!==false||![30,60,120].includes(p.intervalMinutes))return;
 $('auto-sync-interval').value=String(p.intervalMinutes);preferenceOwner=o.ownerUserId;$('auto-sync-interval').disabled=false;
 }catch{}finally{preferenceBusy=false;}
}
$('auto-sync-interval').onchange=async()=>{
 if(preferenceBusy||disposed||!owner||preferenceOwner!==owner.ownerUserId)return;
 const g=generation,o=owner,minutes=Number($('auto-sync-interval').value);preferenceBusy=true;$('auto-sync-interval').disabled=true;
 try{const p=await msg('schedule-interval',{intervalMinutes:minutes});if(g!==generation||disposed||owner?.ownerUserId!==o.ownerUserId)return;
 if(p?.enabled!==false||p.intervalMinutes!==minutes)throw Error('invalid_preference');
 $('auto-sync-status').textContent='间隔已保存；真实数据源尚未验收，不会自动请求。';
 }catch{if(g===generation&&!disposed){preferenceOwner=null;$('auto-sync-status').textContent='间隔保存失败，请重新打开页面。';}}
 finally{preferenceBusy=false;if(g===generation&&!disposed&&preferenceOwner===o.ownerUserId)$('auto-sync-interval').disabled=false;}
};
function hide(message){generation++;$('sync-diagnostic').hidden=true;$('diagnostic-text').textContent='';resetPreference();data=owner=null;people=[];selected=null;sourceReady=waiting=false;$('refresh').textContent='刷新';$('content').hidden=true;$('ranking').replaceChildren();$('detail').replaceChildren();$('export').disabled=$('clear').disabled=true;$('owner').textContent='未确认账号';$('status').textContent=message;}
async function guard(){const g=generation,o=owner;if(!o||disposed)return false;try{const i=await msg('identity');if(g!==generation)return false;if(i.ownerUserId!==o.ownerUserId||i.handle!==o.handle)throw Error('identity_changed');return true;}catch{if(g===generation)hide('账号或原 X 页面已变化，请从侧边栏重新打开。');return false;}}
function details(reset=true){if(reset){offset=0;$('detail').replaceChildren();}if(!data||!selected)return;const rows=interactionDetails(data,selected,settings());for(const e of rows.slice(offset,offset+PAGE)){const li=node('li',labels[e.type]+' · '+(e.occurredAt===null?'时间未知':new Date(e.occurredAt).toLocaleString()));const id=e.eventPostId??e.targetPostId;if(id){const a=node('a',' 查看原帖');a.href='https://x.com/i/web/status/'+id;a.target='_blank';a.rel='noopener noreferrer';li.append(a);}$('detail').append(li);}offset+=PAGE;$('more').hidden=offset>=rows.length;}
function render(){if(!data)return;const v=analyzeLiveDataset(data,settings());people=v.people;page=Math.min(page,Math.max(0,Math.ceil(people.length/PAGE)-1));const sum=people.reduce((a,p)=>({count:a.count+p.count,reply:a.reply+p.byType.reply,like:a.like+p.byType.like}),{count:0,reply:0,like:0});
 for(const [id,value] of [['people-count',people.length],['event-count',sum.count],['reply-count',sum.reply],['like-count',sum.like]])$(id).textContent=value.toLocaleString();
 $('ranking').replaceChildren();for(const [i,p] of people.slice(page*PAGE,(page+1)*PAGE).entries()){
  const li=node('li','');li.className='rank-row';const center=node('div',''),b=node('button',p.handle?'@'+p.handle:p.userId);b.className='link';b.onclick=async()=>{if(!await guard())return;selected=p.userId;$('detail-title').textContent=b.textContent+' · 互动明细';$('detail-empty').hidden=true;details();};
  const info=node('div',Object.entries(labels).map(([k,v])=>v+' '+p.byType[k]).join(' · '));info.className='muted';const bar=node('div',''),fill=node('span','');bar.className='bar';fill.style.width=(100*p.count/Math.max(1,people[0]?.count??1))+'%';bar.append(fill);center.append(b,info,bar);const n=node('span',String(p.count));n.className='count';li.append(node('span',String(page*PAGE+i+1)),center,n);$('ranking').append(li);
 }
 $('empty').hidden=people.length>0;$('pagination').hidden=people.length<=PAGE;$('page').textContent=(page+1)+' / '+Math.max(1,Math.ceil(people.length/PAGE));$('prev').disabled=page===0;$('next').disabled=(page+1)*PAGE>=people.length;$('export').disabled=!people.length;
 const sourceNames={notification:'通知',post:'帖子',archive:'归档','authorized-api':'授权接口'};
 const coverage=v.coverage.map(c=>(sourceNames[c.source]??'其他来源')+'：'+c.uniqueEvents+' 条，'+new Date(c.lastObservedAt).toLocaleString()).join('；');
 const jobs=v.jobs.map(j=>{const q=j.quality;return (sourceNames[j.source]??'其他来源')+' · '+(j.done?'已到本次来源末尾':'尚未完成')+' · '+j.pages+' 页'+(q&&j.qualityPages?'（不支持 '+q.unsupported+'，未确认参与者 '+q.unresolvedActors+'，其他账号目标 '+q.foreignTargets+'，排除 '+q.ignored+'）':'（质量统计缺失）');}).join('；');
 $('quality').textContent='已存 '+v.stored+' 条，未知时间 '+v.unknownTime+' 条（日期筛选排除 '+v.excludedUnknownTime+' 条）。未知时间不等于没有互动。'+(coverage?' 来源记录：'+coverage+'。':' 暂无来源覆盖记录。')+(jobs?' 来源任务：'+jobs+'。':' 暂无同步检查点。')+' 非完整历史。';
}
async function load(action='view',extra={}){if(busy||disposed)return;busy=true;$('refresh').disabled=true;const g=++generation;try{const v=await msg(action,extra);if(g!==generation)return;if(v.busy||v.running){if(owner&&(v.identity?.ownerUserId!==owner.ownerUserId||v.identity?.handle!==owner.handle)){hide('账号已变化，请重新打开。');return;}waiting=true;$('status').textContent=v.running?'后台同步进行中 · 本次已提交 '+(v.task?.pages??0)+' 页，新增 '+(v.task?.inserted??0)+' 条。'+taskSuffix(v.task):'后台正在处理其他任务。';$('refresh').textContent=v.running?'停止':'刷新';$('clear').disabled=true;return;}waiting=false;sourceReady=v.sourceReady===true;$('refresh').textContent='刷新';if(!v.dataset||v.dataset.ownerUserId!==v.identity?.ownerUserId)throw Error('identity_changed');
 if(owner?.ownerUserId!==v.identity.ownerUserId)resetPreference();
 owner=v.identity;void loadPreference();data=v.dataset;page=0;selected=null;$('detail').replaceChildren();$('detail-title').textContent='互动明细';$('detail-empty').hidden=false;$('more').hidden=true;
 $('owner').textContent='@'+owner.handle;$('source-note').textContent=v.sourceReady?'本地存储；后台同步需授权。':'当前仅支持读取已有本地缓存，实时后台数据源尚未接入。';$('status').textContent=v.sourceReady?(syncStatus[v.task?.state==='interrupted'?'interrupted':v.task?.reason]??(v.task?.reason?'同步未完成，已有记录保留':'本地缓存'))+taskSuffix(v.task):'本地缓存 · 实时同步尚未接入';const diagnostic=diagnosticSummary(v.task);$('diagnostic-text').textContent=diagnostic;$('sync-diagnostic').hidden=!diagnostic;$('content').hidden=false;$('clear').disabled=false;render();
 }catch{if(g===generation)hide('无法确认当前 X 账号。请从已登录的 X 页面侧边栏打开。');}finally{busy=false;$('refresh').disabled=actionBusy||disposed;}}
 async function runAction(fn){
  if(busy||actionBusy||disposed)return;
  actionBusy=true;$('refresh').disabled=true;$('clear').disabled=true;
  try{await fn();}finally{actionBusy=false;if(!disposed){$('refresh').disabled=busy;$('clear').disabled=!owner||waiting;}}
 }
 $('refresh').onclick=()=>runAction(async()=>{
  if(waiting){if($('refresh').textContent==='停止'){try{await msg('stop');await load();}catch{if(!disposed)$('status').textContent='停止请求失败，请重新确认任务状态。';}}else await load();return;}
  if(!sourceReady||!owner)return load();
  if(!await guard()||disposed)return;
  if(!confirm('同步当前 X 账号的互动数据？仅通过已授权的数据源，记录保存在本机。'))return;
  try{await msg('sync',{authorized:true});if(!disposed){waiting=true;await load();}}catch{if(!disposed)$('status').textContent='同步暂不可用，已有缓存保留。';}
 });
 $('clear').onclick=()=>runAction(async()=>{if(!waiting&&await guard()&&!disposed&&confirm('清除当前 X 账号本地互动记录？'))await load('clear',{confirmed:true});});
 $('export').onclick=async()=>{if(!await guard())return;const url=URL.createObjectURL(new Blob(['\uFEFF'+rankingCsv(people)],{type:'text/csv;charset=utf-8'})),a=node('a','');a.href=url;a.download='interaction-ranking.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 for(const id of ['search','type','days','sort'])$(id).addEventListener(id==='search'?'input':'change',async()=>{if(!await guard())return;page=0;selected=null;$('detail').replaceChildren();$('detail-title').textContent='互动明细';$('detail-empty').hidden=false;$('more').hidden=true;render();});
 $('prev').onclick=async()=>{if(await guard()&&page>0){page--;render();}};$('next').onclick=async()=>{if(await guard()&&(page+1)*PAGE<people.length){page++;render();}};$('more').onclick=async()=>{if(await guard())details(false);};
 const timer=setInterval(()=>{if(!busy&&!actionBusy&&!disposed&&document.visibilityState==='visible'){if(waiting)void load();else if(owner)void guard();}},1500);
 window.addEventListener('pagehide',()=>{disposed=true;clearInterval(timer);generation++;},{once:true});
 // A newly created inactive tab can finish loading before its binding is saved.
 (async()=>{await new Promise(r=>setTimeout(r,150));await load();})();
