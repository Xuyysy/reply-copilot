// No capture on DevTools startup. The panel explicitly arms a single sample.
chrome.devtools.panels.create("互关接口诊断","","follow-manager/v2/response-probe.html",panel=>{
 let view=null;
 panel.onShown.addListener(win=>{view=win});
 panel.onHidden.addListener(()=>{view?.stopFollowProbe?.();view=null;});
});

// Separate opt-in, one-response panel; no collection when DevTools opens.
chrome.devtools.panels.create("互动接口采集","","staging/interaction-response-panel.html",panel=>{
 let view=null;
 panel.onShown.addListener(win=>{view=win});
 panel.onHidden.addListener(()=>{view?.stopInteractionSample?.();view=null;});
});
