import {RUNTIME_CONFIG} from '../config/runtime.js';
import {StorageService,BEHAVIOR_PREFERENCES_KEY,PENDING_REQUEST_KEY} from '../services/storage-service.js';
import {VoiceProfileService} from '../services/voice-profile-service.js';
import {UsageService} from '../services/usage-service.js';
import {AccountClient} from '../services/account-client.js';

const storage=new StorageService(),profiles=new VoiceProfileService(),usage=new UsageService(),accountClient=new AccountClient();
const $=id=>document.getElementById(id);
let accountPoll=null;

const momentumControl=globalThis.ReplyCopilotMomentumPresenter.connect(
  $('momentum-control'),message=>chrome.runtime.sendMessage(message),action=>{
    if(action==='pricing')void accountClient.openWebsite('/pricing/').catch(()=>{});
    if(action==='momentum_original')void chrome.runtime.sendMessage({type:'REPLY_COPILOT_OPEN_ORIGINAL'});
  },{mode:'full'}
);
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id===chrome.runtime.id&&message?.type==='REPLY_COPILOT_MOMENTUM_CHANGED')void momentumControl.refresh();
});

function openMomentumDetails(){momentumControl.expand();void chrome.storage.session.remove('openMomentumDetails').catch(()=>{});}
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='session'&&changes.openMomentumDetails?.newValue===true)openMomentumDetails();
  if(area==='local'&&[BEHAVIOR_PREFERENCES_KEY,'voiceProfile','replyCopilotAccountToken','localUsageEvents'].some(key=>key in changes))void refreshDashboard();
});
void chrome.storage.session.get('openMomentumDetails').then(state=>{if(state.openMomentumDetails===true)openMomentumDetails();}).catch(()=>{});

async function refreshDashboard(){
  const [account,summary,behavior,profile]=await Promise.all([
    chrome.runtime.sendMessage({type:'REPLY_COPILOT_ACCOUNT_STATE'}).catch(()=>null),usage.getSummary(),storage.getBehaviorPreferences(),profiles.get()
  ]);
  $('stat-week').textContent=String(summary.last7DaysGenerations);
  $('stat-all').textContent=String(summary.totalGenerations);
  $('stat-copy').textContent=String(summary.copies);
  $('quick-style').value=behavior.defaultReplyMode;$('quick-auto').checked=behavior.autoGenerateOnReply;
  $('quick-language').value=profile.language;$('quick-length').value=profile.replyLength;$('quick-humor').value=profile.humorLevel;
  const status=account?.ok?account.status:'auth_unavailable';
  $('quota-row').classList.toggle('hidden',!account?.quota||account.source!=='server');
  $('account-buttons').classList.toggle('hidden',!['guest','auth_expired','auth_unavailable'].includes(status)&&!account?.pending);
  $('connect-register').classList.toggle('hidden',status!=='guest'||account?.pending);
  $('connect-login').classList.toggle('hidden',!['guest','auth_expired'].includes(status)||account?.pending);
  $('check-binding').classList.toggle('hidden',!account?.pending&&status!=='auth_unavailable');
  $('account-name').textContent=account?.pending?'正在等待官网确认':status==='guest'?'尚未连接账户':status==='auth_expired'?'登录已过期':status==='auth_unavailable'?'暂时无法确认账户':status==='frozen'?'账户已冻结':account?.user?.username||account?.user?.email||'已连接账户';
  $('account-summary').textContent=account?.pending?'请在官网完成授权，返回后点击查看绑定状态。':status==='guest'?'注册并验证邮箱，免费领取 200 次。':status==='auth_expired'?'请重新连接官网账户。':status==='auth_unavailable'?'网络暂不可用，请重试；原账户凭据仍保留。':status==='frozen'?'AI 生成已停用。请到官网账户中心查看账户状态。':status==='credits_exhausted'?'生成次数已用完，支付暂未开放。':'余额来自官网服务。';
  if(account?.quota&&account.source==='server'){$('quota-total').textContent=String(account.quota.totalRemaining);$('quota-free').textContent=String(account.quota.freeRemaining);$('quota-paid').textContent=String(account.quota.paidRemaining);}
  if(account?.pending&&!accountPoll)accountPoll=setInterval(()=>void refreshDashboard(),3500);
  if(!account?.pending&&accountPoll){clearInterval(accountPoll);accountPoll=null;}
}

document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.id==='account-refresh'||button.id==='check-binding'){void refreshDashboard();return;}
  if(button.id==='connect-register'||button.id==='connect-login'){
    button.disabled=true;
    const response=await chrome.runtime.sendMessage({type:'REPLY_COPILOT_BEGIN_BINDING',mode:button.id==='connect-register'?'register':'login'}).catch(()=>null);
    $('account-summary').textContent=response?.ok?'已打开官网，请完成登录与授权。':response?.error||'打开官网失败，请重试。';
    button.disabled=false;void refreshDashboard();return;
  }
  const destinations={'nav-website':'/','nav-account':'/account','nav-pricing':'/pricing','nav-guide':'/guide'};
  if(destinations[button.id]){try{await accountClient.openWebsite(destinations[button.id]);}catch{$('account-summary').textContent='官网地址暂不可用。';}return;}
  if(['settings','footer-settings'].includes(button.id)){chrome.runtime.openOptionsPage();return;}
});

for(const id of ['quick-style','quick-language','quick-length','quick-humor','quick-auto'])$(id).addEventListener('change',async()=>{
  try{
    if(id==='quick-style')await storage.setBehaviorPreferences({defaultReplyMode:$(id).value});
    else if(id==='quick-auto')await storage.setBehaviorPreferences({autoGenerateOnReply:$(id).checked});
    else await profiles.save({...await profiles.get(),language:$('quick-language').value,replyLength:$('quick-length').value,humorLevel:$('quick-humor').value});
    $('quick-save-status').textContent='已保存并同步到设置中心。';
  }catch{$('quick-save-status').textContent='保存失败，请重试。';}
});

// Old extension releases could leave a selected-text request in session storage.
// Discard it explicitly; the side panel no longer generates replies or consumes credits.
void chrome.storage.session.remove(PENDING_REQUEST_KEY).catch(()=>{});
void refreshDashboard();
void momentumControl.refresh({ensure:true});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void momentumControl.refresh({ensure:true});});
if(RUNTIME_CONFIG.channel==='staging'){
  void import('../staging/momentum-panel.js').then(({mountMomentumTesting})=>mountMomentumTesting(document)).catch(()=>{});
  void import('./performance-panel.js').then(({mountPerformancePanel})=>mountPerformancePanel(document,chrome.runtime)).catch(()=>{});
}
