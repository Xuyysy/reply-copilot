import {Workspace} from './workspace.js';
import {MAX_FILE_BYTES} from './import.js';
const $=id=>document.getElementById(id);
let ws,working=false,page=0,people=[],detailRows=[],detailOffset=0;
const PAGE=50,types={reply:'回复',like:'点赞',repost:'转发',quote:'引用',mention:'提及'};
const status=text=>$('status').textContent=text;
function options(){return {direction:$('direction').value,days:$('days').value?Number($('days').value):null,sort:$('sort').value};}
function setControls(){const ready=!!ws?.session;for(const id of ['file','import','clear','direction','days','sort','search'])$(id).disabled=working||!ready;$('owner').disabled=working;$('owner-form').querySelector('button').disabled=working;}
async function task(fn){if(working)return;working=true;setControls();try{await fn();}catch(e){status('操作未完成：'+String(e?.message??'未知错误').slice(0,120)+'。已提交的批次可能保留；可重新导入去重。');if(e?.message==='stale_session'){ws.session=null;people=[];render();clearDetails();$('summary').textContent='资料会话已失效，请重新选择。';$('active-owner').textContent='尚未选择';$('coverage').replaceChildren();}}finally{working=false;setControls();}}
function clearDetails(){detailRows=[];detailOffset=0;$('details').replaceChildren();$('detail-title').textContent='点击排行榜用户 ID 查看记录。';$('more-details').hidden=true;}
function appendDetails(){
  for(const e of detailRows.slice(detailOffset,detailOffset+50)){
    const li=document.createElement('li');
    li.textContent=types[e.type]+' · '+(e.direction==='inbound'?'收到':'发出')+' · '+(e.occurredAt===null?'时间未知':new Date(e.occurredAt).toLocaleString())+' · '+e.sources.join(', ')+' ';
    const id=e.eventPostId??e.targetPostId;
    if(id){const a=document.createElement('a');a.href='https://x.com/i/web/status/'+id;a.textContent='查看原帖';a.target='_blank';a.rel='noopener noreferrer';li.append(a);}
    $('details').append(li);
  }
  detailOffset+=50;$('more-details').hidden=detailOffset>=detailRows.length;
}
function render(){
  const q=$('search').value.trim(),filtered=people.filter(p=>!q||p.userId.includes(q));
  page=Math.min(page,Math.max(0,Math.ceil(filtered.length/PAGE)-1));
  $('ranking').replaceChildren();
  for(const p of filtered.slice(page*PAGE,(page+1)*PAGE)){
    const tr=document.createElement('tr'),td=document.createElement('td'),btn=document.createElement('button');
    btn.textContent=p.userId;btn.type='button';btn.onclick=()=>task(async()=>{clearDetails();detailRows=await ws.details(p.userId,options());$('detail-title').textContent=p.userId+' · '+detailRows.length+' 条';appendDetails();});
    td.append(btn);tr.append(td);
    for(const v of [p.count,p.inbound,p.outbound,p.byType.reply,p.byType.like,p.byType.repost,p.byType.quote,p.byType.mention]){const cell=document.createElement('td');cell.textContent=String(v);tr.append(cell);}
    $('ranking').append(tr);
  }
  $('page').textContent=filtered.length?'第 '+(page+1)+' / '+Math.ceil(filtered.length/PAGE)+' 页':'无结果';
  $('previous').disabled=page===0;$('next').disabled=(page+1)*PAGE>=filtered.length;
}
async function refresh(){
  clearDetails();page=0;const v=await ws.view(options());people=v.people;
  $('summary').textContent='本地 '+v.stored+' 条确认记录 · 当前排名 '+people.length+' 人 · 时间未知 '+v.unknownTime+' 条（本时间筛选排除 '+v.excludedUnknownTime+' 条）';
  $('coverage').replaceChildren();for(const c of v.coverage){const li=document.createElement('li');li.textContent=c.source+'：已观察 '+c.uniqueEvents+' 条，最近读取 '+new Date(c.lastObservedAt).toLocaleString()+'；覆盖不完整';$('coverage').append(li);}render();
}
$('owner-form').addEventListener('submit',e=>{e.preventDefault();task(async()=>{people=[];render();clearDetails();$('coverage').replaceChildren();$('summary').textContent='正在打开资料';await ws.select($('owner').value.trim());$('active-owner').textContent='离线资料账号：'+ws.session.ownerUserId;status('资料已打开。');await refresh();});});
$('import').onclick=()=>task(async()=>{const file=$('file').files[0];if(!file)throw Error('请选择 JSON 文件');if(file.size>MAX_FILE_BYTES)throw Error('文件超过 8 MiB');const r=await ws.importText(await file.text());status('导入新增 '+r.inserted+' 条，识别 '+r.accepted+' 条。未识别或外部目标不计入。');await refresh();});
for(const id of ['direction','days','sort'])$(id).onchange=()=>task(refresh);
$('search').oninput=()=>{page=0;render();};
$('previous').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};$('more-details').onclick=appendDetails;
$('clear').onclick=()=>{if(confirm('仅删除当前离线资料账号的互动记录？'))task(async()=>{await ws.clear();status('当前资料已清除。');await refresh();});};
setControls();Workspace.open().then(w=>{ws=w;setControls();}).catch(()=>status('无法打开本地数据库。'));
