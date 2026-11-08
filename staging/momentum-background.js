import {localDayKey, selectMomentumReminder} from '../domain/creator-momentum.js';
import {MOMENTUM_OUTBOX_PREFIX} from '../services/creator-momentum.js';

function read(store,key) {
  return new Promise((resolve,reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function diagnose(momentum, storage, owner, state, now = Date.now()) {
  const date = localDayKey(now);
  const nextDate = new Date(now);
  nextDate.setDate(nextDate.getDate()+1);
  const [record, outbox] = await Promise.all([
    momentum.transaction(['days','prefs'], async tx => {
      const day = await read(tx.objectStore('days'),JSON.stringify([owner,date]));
      const pref = await read(tx.objectStore('prefs'),owner);
      return {day,pref};
    },'readonly'),
    storage.get(null)
  ]);
  const {day,pref} = record;
  const policy = state.available ? state.policy : null;
  const context = {eligible:state.eligible,enabled:pref?.enabled === true,globalEnabled:policy?.enabled === true};
  const stage = day?.thresholds ? selectMomentumReminder(day,context,now) : null;
  const reason = !policy ? '请刷新购买权益' : !context.eligible ? '购买权益未解锁' :
    !context.globalEnabled ? '全局暂停' : !context.enabled ? '个人监测关闭' :
    !day?.thresholds ? '当天尚未建立阈值' : day.dnd ? '今日免打扰' :
    pref.latestDay > date ? '本地日期回退' : day.reminderCount >= day.maxReminders ? '达到每日提醒上限' :
    day.pendingReminder?.state==='presenting' ? '提醒正在展示' : day.pendingReminder ? '阶段已达标，等待下一次回复' :
    stage ? '阶段已达标，等待下一次回复' : day.shownThrough>=3 ? '该阶段已完成' : '尚未达到阶段';
  return {
    reason,date,configVersion:policy?.version??null,dayVersion:day?.version??null,
    oldPolicy:Boolean(policy&&day?.version&&policy.version!==day.version),
    nextLocalDate:localDayKey(nextDate.getTime()),createdAt:day?.createdAt??null,
    ackCount:day?.count??0,lastAckAt:day?.lastAckAt??null,
    queuedAcks:Object.keys(outbox).filter(k=>k.startsWith(MOMENTUM_OUTBOX_PREFIX+encodeURIComponent(owner)+':')).length,
    thresholds:day?.thresholds??null,shownThrough:day?.shownThrough??0,
    remindersShown:day?.reminderCount??0,doNotDisturb:day?.dnd===true,
    eligibleStage:stage,pendingStage:day?.pendingReminder?.stage??null,pendingState:day?.pendingReminder?.state??null
  };
}

export function registerMomentumTesting({momentum, momentumView, accountStates, accountClient}) {
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL('sidepanel/sidepanel.html')) return;
    if (!['MOMENTUM_STAGING_PREVIEW','MOMENTUM_STAGING_ARM_NEXT_REPLY','MOMENTUM_STAGING_DIAGNOSE'].includes(message?.type)) return;
    void (async()=>{
      const token=await accountClient.token();
      const owner=accountStates.peekState()?.user?.userId;
      if (!token||!owner||accountStates.cachedToken!==token) return {ok:false,error:'请先连接 Staging 账号并刷新购买权益。'};
      const state=await momentumView({});
      if (message.type==='MOMENTUM_STAGING_DIAGNOSE') {
        const diagnostic=await diagnose(momentum,chrome.storage.local,owner,state);
        if (token!==await accountClient.token()) return {ok:false,error:'账号已切换，请重试。'};
        return {ok:true,diagnostic};
      }
      if (![1,2,3].includes(message.stage)) return {ok:false,error:'请选择有效阶段。'};
      if (!state.available) return {ok:false,error:'请先在侧边栏刷新购买权益以载入最新配置。'};
      if (!Number.isInteger(message.windowId) || message.windowId < 0 ||
          (Number.isInteger(sender.tab?.windowId) && sender.tab.windowId !== message.windowId)) {
        return {ok:false,error:'无法确定侧栏所在窗口的目标 X 标签页。'};
      }
      const tabs=await chrome.tabs.query({active:true,windowId:message.windowId});
      const tab=tabs[0];
      if (tabs.length!==1 || !Number.isInteger(tab?.id)) return {ok:false,error:'无法确定目标 X 标签页。'};
      if (tab.url && !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//.test(tab.url))
        return {ok:false,error:'当前窗口的活动标签页不是 X。'};
      if (token!==await accountClient.token()) return {ok:false,error:'账号已切换，请重试。'};
      const {titleZh,bodyZh}=state.policy;
      try {
        const result=await chrome.tabs.sendMessage(tab.id,{type:message.type==='MOMENTUM_STAGING_ARM_NEXT_REPLY'?'MOMENTUM_STAGING_ARM_NEXT_REPLY':'MOMENTUM_STAGING_SHOW',sample:{stage:message.stage,titleZh,bodyZh}},{frameId:0});
        return result ?? {ok:false,error:'X 内容脚本未就绪，请刷新 X 后重试。'};
      } catch {
        return {ok:false,error:'当前活动标签页未响应。若已在 X，请刷新后重试。'};
      }
    })().then(respond,()=>respond({ok:false,error:'当前 X 页面无法接收测试，请刷新并打开回复框。'}));
    return true;
  });
}
