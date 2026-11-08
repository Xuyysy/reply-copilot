(() => {
  let surface;
  globalThis.ReplyCopilotStagingSurface = {register(value) { surface = value; }};
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !['MOMENTUM_STAGING_SHOW','MOMENTUM_STAGING_ARM_NEXT_REPLY'].includes(message?.type)) return;
    if (!/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//.test(location.href)) {
      respond({ok:false,error:'当前活动标签页不是 X。'});
      return;
    }
    if(message.type==='MOMENTUM_STAGING_ARM_NEXT_REPLY'){
      if(!message.sample||![1,2,3].includes(message.sample.stage)){respond({ok:false,error:'请选择有效阶段。'});return;}
      const armed=surface?.armNextReply?.(message.sample)===true;
      respond(armed?{ok:true,armed:true}:{ok:false,error:'页面控制脚本尚未就绪，请刷新 X 后重试。'});
      return;
    }
    const assistant = surface?.getAssistant?.();
    if (!assistant) {
      respond({ok:false, error:'请先在当前 X 标签页打开回复框。'});
      return;
    }
    if (document.visibilityState !== 'visible' || assistant.host.shadowRoot?.querySelector('.panel.collapsed')) {
      respond({ok:false,error:'提醒区域不可见，请展开回复浮窗后重试。'});
      return;
    }
    if (!message.sample || ![1,2,3].includes(message.sample.stage)) return;
    const node = assistant.previewMomentum(message.sample);
    if (!node) { respond({ok:false,error:'当前回复框无法显示预览。'}); return; }
    requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect();
      if (!node.isConnected || !rect.height || rect.top >= innerHeight || rect.bottom <= 0) {
        if (assistant.isMomentumPreview?.()) assistant.resolveMomentumGate();
        respond({ok:false,error:'提醒区域不可见，请展开回复浮窗后重试。'});
      } else respond({ok:true});
    });
    return true;
  });
})();
