import {openInteractionDB,beginSession,endSession,clearOwner} from '../interaction-manager/storage/repository.js';
import {syncInteractions,readSyncRanking} from '../interaction-manager/sync/engine.js';
const root=document.getElementById('interaction-interface');
if(root){
 const get=id=>root.querySelector('#'+id);let running=null,db=null,displayedTabId=null;
 const status=t=>get('interface-status').textContent=t;
 const controls=()=>{for(const id of ['interface-sync','interface-refresh','interface-cached','interface-clear'])get(id).disabled=!!running||!get('interface-authorized').checked;get('interface-stop').disabled=!running;};
 const wipe=()=>{displayedTabId=null;get('interface-results').replaceChildren();};
 function stop(){if(running){running.controller.abort();if(running.sessionId)void chrome.tabs.sendMessage(running.tabId,{type:'XRH_STAGING_INTERACTION_INTERFACE',action:'cancel',sessionId:running.sessionId}).catch(()=>{});}}
 async function currentTab(){const [t]=await chrome.tabs.query({active:true,currentWindow:true});if(!Number.isInteger(t?.id))throw Error('open_notifications');return t.id;}
 async function message(task,action,extra={}){
   if(task.controller.signal.aborted||await currentTab()!==task.tabId)throw Error('cancelled');
   const r=await chrome.tabs.sendMessage(task.tabId,{type:'XRH_STAGING_INTERACTION_INTERFACE',action,sessionId:task.sessionId,...extra});
   if(task.controller.signal.aborted||await currentTab()!==task.tabId)throw Error('cancelled');
   if(!r?.ok)throw Error(r?.error??'source_error');return r.value;
 }
 async function run(mode){
   if(running||!get('interface-authorized').checked)return;
   const task={tabId:null,sessionId:null,controller:new AbortController()};running=task;controls();wipe();
   try{
     task.tabId=await currentTab();const i=await message(task,'start',{authorized:true});task.sessionId=i.sessionId;
     db??=await openInteractionDB();
     const provider={id:'web-'+i.kind,identify:()=>message(task,'identity'),readPage:({ownerUserId,cursor})=>message(task,'page',{ownerUserId,cursor})};
     let result=null;
     if(mode==='sync'||mode==='refresh'){
       status('@'+i.handle+' · 正在同步已授权通知接口...');
       result=await syncInteractions(db,provider,{ownerUserId:i.ownerUserId,refresh:mode==='refresh',maxPages:30,maxMs:90000,signal:task.controller.signal,onProgress:p=>status('@'+i.handle+' · 已提交 '+p.pages+' 页，新增 '+p.inserted+' 条')});
       // Never display stale account data after cancellation or identity failure.
       if(task.controller.signal.aborted)throw Error('cancelled');
       if(['identity_changed','owner_mismatch','unauthenticated','forbidden'].includes(result.reason))throw Error(result.reason);
     }
     const verified=await provider.identify();if(verified.ownerUserId!==i.ownerUserId||verified.sessionId!==i.sessionId)throw Error('identity_changed');
     const session=await beginSession(db,i.ownerUserId);
     try{
       if(mode==='clear'){await clearOwner(db,session);status('当前账号本地接口数据已清除。');return;}
       const rank=await readSyncRanking(db,session,{direction:'inbound'});
       const again=await provider.identify();if(again.ownerUserId!==i.ownerUserId||again.sessionId!==i.sessionId)throw Error('identity_changed');
       status('@'+i.handle+' · '+(result?'停止原因 '+result.reason+'；本次新增 '+result.inserted+' 条；':'本地缓存；')+'已确认关系 '+rank.stored+' 条，排名 '+rank.people.length+' 人。非完整历史；聚合时间未知。');
       displayedTabId=task.tabId;
       for(const p of rank.people.slice(0,100)){
         const li=document.createElement('li'),a=document.createElement('a');
         a.href=p.handle?'https://x.com/'+p.handle:'https://x.com/i/user/'+p.userId;a.textContent=p.handle?'@'+p.handle:p.userId;a.target='_blank';a.rel='noopener noreferrer';
         li.append(a,document.createTextNode(' · '+p.count+' 条（回复 '+p.byType.reply+'，点赞 '+p.byType.like+'，转发 '+p.byType.repost+'，引用 '+p.byType.quote+'，提及 '+p.byType.mention+'）'));get('interface-results').append(li);
       }
     }finally{await endSession(db,session);}
   }catch(e){wipe();status('已停止：'+String(e?.message??'source_error').slice(0,80)+'。请确认已登录并刷新 X 全部通知页；已提交的数据保留。');}
   finally{if(task.sessionId)void chrome.tabs.sendMessage(task.tabId,{type:'XRH_STAGING_INTERACTION_INTERFACE',action:'cancel',sessionId:task.sessionId}).catch(()=>{});running=null;controls();}
 }
 get('interface-authorized').onchange=()=>{if(!get('interface-authorized').checked){stop();wipe();}controls();};
 get('interface-sync').onclick=()=>run('sync');get('interface-refresh').onclick=()=>run('refresh');get('interface-cached').onclick=()=>run('cached');
 get('interface-clear').onclick=()=>{if(confirm('清除当前 X 账号的接口同步本地数据？'))void run('clear');};
 get('interface-stop').onclick=stop;
 chrome.tabs.onActivated.addListener(()=>{stop();wipe();status('标签页已切换。');});
 chrome.tabs.onUpdated.addListener((id,c)=>{if(c.status==='loading'&&(running?.tabId===id||displayedTabId===id)){stop();wipe();status('页面已重新加载，请重新确认账号。');}});
 chrome.tabs.onRemoved.addListener(id=>{if(running?.tabId===id||displayedTabId===id){stop();wipe();status('通知标签页已关闭。');}});
 window.addEventListener('pagehide',stop,{once:true});controls();
}