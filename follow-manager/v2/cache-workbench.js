import {stableId} from "./model.js";
import {LIVE_SOURCE} from "./store.js";
import {buildCacheView,filterCacheView,cacheCsv} from "./cache-view.js";
import {CHANGE_LABELS,analyzeHistory,filterChanges,historyCsv} from "./history.js";
// Trusted extension caller must supply a local authenticated identity reader.
// This module has no standalone entry, no transport, no URL-selected account,
// and no ability to prove X login independently.
export async function mountAuthorizedCache({root,repo,ownerUserId,sessionId,readIdentity,download=saveCsv}){
 if(!root||!stableId(ownerUserId)||typeof sessionId!=="string"||!sessionId||typeof readIdentity!=="function"||!repo)throw Error("invalid_context");
 const d=root.ownerDocument,$=id=>root.querySelector("#"+id);
 root.innerHTML='<h2>互关名单 · 本地缓存</h2><p id="cache-status" role="status">核验账号…</p><div id="cache-content" hidden><div class="actions"><button id="cache-refresh">刷新缓存</button><select id="cache-mode" aria-label="名单版本"><option value="latest">最近完整名单</option><option value="progress">未完成进度</option></select></div><p id="cache-summary"></p><p id="cache-progress"></p><div class="actions"><select id="cache-kind" aria-label="关系"><option value="all">全部已读取</option><option value="followers">粉丝名单</option><option value="following">关注名单</option><option value="mutual">互关</option><option value="notFollowingBack">没回关我</option><option value="iHaveNotFollowedBack">我没回关</option><option value="protected">保护名单</option></select><input id="cache-query" type="search" placeholder="搜索用户名或昵称"><select id="cache-verified" aria-label="认证"><option value="all">全部认证</option><option value="blue">蓝 V</option><option value="notBlue">已知非蓝 V</option><option value="unknown">未知</option><option value="gold">金 V</option><option value="grey">灰 V</option></select><select id="cache-sort" aria-label="排序"><option value="followers">粉丝数</option><option value="following">关注数</option><option value="ratio">粉关比</option><option value="handle">用户名</option></select><label>最少粉丝 <input id="cache-min" type="number" min="0" step="1"></label><label>最多粉丝 <input id="cache-max" type="number" min="0" step="1"></label><label><input id="cache-hide" type="checkbox">隐藏保护账号</label></div><p id="cache-count"></p><ul id="cache-list"></ul><div class="actions"><button id="cache-prev">上一页</button><button id="cache-next">下一页</button><button id="cache-export">导出筛选名单</button></div><h3>历史变化</h3><p>仅比较同一账号的完整度校验通过的缓存；名单中消失不等同主动取关。</p><div class="actions"><select id="cache-newer" aria-label="较新快照"></select><select id="cache-older" aria-label="较早快照"></select><button id="cache-compare">比较</button><select id="cache-change-kind" aria-label="变化类型"><option value="all">全部变化</option></select><input id="cache-change-query" type="search" placeholder="搜索变化"></div><p id="cache-history-summary"></p><ul id="cache-history-list"></ul><div class="actions"><button id="cache-history-prev">上一页</button><button id="cache-history-next">下一页</button><button id="cache-history-export">导出变化</button></div></div>';
 let disposed=false,busy=false,data=null,state=null,users=[],page=0,report=null,changes=[],historyPage=0,timer;
 const node=(tag,text)=>{const e=d.createElement(tag);e.textContent=text;return e};
 const status=t=>$("cache-status").textContent=t;
 function clear(){data=state=report=null;users=[];changes=[];page=historyPage=0;$("cache-content").hidden=true;for(const id of ["cache-list","cache-history-list","cache-newer","cache-older"])$(id).replaceChildren();for(const id of ["cache-summary","cache-progress","cache-count","cache-history-summary"])$(id).textContent="";}
 function dispose(){if(disposed)return;disposed=true;clearInterval(timer);clear();status("账号会话已失效，请重新打开。");}
 async function verify(){
  if(disposed)throw Error("identity_changed");
  let i;try{i=await readIdentity()}catch{dispose();throw Error("identity_changed")}
  if(disposed||i?.source!==LIVE_SOURCE||i.ownerUserId!==ownerUserId||i.sessionId!==sessionId||i.identityEvidence!=="self_profile_and_session"){dispose();throw Error("identity_changed")}
 }
 const number=id=>$(id).value===""?null:Number($(id).value);
 function render(){
  if(!data||disposed)return;
  state=buildCacheView(data,ownerUserId,$("cache-mode").value);
  const s=state.summary;
  $("cache-summary").textContent=s?"粉丝 "+s.followers+" · 关注 "+s.following+" · 互关 "+s.mutual+(s.notFollowingBack===null?" · 未确认 "+s.unknown+"（部分名单，不判定未回关）":" · 没回关 "+s.notFollowingBack+" · 我没回关 "+s.iHaveNotFollowedBack)+" · "+(state.view.capturedAt??"未完成"):"暂无名单";
  const p=data.progress;$("cache-progress").textContent=p?"未完成任务："+p.status+"；关注 "+p.following.count+"/"+(p.following.expected??"未知")+"；粉丝 "+p.followers.count+"/"+(p.followers.expected??"未知"):"无未完成任务";
  const restricted=state.view?.completeness!=="complete";for(const o of $("cache-kind").options)if(["notFollowingBack","iHaveNotFollowedBack"].includes(o.value))o.disabled=restricted;
  if($("cache-kind").selectedOptions[0]?.disabled)$("cache-kind").value="all";
  users=filterCacheView(state,{kind:$("cache-kind").value,query:$("cache-query").value,verification:$("cache-verified").value,sort:$("cache-sort").value,minFollowers:number("cache-min"),maxFollowers:number("cache-max"),hideProtected:$("cache-hide").checked&&$("cache-kind").value!=="protected"});
  const last=Math.max(0,Math.ceil(users.length/50)-1);page=Math.min(page,last);
  $("cache-count").textContent=users.length+" 条 · "+(page+1)+"/"+(last+1)+(restricted?" · 仅已确认的关系，非完整名单":"");
  $("cache-prev").disabled=busy||page===0;$("cache-next").disabled=busy||page===last;$("cache-export").disabled=busy||!users.length;
  $("cache-list").replaceChildren(...users.slice(page*50,page*50+50).map(u=>{
   const li=node("li",(u.handle?"@"+u.handle:u.userId)+" · "+(u.displayName??"")+" · "+(u.followersCount??"未知")+" 粉丝 ");
   const b=node("button",state.protectedIds.has(u.userId)?"取消保护":"保护");b.type="button";b.disabled=busy;b.onclick=()=>act(async()=>{await repo.setProtected(ownerUserId,u.userId,!state.protectedIds.has(u.userId));await load();});li.append(b);return li;
  }));
 }
 function renderHistory(){
  if(disposed)return;changes=filterChanges(report?.rows??[],$("cache-change-kind").value,$("cache-change-query").value);historyPage=Math.min(historyPage,Math.max(0,Math.ceil(changes.length/50)-1));
  $("cache-history-summary").textContent=report?changes.length+" 条变化 · "+(historyPage+1)+"/"+Math.max(1,Math.ceil(changes.length/50)):"尚未比较";
  $("cache-history-list").replaceChildren(...changes.slice(historyPage*50,historyPage*50+50).map(r=>node("li",CHANGE_LABELS[r.kind]+" · "+(r.handle?"@"+r.handle:r.userId))));
  $("cache-history-prev").disabled=busy||historyPage===0;$("cache-history-next").disabled=busy||(historyPage+1)*50>=changes.length;$("cache-history-export").disabled=busy||!changes.length;
 }
 async function load(){
  const next=await repo.readDashboard(ownerUserId);await verify();data=next;page=0;report=null;historyPage=0;
  for(const id of ["cache-newer","cache-older"]){$(id).replaceChildren(...data.history.map(m=>{const o=node("option",new Date(m.capturedAt).toLocaleString()+" · 粉丝 "+m.followers);o.value=m.snapshotId;return o;}));}
  if(data.history.length>=2)$("cache-older").selectedIndex=1;
  $("cache-compare").disabled=data.history.length<2;$("cache-content").hidden=false;status("本地缓存 · 当前已核对账号会话（非在线实时数据）");render();renderHistory();
 }
 async function act(fn){if(busy||disposed)return;busy=true;try{await verify();await fn();await verify();}catch(e){if(!disposed)status("操作失败，请刷新缓存。");}finally{busy=false;if(data&&!disposed){render();renderHistory();}}}
 for(const id of ["cache-mode","cache-kind","cache-query","cache-verified","cache-sort","cache-min","cache-max","cache-hide"])$(id).oninput=()=>act(async()=>{page=0});
 $("cache-refresh").onclick=()=>act(load);$("cache-prev").onclick=()=>act(async()=>{page--});$("cache-next").onclick=()=>act(async()=>{page++});
 $("cache-export").onclick=()=>act(async()=>{if(users.length)await download("follow-cache.csv",cacheCsv(state,users));});
 for(const [k,v] of Object.entries(CHANGE_LABELS)){const o=node("option",v);o.value=k;$("cache-change-kind").append(o);}
 for(const id of ["cache-newer","cache-older"])$(id).onchange=()=>act(async()=>{report=null;historyPage=0});
 for(const id of ["cache-change-kind","cache-change-query"])$(id).oninput=()=>act(async()=>{historyPage=0});
 $("cache-compare").onclick=()=>act(async()=>{const pair=await repo.readHistoryPair(ownerUserId,$("cache-newer").value,$("cache-older").value);await verify();if(pair.current.source!==LIVE_SOURCE||pair.prior.source!==LIVE_SOURCE||pair.current.ownerUserId!==ownerUserId||pair.prior.ownerUserId!==ownerUserId)throw Error("invalid_source");report=analyzeHistory(pair.current,pair.prior);historyPage=0;});
 $("cache-history-prev").onclick=()=>act(async()=>{historyPage--});$("cache-history-next").onclick=()=>act(async()=>{historyPage++});$("cache-history-export").onclick=()=>act(async()=>{if(changes.length)await download("follow-history.csv",historyCsv(changes));});
 await act(load);
 if(!disposed)timer=setInterval(()=>{void verify().catch(()=>{});},1500);
 return {dispose,refresh:()=>act(load)};
}
function saveCsv(filename,text){const url=URL.createObjectURL(new Blob(["\uFEFF",text],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
