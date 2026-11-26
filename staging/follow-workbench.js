import {openRepository,LIVE_SOURCE} from '../follow-manager/v2/store.js';
import {mountAuthorizedCache} from '../follow-manager/v2/cache-workbench.js';
const $=id=>document.getElementById(id);
const read=async()=>{const r=await chrome.runtime.sendMessage({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'follow',action:'identity'});if(!r?.ok)throw Error('identity_changed');return {...r.value,source:LIVE_SOURCE,sessionId:r.value.bindingId,identityEvidence:'self_profile_and_session'};};
let mounted=null,repo=null;
(async()=>{try{await new Promise(r=>setTimeout(r,150));const i=await read();$('owner').textContent='@'+i.handle;repo=await openRepository(indexedDB,{live:true});$('status').textContent='仅显示当前账号已保存的名单；实时后台同步尚未接入。';mounted=await mountAuthorizedCache({root:$('follow-cache'),repo,ownerUserId:i.ownerUserId,sessionId:i.sessionId,readIdentity:read});
 // Move rarely used controls into a collapsed advanced section; keep relationship and search visible.
 const root=$('follow-cache'),anchor=root.querySelector('#cache-summary');
 if(anchor){const advanced=document.createElement('details'),heading=document.createElement('summary'),body=document.createElement('div');heading.textContent='高级筛选与导出';body.className='toolbar';advanced.append(heading,body);for(const id of ['cache-mode','cache-verified','cache-sort','cache-min','cache-max','cache-hide','cache-export']){const el=root.querySelector('#'+id);if(el)body.append(el.closest('label')??el);}anchor.after(advanced);}}catch{$('owner').textContent='未确认账号';$('status').textContent='请从已登录的 X 页面侧边栏重新打开。';}})();
window.addEventListener('pagehide',()=>{mounted?.dispose();repo?.close();},{once:true});
