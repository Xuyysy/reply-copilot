// Call open before any await so Chrome receives the originating click activation.
// This helper only opens the control center; reply generation remains tied to
// the trusted X Reply button and its verified native composer.
export async function openReplySidePanel(open, publishContext) {
  try {
    await open();
  } catch {
    return {ok:false, error:'无法打开侧边栏，请重试或从 Chrome 工具栏打开。'};
  }
  try {
    await publishContext();
    return {ok:true};
  } catch {
    return {ok:false, error:'侧边栏已打开，但未能带入当前内容。'};
  }
}
