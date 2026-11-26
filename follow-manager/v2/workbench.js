import {openRepository} from "./store.js";
import {fixturePage,FIXTURE_OWNER as owner} from "./fixture.js";
import {summarize,compareSnapshots} from "./model.js";
const $=id=>document.getElementById(id);
let repo,job=null,busy=false,pauseRequested=false,view=null,prior=null,page=0,filtered=[];
const status=s=>{$("status").textContent=s};
const wait=()=>new Promise(r=>setTimeout(r,0));
function controls(){for(const id of ["start","resume","discard","purge","size"])$(id).disabled=busy;$("pause").disabled=!busy;$("resume").disabled=busy||!job||!["paused","syncing","interrupted"].includes(job.status);$("start").disabled=busy||!!job;$("discard").disabled=busy||!job;}
function render(){
 const map=view?.relationshipByUserId||{},sum=summarize(map);$("summary").textContent=view?"粉丝 "+sum.followers+" · 关注 "+sum.following+" · 互关 "+sum.mutual+" · 没回关 "+sum.notFollowingBack+" · 我没回关 "+sum.iHaveNotFollowedBack:"暂无数据";
 const c=compareSnapshots(view,prior);$("changes").textContent=c?"较上次：新增粉丝 "+c.newFollowers.length+" · 名单中消失 "+c.missingFollowers.length+" · 新增互关 "+c.newMutuals.length:"";
 const q=$("search").value.toLowerCase(),kind=$("kind").value,v=$("verified").value,users=new Map((view?.users||[]).map(u=>[u.userId,u]));
 filtered=Array.from(users.values()).filter(u=>{const r=map[u.userId];return r&&(kind==="mutual"?r.follower===true&&r.following===true:kind==="notFollowingBack"?r.following===true&&r.follower===false:r.follower===true&&r.following===false)&&(!q||((u.handle||"")+" "+(u.displayName||"")).toLowerCase().includes(q))&&(v==="all"||(v==="blue"?u.isBlueVerified===true:u.isBlueVerified===null))});
 const last=Math.max(0,Math.ceil(filtered.length/50)-1);page=Math.min(page,last);$("matches").textContent=filtered.length+" 条模拟账号 · 第 "+(page+1)+" / "+(last+1)+" 页";$("prev").disabled=page===0;$("next").disabled=page===last;$("export").disabled=!filtered.length;
 $("list").replaceChildren(...filtered.slice(page*50,page*50+50).map(u=>{const li=document.createElement("li");li.textContent=(u.displayName||"未知")+" @"+(u.handle||"未知")+" · "+(u.followersCount??"未知")+" 粉丝"+(u.isBlueVerified===true?" · 蓝 V":"");return li;}));
}
async function refresh(){job=await repo.active(owner);view=await repo.readSnapshot(owner);prior=await repo.readSnapshot(owner,1);render();controls();}
async function run(resuming){
 if(busy)return;busy=true;pauseRequested=false;controls();
 try{
  if(resuming){job=await repo.resume(owner,job.jobId,job.lease);}else{job=await repo.start(owner,"fixture");}
  // The fixture size is fixed by first persisted page, or selected before starting it.
  const size=job.stages.following.expected??job.stages.followers.expected??Number($("size").value);
  for(const kind of ["following","followers"]){while(!job.stages[kind].terminal){
   if(pauseRequested){job=await repo.pause(owner,job.jobId,job.lease);status("已暂停，进度已保存");return;}
   job=await repo.append(owner,job.jobId,job.lease,kind,fixturePage(kind,job.stages[kind].cursor,size));
   status("模拟同步 · 关注 "+job.stages.following.count+" · 粉丝 "+job.stages.followers.count);await wait();
  }}
  job=await repo.finalize(owner,job.jobId,job.lease);status(job.completeness==="complete"?"完整模拟快照已保存":"模拟快照不完整，旧结果保留");
 }catch(e){status("任务停止："+(e?.message||"未知错误"));if(job)try{job=await repo.pause(owner,job.jobId,job.lease,"failed")}catch{}}
 finally{busy=false;try{await refresh()}catch(e){status("读取失败："+e.message)}controls();}
}
$("start").onclick=()=>run(false);$("resume").onclick=()=>run(true);$("pause").onclick=()=>{pauseRequested=true;};
$("discard").onclick=async()=>{if(busy||!job)return;busy=true;controls();try{await repo.discard(owner,job.jobId,job.lease);status("已清除未完成任务");}catch(e){status(e.message)}finally{busy=false;await refresh()}};
$("purge").onclick=async()=>{if(busy||!confirm("删除所有本地模拟数据？"))return;busy=true;controls();try{await repo.purge(owner);status("已清除");}catch(e){status(e.message)}finally{busy=false;await refresh()}};
for(const id of ["search","kind","verified"])$(id).addEventListener("input",()=>{page=0;render()});
$("prev").onclick=()=>{page--;render()};$("next").onclick=()=>{page++;render()};
$("export").onclick=()=>{const cell=x=>'"'+String(x??"").replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';const csv=["user_id,handle,display_name,followers",...filtered.map(u=>[u.userId,u.handle,u.displayName,u.followersCount].map(cell).join(","))].join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="fixture-follow-v2.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
busy=true;controls();try{repo=await openRepository();await refresh();status(job?"有未完成模拟任务，可恢复或清除":"本地预览就绪");busy=false;controls()}catch(e){status("本地存储不可用："+e.message)}
