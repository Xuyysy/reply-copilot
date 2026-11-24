// Only shipped inside Staging builds. Explicit, transient local UI preview.
export function mountDiagnosticPreview({start,stop}){
 const container=document.createElement('details');
 container.className='dashboard-card';
 const heading=document.createElement('summary');heading.textContent='Staging 诊断测试';
 const note=document.createElement('p');note.className='muted-note';note.textContent='只预览本机诊断界面，不代表服务器授权，不修改后台账户。';
 const buttons=document.createElement('div');buttons.className='dashboard-actions';
 for(const [label,action] of [['开启本机预览',start],['退出预览',stop]]){
  const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent=label;
  button.addEventListener('click',action);buttons.append(button);
 }
 container.append(heading,note,buttons);
 document.getElementById('diagnostic-panel').after(container);
}
