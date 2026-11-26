import {openInteractionDB,beginSession,endSession,clearOwner,readOwnerDataset} from '../interaction-manager/storage/repository.js';
import {syncInteractions} from '../interaction-manager/sync/engine.js';
import {analyzeLiveDataset,interactionDetails} from '../interaction-manager/analytics/live-view.js';
import {rankingCsv} from '../interaction-manager/ui/csv.js';
const root=document.getElementById('interaction-interface');
if(root){
 const get=id=>root.querySelector('#'+id);let running=null,db=null,displayedTabId=null,displayedOwner=null,displayTask=null,data=null,people=[],page=0,selected=null,detailOffset=0;
 const PAGE=50,TYPES={like:'点赞',repost:'转发',reply:'回复',quote:'引用',mention:'提及'};
 const status=t=>get('interface-status').textContent=t;
 const controls=()=>{for(const id of ['interface-sync','interface-refresh','interface-cached','interface-clear'])get(id).disabled=!!running||!get('interface-authorized').checked;get('interface-stop').disabled=!running;for(const id of ['interface-type','interface-days','interface-sort','interface-search'])get(id).disabled=!!running||!data;get('interface-export').disabled=!!running||!data||!people.length;get('interface-prev').disabled=!!running||page===0;get('interface-next').disabled=!!running||(page+1)*PAGE>=people.length;};
 const closeTask=task=>{if(!task)return;task.controller.abort();if(task.sessionId)void chrome.tabs.sendMessage(task.tabId,{type:'XRH_STAGING_INTERACTION_INTERFACE',action:'cancel',sessionId:task.sessionId}).catch(()=>{});};
 const wipe=()=>{const old=displayTask;displayTask=null;closeTask(old);displayedTabId=null;displayedOwner=null;data=null;people=[];page=0;selected=null;detailOffset=0;for(const id of ['interface-results','interface-detail','interface-coverage','interface-summary','interface-page'])get(id).replaceChildren();get('interface-more').hidden=true;controls();};
 function stop(){closeTask(running);}
 async function currentTab(){const [t]=await chrome.tabs.query({active:true,currentWindow:true});if(!Number.isInteger(t?.id))throw Error('open_notifications');return t.id;}
 async function message(task,action,extra={}){
   if(task.controller.signal.aborted||await currentTab()!==task.tabId||task.controller.signal.aborted)throw Error('cancelled');
   const r=await chrome.tabs.sendMessage(task.tabId,{type:'XRH_STAGING_INTERACTION_INTERFACE',action,sessionId:task.sessionId,...extra});
   if(action==='start'&&r?.ok&&typeof r.value?.sessionId==='string')task.sessionId=r.value.sessionId;
   if(task.controller.signal.aborted||await currentTab()!==task.tabId||task.controller.signal.aborted){closeTask(task);throw Error('cancelled');}
   if(!r?.ok)throw Error(r?.error??'source_error');return r.value;
 }
 // Only local extension identity messages while a cached view is displayed. No X requests.
 async function guardDisplay(){
   const task=displayTask;if(!task||!data||running)return false;
   if(!task.check){task.check=(async()=>{let timer;try{
     const i=await Promise.race([message(task,'identity'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('identity_changed')),1500);})]);
     if(task!==displayTask||!data)return false;
     if(i.ownerUserId!==displayedOwner||i.sessionId!==task.sessionId||i.handle!==task.handle)throw Error('identity_changed');
     return true;
   }catch{if(task===displayTask){wipe();status('账号或页面已变化，请重新打开本地排行榜。');}return false;}
   finally{clearTimeout(timer);task.check=null;}})();}
   return task.check;
 }
 const safeView=fn=>async()=>{const task=displayTask;if(await guardDisplay()&&task===displayTask&&!running)fn();};
 const ERROR_TEXT={cancelled:'已取消',time_limit:'本次时间上限',source_exhausted:'当前来源已结束',page_limit:'本次分页上限',rate_limited:'接口限流，请稍后手动继续',owner_unverified:'未确认当前账号',identity_changed:'账号或页面变化',owner_mismatch:'账号不匹配',unauthenticated:'登录状态失效',forbidden:'访问被拒绝',endpoint_not_observed:'未识别通知接口，请刷新全部通知页',open_notifications:'请打开已登录的全部通知页',schema_changed:'响应结构不受支持',terminal_unverified:'无法确认分页终点',ambiguous_cursor:'分页证据冲突',cursor_cycle:'分页游标重复',workspace_limit:'本地记录达到上限',history_limit:'历史分页上限',session_limit:'本次会话已停止',source_error:'接口或本地消息错误',sync_failed:'同步未完成'};
 const errorLabel=code=>Object.hasOwn(ERROR_TEXT,code)?ERROR_TEXT[code]+'（'+code+'）':'操作未完成（unknown_error）';
 const settings=()=>({direction:'inbound',days:get('interface-days').value?Number(get('interface-days').value):null,type:get('interface-type').value,sort:get('interface-sort').value,query:get('interface-search').value});
 const add=(parent,tag,text)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
 function resetDetail(){selected=null;detailOffset=0;get('interface-detail').replaceChildren();get('interface-more').hidden=true;}
 function moreDetail(){
   if(!data||!selected)return;
   const rows=interactionDetails(data,selected,settings()),parent=get('interface-detail');
   for(const e of rows.slice(detailOffset,detailOffset+PAGE)){
     const li=add(parent,'li',TYPES[e.type]+' · '+(e.occurredAt===null?'时间未知':new Date(e.occurredAt).toLocaleString())+' ');
     const id=e.eventPostId??e.targetPostId;
     if(id){const a=add(li,'a','原帖');a.href='https://x.com/i/web/status/'+id;a.target='_blank';a.rel='noopener noreferrer';}
   }
   detailOffset+=PAGE;get('interface-more').hidden=detailOffset>=rows.length;
 }
 function render(){
   if(!data)return;
   const v=analyzeLiveDataset(data,settings());people=v.people;page=Math.min(page,Math.max(0,Math.ceil(people.length/PAGE)-1));
   get('interface-summary').textContent='已存 '+v.stored+' 条 · 当前筛选 '+people.length+' 人 · 时间未知 '+v.unknownTime+' 条（日期筛选排除 '+v.excludedUnknownTime+' 条）';
   const parent=get('interface-results');parent.replaceChildren();
   for(const [i,p] of people.slice(page*PAGE,(page+1)*PAGE).entries()){
     const li=document.createElement('li'),btn=add(li,'button',(page*PAGE+i+1)+'. '+(p.handle?'@'+p.handle:p.userId));
     btn.type='button';btn.title='X ID '+p.userId;btn.onclick=safeView(()=>{resetDetail();selected=p.userId;moreDetail();});
     li.append(document.createTextNode(' · '+p.count+' 条（回复 '+p.byType.reply+'，点赞 '+p.byType.like+'，转发 '+p.byType.repost+'，引用 '+p.byType.quote+'，提及 '+p.byType.mention+'） '));
     const a=add(li,'a','主页');a.href='https://x.com/i/user/'+p.userId;a.target='_blank';a.rel='noopener noreferrer';parent.append(li);
   }
   get('interface-page').textContent=people.length?(page+1)+' / '+Math.ceil(people.length/PAGE):'无结果';
   const coverage=get('interface-coverage');coverage.replaceChildren();
   for(const c of v.coverage)add(coverage,'li',c.source+' · '+c.uniqueEvents+' 条 · '+new Date(c.lastObservedAt).toLocaleString()+' · 非完整历史');
   for(const j of v.jobs){add(coverage,'li',j.providerId+' · '+j.pages+' 页 · '+(j.done?'来源已结束':'可继续同步'));if(j.quality)add(coverage,'li','已记录 '+(j.qualityPages??0)+' / '+j.pages+' 页的扫描观察：未支持/跳过 '+(j.quality.unsupported+j.quality.ignored)+' · 无法确认参与者 '+j.quality.unresolvedActors+' · 非本人目标 '+j.quality.foreignTargets+'（不计入互动次数）');}
   controls();
 }
 async function run(mode){
   if(running||!get('interface-authorized').checked)return;
   const task={tabId:null,sessionId:null,controller:new AbortController()};running=task;wipe();
   try{
     task.tabId=await currentTab();const i=await message(task,'start',{authorized:true,readOnly:mode==='cached'||mode==='clear'});task.sessionId=i.sessionId;
     db??=await openInteractionDB();
     const provider={id:'web-'+i.kind,identify:()=>message(task,'identity'),readPage:({ownerUserId,cursor})=>message(task,'page',{ownerUserId,cursor})};
     let result=null;
     if(mode==='sync'||mode==='refresh'){
       status('@'+i.handle+' · 正在同步已授权通知接口...');
       result=await syncInteractions(db,provider,{ownerUserId:i.ownerUserId,refresh:mode==='refresh',maxPages:30,maxMs:90000,signal:task.controller.signal,onProgress:p=>status('@'+i.handle+' · 已提交 '+p.pages+' 页，新增 '+p.inserted+' 条')});
       if(task.controller.signal.aborted)throw Error('cancelled');
       if(['identity_changed','owner_mismatch','unauthenticated','forbidden'].includes(result.reason))throw Error(result.reason);
     }
     const verified=await provider.identify();if(verified.ownerUserId!==i.ownerUserId||verified.sessionId!==i.sessionId)throw Error('identity_changed');
     const session=await beginSession(db,i.ownerUserId);
     try{
       if(mode==='clear'){const current=await provider.identify();if(current.ownerUserId!==i.ownerUserId||current.sessionId!==i.sessionId)throw Error('identity_changed');await clearOwner(db,session);status('当前账号本地接口数据已清除。');return;}
       const snapshot=await readOwnerDataset(db,session);
       const again=await provider.identify();if(again.ownerUserId!==i.ownerUserId||again.sessionId!==i.sessionId)throw Error('identity_changed');
       // Downgrade the display session to read-only before retaining the cached view.
       const local=await message(task,'start',{authorized:true,readOnly:true});
       if(local.ownerUserId!==i.ownerUserId||local.handle!==i.handle||local.kind!==null)throw Error('identity_changed');
       task.handle=local.handle;displayTask=task;data=snapshot;displayedTabId=task.tabId;displayedOwner=i.ownerUserId;
       status('@'+i.handle+' · '+(result?'停止原因 '+errorLabel(result.reason)+'；本次新增 '+result.inserted+' 条；':'本地缓存；')+'仅已观察的互动，非完整历史。');
       render();
     }finally{await endSession(db,session);}
   }catch(e){wipe();status('已停止：'+errorLabel(e?.message)+'。已提交的数据保留，可用本地排行榜查看。');}
   finally{if(displayTask!==task)closeTask(task);running=null;controls();}
 }
 // Export requires a fresh, local, read-only identity check. No request to X.
 async function exportRows(){
   if(running||!data||!people.length||!get('interface-authorized').checked)return;
   if(!await guardDisplay())return;
   const expectedOwner=displayedOwner,task=displayTask;if(!task||!data||running)return;
   running=task;controls();
   try{
     if(data.ownerUserId!==expectedOwner)throw Error('identity_changed');
     const content=rankingCsv(analyzeLiveDataset(data,settings()).people);
     const url=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'}));
     const a=document.createElement('a');a.href=url;a.download='interaction-ranking-'+expectedOwner+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }catch{wipe();status('账号或页面已变化，请重新打开本地排行榜。');}
   finally{running=null;controls();}
 }
 get('interface-authorized').onchange=()=>{if(!get('interface-authorized').checked){stop();wipe();}controls();};
 get('interface-sync').onclick=()=>run('sync');get('interface-refresh').onclick=()=>run('refresh');get('interface-cached').onclick=()=>run('cached');
 get('interface-clear').onclick=()=>{if(confirm('清除当前 X 账号的接口同步本地数据？'))void run('clear');};get('interface-stop').onclick=stop;
 for(const id of ['interface-type','interface-days','interface-sort','interface-search'])get(id).addEventListener(id==='interface-search'?'input':'change',safeView(()=>{page=0;resetDetail();render();}));
 get('interface-prev').onclick=safeView(()=>{if(page>0){page--;resetDetail();render();}});get('interface-next').onclick=safeView(()=>{if((page+1)*PAGE<people.length){page++;resetDetail();render();}});get('interface-more').onclick=safeView(moreDetail);get('interface-export').onclick=exportRows;
 chrome.tabs.onActivated.addListener(()=>{stop();wipe();status('标签页已切换。');});
 chrome.tabs.onUpdated.addListener((id,c)=>{if(c.status==='loading'&&(running?.tabId===id||displayedTabId===id)){stop();wipe();status('页面已重新加载，请重新确认账号。');}});
 chrome.tabs.onRemoved.addListener(id=>{if(running?.tabId===id||displayedTabId===id){stop();wipe();status('通知标签页已关闭。');}});
 const guardTimer=setInterval(()=>{if(document.visibilityState==='visible'&&displayTask&&!running)void guardDisplay();},1500);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&displayTask&&!running)void guardDisplay();});
 window.addEventListener('pagehide',()=>{clearInterval(guardTimer);stop();wipe();},{once:true});controls();
}
