// Staging-only opt-in. Export contains aggregate allowlisted timings, no inputs.
export function mountPerformancePanel(document,runtime){
 const panel=document.createElement('section');panel.className='dashboard-card';
 const title=document.createElement('h2');title.textContent='Staging 匿名性能测量';panel.append(title);
 const note=document.createElement('p');note.className='muted-note';note.textContent='仅记录阶段耗时与次数，不记录正文、账号或请求 ID。重载扩展后关闭；后台休眠可能清空样本。';panel.append(note);
 const status=document.createElement('p');status.className='muted-note';status.setAttribute('role','status');panel.append(status);
 const controls=document.createElement('div');controls.className='dashboard-actions';panel.append(controls);
 const action=async extra=>{const response=await runtime.sendMessage({type:'REPLY_COPILOT_PERFORMANCE_CONTROL',...extra});if(!response?.ok)throw Error();status.textContent=`测量${response.enabled?'已开启':'已关闭'} · ${response.report.samples} 个样本`;return response;};
 for(const [label,extra]of [['开始记录',{enabled:true}],['停止记录',{enabled:false}],['清空样本',{clear:true}],['导出报告',null]]){
  const button=document.createElement('button');button.className='button secondary';button.textContent=label;
  button.addEventListener('click',async()=>{button.disabled=true;try{const response=await action(extra||{});if(extra===null){const blob=new Blob([JSON.stringify(response.report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='xrh-staging-performance.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch{status.textContent='性能测量暂不可用，请重新打开侧边栏。';}finally{button.disabled=false;}});controls.append(button);
 }
 document.getElementById('dashboard')?.append(panel);void action({}).catch(()=>{status.textContent='尚未开启测量。';});
}
