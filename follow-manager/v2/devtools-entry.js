// No capture on DevTools startup. The panel explicitly arms a single sample.
chrome.devtools.panels.create("互关接口诊断","","follow-manager/v2/response-probe.html",panel=>{
 let view=null;
 panel.onShown.addListener(win=>{view=win});
 panel.onHidden.addListener(()=>{view?.stopFollowProbe?.();view=null;});
});
