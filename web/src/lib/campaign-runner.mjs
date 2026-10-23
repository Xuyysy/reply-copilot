/** Invoked only by a confirmed user action. Never retries an uncertain batch. */
export async function runCampaignBatches({ initialStats, sendBatch, onProgress, shouldStop, maxBatches = 250 }) {
  let stats = initialStats;
  let batches = 0;
  const limit = Math.min(250, Math.max(0, Math.floor(maxBatches)));
  while (batches < limit) {
    if (shouldStop()) return { reason: 'stopped', stats, batches };
    if (stats.remaining === 0) return { reason: 'complete', stats, batches };
    let result;
    try { result = await sendBatch(); } catch (error) { return { reason: 'error', error, stats, batches }; }
    batches++;
    const next = result?.stats;
    if (!next || !['total', 'succeeded', 'failed', 'remaining'].every(key => Number.isInteger(next[key]) && next[key] >= 0)) return { reason: 'uncertain', stats, batches };
    onProgress(next);
    const progressed = next.remaining < stats.remaining || next.succeeded > stats.succeeded;
    stats = next;
    if (stats.remaining === 0) return { reason: 'complete', stats, batches };
    if (!progressed) return { reason: 'no-progress', stats, batches };
  }
  return { reason: 'limit', stats, batches };
}
