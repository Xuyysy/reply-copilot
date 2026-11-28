import {createInteractionResponseProbe} from './interaction-response-probe.js';
const $=id=>document.getElementById(id);
let ticket=null,probe=null,generation=0,busy=false;
const tabId=chrome.devtools.inspectedWindow.tabId;
const send=async(action,extra={})=>{const r=await chrome.runtime.sendMessage({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,tabId,...extra});if(!r?.ok)throw Error(r?.error??'source_error');return r.value;};
function cancelTicket(){const t=ticket;ticket=null;if(t)void send('sample-cancel',{ticket:t}).catch(()=>{});}
function render(e){
 $('status').textContent=({waiting:'等待网页自身产生响应…',saved:'已写入本机互动数据库',rejected:'本次未通过',stopped:'已停止'})[e.phase]??'未启动';
 if(e.phase==='stopped'&&e.saveMayHaveCompleted)$('status').textContent='已停止；若写入已经完成，记录仍保留。请读取本地记录确认。';
 $('report').textContent=JSON.stringify(e,null,2);
 const active=probe?.active===true;$('start').disabled=active||busy;$('stop').disabled=!active&&!busy;$('source').disabled=$('authorized').disabled=active||busy;
 if(e.phase!=='waiting')cancelTicket();
}
probe=createInteractionResponseProbe({network:chrome.devtools.network,project:globalThis.ReplyCopilotInteractionInterface.project,commit:async data=>send('sample-commit',{ticket,...data}),notify:render});
function stop(){generation++;busy=false;probe.stop('stopped');cancelTicket();$('start').disabled=false;$('stop').disabled=true;$('source').disabled=$('authorized').disabled=false;}
$('start').onclick=async()=>{
 if(busy||probe.active||!$('authorized').checked)return;
 busy=true;$('start').disabled=true;$('stop').disabled=false;$('source').disabled=$('authorized').disabled=true;
 const g=++generation,source=$('source').value;
 try{
  const r=await send('sample-start',{source,authorized:true});
  if(g!==generation){void send('sample-cancel',{ticket:r.ticket}).catch(()=>{});return;}
  ticket=r.ticket;busy=false;probe.start({source,ownerUserId:r.ownerUserId,authorized:true});
 }catch(e){if(g===generation){busy=false;cancelTicket();render({phase:'rejected',reason:e?.message==='busy'?'其他同步或采集正在进行，请先停止或完成该任务':'请先从当前 X 标签页打开互动助手并确认账号'});}}
};
$('stop').onclick=stop;
window.stopInteractionSample=stop;
window.addEventListener('pagehide',stop,{once:true});
