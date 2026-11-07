(() => {
  let surface;
  globalThis.ReplyCopilotStagingSurface = {register(getSurface) { surface = getSurface; }};
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.type !== 'MOMENTUM_STAGING_SHOW') return;
    const assistant = surface?.();
    if (!assistant || document.visibilityState !== 'visible') {
      respond({ok:false, error:'请先在当前 X 标签页打开回复框。'});
      return;
    }
    if (!message.sample || ![1,2,3].includes(message.sample.stage)) return;
    const node = assistant.previewMomentum(message.sample);
    if (!node) { respond({ok:false,error:'当前回复框无法显示预览。'}); return; }
    requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect();
      if (!node.isConnected || !rect.height || rect.top >= innerHeight || rect.bottom <= 0) {
        node.remove();
        respond({ok:false,error:'提醒区域不可见，请展开回复浮窗后重试。'});
      } else respond({ok:true});
    });
    return true;
  });
})();
