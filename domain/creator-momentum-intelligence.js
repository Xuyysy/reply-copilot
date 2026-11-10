// Creator Momentum Intelligence — a research index, not an X distribution weight.
// Source of truth for actual stage reminders is the extension's locally frozen policy.
// This independent projection intentionally NEVER claims that a reminder fired.
export function momentumIndex(count, ranges) {
  const safe = Math.max(0, Number.isFinite(count) ? count : 0);
  if (!Array.isArray(ranges) || ranges.length !== 3 ||
      ranges.some((r, i) => !Array.isArray(r) || r.length !== 2 ||
        !r.every(n => Number.isSafeInteger(n) && n > 0) || r[0] > r[1] ||
        (i && r[0] <= ranges[i - 1][1]))) throw new Error("INVALID_MOMENTUM_RANGES");
  const anchors = ranges.map(([low, high]) => (low + high) / 2);
  const normalized = Math.max(0, Math.min(3, safe <= anchors[0] ? safe / anchors[0]
    : safe <= anchors[1] ? 1 + (safe - anchors[0]) / (anchors[1] - anchors[0])
    : safe <= anchors[2] ? 2 + (safe - anchors[1]) / (anchors[2] - anchors[1])
    : 3));
  const score = Math.round(1000 * (-Math.expm1(-0.8 * normalized)) / (-Math.expm1(-2.4))) / 10;
  return {score, normalized};
}

export function momentumCycle(count,ranges) {
  const anchors = ranges.map(([low,high]) => (low + high) / 2);
  const safe = Math.max(0,Number.isFinite(count)?count:0);
  const referenceCrossings = anchors.filter(anchor=>safe>=anchor).length;
  const next = Math.min(2,referenceCrossings);
  const previous = next===0?0:anchors[next-1];
  const target = anchors[next];
  const percent = referenceCrossings===3?100:
    Math.max(0,Math.min(99,Math.round((safe-previous)/Math.max(1,target-previous)*100)));
  const stage = next+1;
  const windowStage = ranges.findIndex(([low,high])=>safe>=low&&safe<=high)+1;
  const stages=ranges.map(([low,high],i)=>({
    stage:i+1,
    referenceState:safe>high?"past_reference_window":
      safe>=low?"inside_reference_window":"before_reference_window",
    referenceCrossed:safe>=anchors[i],
  }));
  return {stage,percent,referenceCrossings,windowStage:Math.max(0,windowStage),stages};
}

export function momentumInsightsModel(count,hourlyCounts,ranges) {
  // Validate policy exactly once and follow the admin's current settings.
  const total = Math.max(0,Number.isSafeInteger(count)?count:0);
  const index = momentumIndex(total,ranges);
  const cycle = momentumCycle(total,ranges);
  const hours=Array.isArray(hourlyCounts)&&hourlyCounts.length===24?
    hourlyCounts.map(v=>Number.isSafeInteger(v)&&v>0?v:0):Array(24).fill(0);
  let cumulative=0;
  const curve=hours.map((v,hour)=>{
    cumulative+=v;
    const global=momentumIndex(cumulative,ranges);
    const local=momentumCycle(cumulative,ranges);
    return {hour,score:global.score,cycleProgress:local.percent,cycleStage:local.stage,referenceCrossings:local.referenceCrossings};
  });
  return {...index,cycle,curve};
}
