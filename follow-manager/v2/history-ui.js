import {openRepository} from "./store.js";
import {FIXTURE_OWNER as owner} from "./fixture.js";
import {CHANGE_LABELS,analyzeHistory,filterChanges,historyCsv,changeValue} from "./history.js";
const $=id=>document.getElementById(id);
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const fmt=n=>n.toLocaleString(),date=v=>new Date(v).toLocaleString(),signed=n=>n>0?"+"+fmt(n):fmt(n);
export async function mountHistory(){
 let repo,meta=[],report=null,filtered=[],page=0,busy=false;
 const status=s=>{$("history-status").textContent=s;};
 function controls(){
  $("refresh").disabled=busy||!repo;$("older").disabled=busy||meta.length<2;$("newer").disabled=busy||meta.length<2;
  $("compare").disabled=busy||meta.length<2;$("csv").disabled=busy||!filtered.length;
  $("history-prev").disabled=busy||page===0;$("history-next").disabled=busy||(page+1)*50>=filtered.length;
 }
 function renderRows(){
  filtered=filterChanges(report?.rows||[],$("change-kind").value,$("change-query").value);
  page=Math.min(page,Math.max(0,Math.ceil(filtered.length/50)-1));
  $("change-count").textContent=report?fmt(filtered.length)+" 条变化 · 第 "+(page+1)+" / "+Math.max(1,Math.ceil(filtered.length/50))+" 页":"暂无比较";
  $("change-rows").replaceChildren(...filtered.slice(page*50,page*50+50).map(r=>{
   const tr=el("tr"),account=el("td",r.handle?"@"+r.handle:(r.displayName||"未知账号"));account.append(el("small","ID "+r.userId));tr.append(el("td",CHANGE_LABELS[r.kind]),account,el("td",changeValue(r.before)||"—"),el("td",changeValue(r.after)||"—"));return tr;
  }));
  for(const b of $("change-cards").querySelectorAll("button"))b.setAttribute("aria-pressed",String(b.dataset.kind===$("change-kind").value));
  controls();
 }
 function clearComparison(message=""){
  report=null;page=0;$("metrics").replaceChildren();$("change-cards").replaceChildren();$("coverage").textContent="";$("comparison-meta").textContent=message;renderRows();
 }
 function renderReport(pair){
  report=analyzeHistory(pair.current,pair.prior);if(!report){clearComparison("快照不能比较");return;}
  $("comparison-meta").textContent=date(pair.prior.capturedAt)+" → "+date(pair.current.capturedAt)+"（模拟完整快照）";
  const labels={followers:"粉丝",following:"关注",mutual:"互关",blueFollowers:"已知蓝 V 粉丝",blueMutuals:"已知蓝 V 互关"};
  $("metrics").replaceChildren(...Object.entries(labels).map(([k,label])=>{
   const card=el("div");card.className="metric";card.append(el("span",label),el("strong",fmt(report.next[k])),el("small","较早 "+fmt(report.previous[k])+" · "+signed(report.delta[k])));return card;
  }));
  $("coverage").textContent="蓝 V 统计仅计明确认证：较早未知 "+fmt(report.previous.unknownFollowers)+"，较新未知 "+fmt(report.next.unknownFollowers)+"；未知不是非蓝 V，差值不是确认的认证净变化。";
  $("change-cards").replaceChildren(...Object.entries(CHANGE_LABELS).map(([k,label])=>{
   const b=el("button");b.type="button";b.className="metric";b.dataset.kind=k;b.append(el("span",label),el("strong",fmt(report.counts[k])));b.onclick=()=>{$("change-kind").value=k;page=0;renderRows()};return b;
  }));
  page=0;renderRows();
 }
 async function compare(){
  if(busy||meta.length<2)return;busy=true;controls();clearComparison("比较中…");
  try{const pair=await repo.readHistoryPair(owner,$("newer").value,$("older").value);renderReport(pair);status("比较完成");}
  catch(e){clearComparison("无法比较所选快照，请刷新并选择较早和较新记录。");status(e.message);}
  finally{busy=false;controls();}
 }
 async function refresh(){
  if(busy||!repo)return;busy=true;controls();clearComparison();
  try{meta=await repo.listSnapshots(owner);
   $("trend").replaceChildren(...[...meta].reverse().map(m=>{const tr=el("tr");tr.append(el("td",date(m.capturedAt)),el("td",fmt(m.followers)),el("td",fmt(m.following)));return tr}));
   for(const id of ["older","newer"]){$(id).replaceChildren(...meta.map((m,i)=>{const option=el("option","#"+(meta.length-i)+" · "+date(m.capturedAt)+" · 粉丝 "+fmt(m.followers));option.value=m.snapshotId;return option;}));}
   if(meta.length>=2){$("older").selectedIndex=1;$("newer").selectedIndex=0;status("已读取 "+meta.length+" 份完整快照");}
   else status("至少需要两份完整模拟快照；当前 "+meta.length+" 份。");
  }catch(e){meta=[];status("读取失败："+e.message);}finally{busy=false;controls();}
  if(meta.length>=2)await compare();
 }
 $("change-kind").append(...Object.entries(CHANGE_LABELS).map(([k,label])=>{const o=el("option",label);o.value=k;return o}));
 $("refresh").onclick=refresh;$("compare").onclick=compare;
 for(const id of ["older","newer"])$(id).onchange=()=>clearComparison("已更改选择，请点击比较。");
 $("change-kind").onchange=()=>{page=0;renderRows()};$("change-query").oninput=()=>{page=0;renderRows()};
 $("history-prev").onclick=()=>{page--;renderRows()};$("history-next").onclick=()=>{page++;renderRows()};
 $("csv").onclick=()=>{if(!filtered.length||busy)return;const url=URL.createObjectURL(new Blob(["\uFEFF",historyCsv(filtered)],{type:"text/csv;charset=utf-8"}));const a=el("a");a.href=url;a.download="fixture-follow-history.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 try{repo=await openRepository();await refresh();}catch(e){status("本地数据库不可用："+e.message);controls();}
}
