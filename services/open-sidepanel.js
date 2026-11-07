// Call open before any await so Chrome receives the originating click activation.
// The side panel listens for the pending-context storage change after it mounts.
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
