import {openRepository} from "./store.js";
import {FIXTURE_OWNER as owner} from "./fixture.js";
import {createFixtureSource} from "./fixture-source.js";
import {runFixtureSync} from "./sync-engine.js";
import {summarize,compareSnapshots,profileChanges,selectUsers} from "./model.js";
const $=id=>document.getElementById(id);
let repo,job=null,busy=false,pauseRequested=false,view=null,prior=null,page=0,filtered=[],protectedUsers=new Map();
const status=s=>{$("status").textContent=s};
const wait=()=>new Promise(r=>setTimeout(r,0));
function controls(){for(const id of ["start","resume","discard","purge","size"])$(id).disabled=busy;$("pause").disabled=!busy;$("resume").disabled=busy||!job||!["paused","syncing","interrupted"].includes(job.status);$("start").disabled=busy||!!job;$("discard").disabled=busy||!job;$("pause").disabled=!busy;}
function render(){
 const map=view?.relationshipByUserId||{},sum=summarize(map);$("summary").textContent=view?"粉丝 "+sum.followers+" · 关注 "+sum.following+" · 互关 "+sum.mutual+" · 没回关 "+sum.notFollowingBack+" · 我没回关 "+sum.iHaveNotFollowedBack:"暂无数据";
 const c=compareSnapshots(view,prior);$("changes").textContent=c?"较上次：新增粉丝 "+c.newFollowers.length+" · 名单中消失 "+c.missingFollowers.length+" · 新增互关 "+c.newMutuals.length:"";
 const pc=profileChanges(view,prior);if(pc)$("changes").textContent+=" · 改名 "+pc.renamed.length+" · 已知蓝 V 变化 "+pc.verificationChanged.length;
 const number=id=>$(id).value===""?null:Number($(id).value);
 filtered=selectUsers(view,{query:$("search").value,kind:$("kind").value,verification:$("verified").value,sort:$("sort").value,minFollowers:number("min-followers"),maxFollowers:number("max-followers"),hideProtected:$("hide-protected").checked&&$("kind").value!=="protected"},new Set(protectedUsers.keys()));
 const last=Math.max(0,Math.ceil(filtered.length/50)-1);page=Math.min(page,last);$("matches").textContent=filtered.length+" 条模拟账号 · 第 "+(page+1)+" / "+(last+1)+" 页";$("prev").disabled=page===0;$("next").disabled=page===last;$("export").disabled=!filtered.length;
 $("list").replaceChildren(...filtered.slice(page*50,page*50+50).map(u=>{const li=document.createElement("li");const text=document.createElement("span");text.textContent=(u.displayName||"未知")+" @"+(u.handle||"未知")+" · "+(u.followersCount??"未知")+" 粉丝"+(u.isBlueVerified===true?" · 蓝 V":"");const b=document.createElement("button");b.type="button";b.textContent=protectedUsers.has(u.userId)?"取消保护":"保护";b.disabled=busy;b.onclick=async()=>{if(busy)return;try{await repo.setProtected(owner,u.userId,!protectedUsers.has(u.userId));protectedUsers=new Map((await repo.listProtected(owner)).map(x=>[x.userId,x]));render();}catch(e){status(e.message)}};li.append(text,document.createTextNode(" "),b);return li;}));
}
async function refresh(){job=await repo.active(owner);view=await repo.readSnapshot(owner);prior=await repo.readSnapshot(owner,1);protectedUsers=new Map((await repo.listProtected(owner)).map(x=>[x.userId,x]));render();controls();}
async function run(resuming){
 if(busy)return;busy=true;pauseRequested=false;controls();
 try{
  if(resuming){job=await repo.resume(owner,job.jobId,job.lease);}else{job=await repo.start(owner,"fixture",Number($("size").value));}
  job=await runFixtureSync({repo,job,source:createFixtureSource(job.fixtureSize),shouldPause:()=>pauseRequested,onProgress:current=>{job=current;status("模拟同步 · 关注 "+job.stages.following.count+" · 粉丝 "+job.stages.followers.count);},yieldControl:wait});
  status(job.status==="paused"?"已暂停，进度已保存":job.completeness==="complete"?"完整模拟快照已保存":"模拟快照不完整，旧结果保留");
 }catch(e){status("任务停止："+(e?.message||"未知错误"));}
 finally{busy=false;try{await refresh()}catch(e){status("读取失败："+e.message)}controls();}
}
$("start").onclick=()=>run(false);$("resume").onclick=()=>run(true);$("pause").onclick=()=>{pauseRequested=true;};
$("discard").onclick=async()=>{if(busy||!job)return;busy=true;controls();try{await repo.discard(owner,job.jobId,job.lease);status("已清除未完成任务");}catch(e){status(e.message)}finally{busy=false;await refresh()}};
$("purge").onclick=async()=>{if(busy||!confirm("删除所有本地模拟数据？"))return;busy=true;controls();try{await repo.purge(owner);status("已清除");}catch(e){status(e.message)}finally{busy=false;await refresh()}};
for(const id of ["search","kind","verified","sort","min-followers","max-followers","hide-protected"])$(id).addEventListener("input",()=>{page=0;render()});
$("prev").onclick=()=>{page--;render()};$("next").onclick=()=>{page++;render()};
$("export").onclick=()=>{const cell=x=>'"'+String(x??"").replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';const csv=["user_id,handle,display_name,followers",...filtered.map(u=>[u.userId,u.handle,u.displayName,u.followersCount].map(cell).join(","))].join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="fixture-follow-v2.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
busy=true;controls();try{repo=await openRepository();await refresh();status(job?"有未完成模拟任务，可恢复或清除":"本地预览就绪");busy=false;controls()}catch(e){status("本地存储不可用："+e.message)}
