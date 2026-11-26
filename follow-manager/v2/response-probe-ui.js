import {createResponseProbe} from "./response-probe.js";
const $=id=>document.getElementById(id);
let report=null,probe=null;
function render(event){
 $("status").textContent=({waiting:"等待网页自身产生下一次匹配响应…",observed:"真实响应已检查（单页，身份及覆盖未验证）",rejected:"本次未通过："+(event.reason||"unknown"),stopped:"已停止："+(event.reason||"stopped")})[event.phase]||"未启动";
 if(event.phase==="observed"||event.phase==="rejected"){report=event;$("result").textContent=JSON.stringify(event,null,2);}
 $("start").disabled=probe?.active===true||!probe;
 $("stop").disabled=probe?.active!==true;
 $("copy").disabled=!report;
 for(const id of ["owner","kind","authorized"])$(id).disabled=probe?.active===true;
}
if(globalThis.chrome?.devtools?.network){
 probe=createResponseProbe({network:chrome.devtools.network,notify:render});
 $("start").onclick=()=>{try{report=null;$("result").textContent="";probe.start({ownerUserId:$("owner").value.trim(),kind:$("kind").value,authorized:$("authorized").checked})}catch{$("status").textContent="请确认授权及正确的本人数字 ID。";$("copy").disabled=true;}};
 $("stop").onclick=()=>probe.stop();
 $("clear").onclick=()=>{probe.stop();report=null;$("result").textContent="";$("copy").disabled=true;$("owner").value="";$("authorized").checked=false;};
 $("copy").onclick=async()=>{if(report)try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));$("status").textContent="脱敏报告已复制"}catch{$("status").textContent="复制失败，可手动选择下方报告。"}};
 window.stopFollowProbe=()=>probe.stop("panel_hidden");
 window.addEventListener("pagehide",()=>probe.stop("panel_closed"),{once:true});
}else{$("start").disabled=true;$("status").textContent="请在 X 标签页的 Chrome DevTools 中打开互关接口诊断面板。";}
