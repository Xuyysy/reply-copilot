import {analyzeLiveDataset,interactionDetails} from '../interaction-manager/analytics/live-view.js';
import {rankingCsv} from '../interaction-manager/ui/csv.js';
const $=id=>document.getElementById(id),PAGE=50;
const labels={like:'点赞',reply:'回复',repost:'转发',quote:'引用',mention:'提及'};
let data=null,owner=null,people=[],page=0,selected=null,offset=0,busy=false,generation=0;
const msg=async(action,extra={})=>{const r=await chrome.runtime.sendMessage({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra});if(!r?.ok)throw Error(r?.error??'source_error');return r.value;};
const settings=()=>({direction:'inbound',type:$('type').value,days:$('days').value?Number($('days').value):null,sort:$('sort').value,query:$('search').value});
const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
function hide(message){generation++;data=owner=null;people=[];selected=null;$('content').hidden=true;$('ranking').replaceChildren();$('detail').replaceChildren();$('export').disabled=$('clear').disabled=true;$('owner').textContent='未确认账号';$('status').textContent=message;}
async function guard(){const g=generation,o=owner;if(!o)return false;try{const i=await msg('identity');if(g!==generation)return false;if(i.ownerUserId!==o.ownerUserId||i.handle!==o.handle)throw Error('identity_changed');return true;}catch{if(g===generation)hide('账号或原 X 页面已变化，请从侧边栏重新打开。');return false;}}
function details(reset=true){if(reset){offset=0;$('detail').replaceChildren();}if(!data||!selected)return;const rows=interactionDetails(data,selected,settings());for(const e of rows.slice(offset,offset+PAGE)){const li=node('li',labels[e.type]+' · '+(e.occurredAt===null?'时间未知':new Date(e.occurredAt).toLocaleString()));const id=e.eventPostId??e.targetPostId;if(id){const a=node('a',' 查看原帖');a.href='https://x.com/i/web/status/'+id;a.target='_blank';a.rel='noopener noreferrer';li.append(a);}$('detail').append(li);}offset+=PAGE;$('more').hidden=offset>=rows.length;}
function render(){if(!data)return;const v=analyzeLiveDataset(data,settings());people=v.people;page=Math.min(page,Math.max(0,Math.ceil(people.length/PAGE)-1));const sum=people.reduce((a,p)=>({count:a.count+p.count,reply:a.reply+p.byType.reply,like:a.like+p.byType.like}),{count:0,reply:0,like:0});
 for(const [id,value] of [['people-count',people.length],['event-count',sum.count],['reply-count',sum.reply],['like-count',sum.like]])$(id).textContent=value.toLocaleString();
 $('ranking').replaceChildren();for(const [i,p] of people.slice(page*PAGE,(page+1)*PAGE).entries()){
  const li=node('li','');li.className='rank-row';const center=node('div',''),b=node('button',p.handle?'@'+p.handle:p.userId);b.className='link';b.onclick=async()=>{if(!await guard())return;selected=p.userId;$('detail-title').textContent=b.textContent+' · 互动明细';$('detail-empty').hidden=true;details();};
  const info=node('div',Object.entries(labels).map(([k,v])=>v+' '+p.byType[k]).join(' · '));info.className='muted';const bar=node('div',''),fill=node('span','');bar.className='bar';fill.style.width=(100*p.count/Math.max(1,people[0]?.count??1))+'%';bar.append(fill);center.append(b,info,bar);const n=node('span',String(p.count));n.className='count';li.append(node('span',String(page*PAGE+i+1)),center,n);$('ranking').append(li);
 }
 $('empty').hidden=people.length>0;$('pagination').hidden=people.length<=PAGE;$('page').textContent=(page+1)+' / '+Math.max(1,Math.ceil(people.length/PAGE));$('prev').disabled=page===0;$('next').disabled=(page+1)*PAGE>=people.length;$('export').disabled=!people.length;
 $('quality').textContent='已存 '+v.stored+' 条，未知时间 '+v.unknownTime+' 条（日期筛选排除 '+v.excludedUnknownTime+' 条）。'+v.coverage.map(c=>c.source+'：'+c.uniqueEvents+' 条，'+new Date(c.lastObservedAt).toLocaleString()).join('；')+'。非完整历史。';
}
async function load(action='view',extra={}){if(busy)return;busy=true;$('refresh').disabled=true;const g=++generation;try{const v=await msg(action,extra);if(g!==generation)return;if(v.running){$('status').textContent='后台同步进行中，已保存的进度不会丢失。';return;}if(!v.dataset||v.dataset.ownerUserId!==v.identity?.ownerUserId)throw Error('identity_changed');
 owner=v.identity;data=v.dataset;page=0;selected=null;$('detail').replaceChildren();$('detail-title').textContent='互动明细';$('detail-empty').hidden=false;$('more').hidden=true;
 $('owner').textContent='@'+owner.handle;$('source-note').textContent=v.sourceReady?'本地存储；后台同步需授权。':'当前仅支持读取已有本地缓存，实时后台数据源尚未接入。';$('status').textContent=v.sourceReady?'本地缓存':'本地缓存 · 实时同步尚未接入';$('content').hidden=false;$('clear').disabled=false;render();
 }catch{if(g===generation)hide('无法确认当前 X 账号。请从已登录的 X 页面侧边栏打开。');}finally{busy=false;$('refresh').disabled=false;}}
 $('refresh').onclick=()=>load();$('clear').onclick=async()=>{if(await guard()&&confirm('清除当前 X 账号本地互动记录？'))void load('clear',{confirmed:true});};
 $('export').onclick=async()=>{if(!await guard())return;const url=URL.createObjectURL(new Blob(['\uFEFF'+rankingCsv(people)],{type:'text/csv;charset=utf-8'})),a=node('a','');a.href=url;a.download='interaction-ranking.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 for(const id of ['search','type','days','sort'])$(id).addEventListener(id==='search'?'input':'change',async()=>{if(!await guard())return;page=0;selected=null;$('detail').replaceChildren();$('detail-title').textContent='互动明细';$('detail-empty').hidden=false;$('more').hidden=true;render();});
 $('prev').onclick=async()=>{if(await guard()&&page>0){page--;render();}};$('next').onclick=async()=>{if(await guard()&&(page+1)*PAGE<people.length){page++;render();}};$('more').onclick=async()=>{if(await guard())details(false);};
 const timer=setInterval(()=>{if(!busy&&owner&&document.visibilityState==='visible')void guard();},1500);
 window.addEventListener('pagehide',()=>{clearInterval(timer);generation++;},{once:true});
 // A newly created inactive tab can finish loading before its binding is saved.
 (async()=>{await new Promise(r=>setTimeout(r,150));await load();})();
