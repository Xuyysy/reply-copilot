const status=document.getElementById('account-tools-status');
for(const feature of ['interaction','follow']){
 const button=document.getElementById('open-'+feature+'-workbench');
 if(!button)continue;
 button.addEventListener('click',async()=>{
   button.disabled=true;status.textContent='';
   try{const reply=await chrome.runtime.sendMessage({type:'XRH_STAGING_ACCOUNT_WORKBENCH',action:'open',feature});if(!reply?.ok)status.textContent='请先登录 X，再打开助手。';}
   catch{status.textContent='打开失败，请重新加载插件。';}
   finally{button.disabled=false;}
 });
}