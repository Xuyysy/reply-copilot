// Pure checkpoint validation/migration for X internal follow-list query mode.
// Stage progress is never a complete relationship snapshot.
export const MAX_INTERNAL_HANDLES=30000;
export const RESUME_TTL_MS=24*60*60*1000;
const HANDLE=/^[a-z0-9_]{1,15}$/;
const ID=/^[1-9]\d{0,19}$/;
const KINDS=new Set(["following","followers"]);
export function validStage(value) {
  if (!value || typeof value!=="object" ||
      !Array.isArray(value.handles) || value.handles.length>MAX_INTERNAL_HANDLES ||
      !value.handles.every(x=>typeof x==="string" && HANDLE.test(x)) ||
      new Set(value.handles).size!==value.handles.length) return false;
  if (!value.ids || typeof value.ids!=="object" || Array.isArray(value.ids) ||
      Object.keys(value.ids).length>MAX_INTERNAL_HANDLES ||
      !Object.entries(value.ids).every(([h,id])=>HANDLE.test(h) && typeof id==="string" && ID.test(id))) return false;
  if (value.verification && (typeof value.verification!=="object" ||
      Array.isArray(value.verification) ||
      Object.entries(value.verification).some(([h,v])=>!HANDLE.test(h) || typeof v!=="boolean"))) return false;
  if (!(value.cursor===null || typeof value.cursor==="string" &&
      value.cursor.length>=1 && value.cursor.length<=512 ||
      value.cursor===undefined)) return false;
  if (value.userId && (typeof value.userId!=="string" || !ID.test(value.userId))) return false;
  if (value.pages!==undefined && (!Number.isSafeInteger(value.pages) || value.pages<0)) return false;
  return typeof value.reason==="string" && value.reason.length<=64;
}
export function readCheckpoint(value,owner,now=Date.now()) {
  if (!value || value.owner!==owner || !HANDLE.test(owner)) return null;
  const time=Date.parse(value.savedAt);
  if (!Number.isFinite(time) || time>now || now-time>RESUME_TTL_MS) return null;
  const stages={};
  if (value.stages && typeof value.stages==="object") {
    for (const kind of KINDS) if(validStage(value.stages[kind])) stages[kind]=value.stages[kind];
  } else if (value.kind==="following" && value.reason==="complete" &&
      Array.isArray(value.handles)) {
    // Read older v2 checkpoints without deleting existing snapshots.
    const previous={handles:value.handles,ids:value.ids||{},verification:value.verification||{},
      reason:"complete",cursor:null,pages:0};
    if(validStage(previous)) stages.following=previous;
  }
  return Object.keys(stages).length ? {owner,stages,savedAt:value.savedAt} : null;
}
export function withStage(previous,owner,kind,stage,now=new Date()) {
  if (!KINDS.has(kind) || !HANDLE.test(owner) || !validStage(stage))
    throw new Error("同步检查点格式无效。");
  return {owner,savedAt:now.toISOString(),
    stages:{...(previous?.owner===owner ? previous.stages : {}),[kind]:stage}};
}
export function resumable(stage) {
  return validStage(stage) && stage.reason!=="complete" && typeof stage.cursor==="string" &&
    stage.cursor.length>0 && stage.handles.length<MAX_INTERNAL_HANDLES;
}

// A pending checkpoint is independently viewable even after its cursor expires.
export function viewCheckpoint(value,owner) {
  const time=Date.parse(value?.savedAt);
  return Number.isFinite(time) ? readCheckpoint(value,owner,time) : null;
}
export function checkpointResult(checkpoint) {
  const a=checkpoint?.stages?.following,b=checkpoint?.stages?.followers;
  if(!a?.handles?.length && !b?.handles?.length &&
     !(a?.reason==="complete" && b?.reason==="complete"))return null;
  if(a?.userId && b?.userId && a.userId!==b.userId)return null;
  return {owner:checkpoint.owner,source:"internal_sync",importedAt:checkpoint.savedAt,
    following:a?.handles||[],followers:b?.handles||[],
    verification:{...a?.verification,...b?.verification},ids:{...a?.ids,...b?.ids},
    directional:{following:{ids:a?.ids||{},verification:a?.verification||{}},
      followers:{ids:b?.ids||{},verification:b?.verification||{}}},
    reasons:{following:a?.reason||"not_started",followers:b?.reason||"not_started"}};
}
// One user click: at most one short batch of each unfinished list.
// Only an ordinary local pause or completion permits advancing to the other
// list. Service failures, cancellation and repeated cursors stop the round.
export async function runIncrementalRound({initial,run,persist,cancelled=()=>false}) {
  const stages={...initial};
  let reason="complete";
  for(const kind of ["following","followers"]){
    if(cancelled())return {stages,reason:"cancelled"};
    const previous=stages[kind];
    if(previous?.reason==="complete")continue;
    if(previous?.handles?.length && !resumable(previous))
      return {stages,reason:"reset_required"};
    let result=await run(kind,resumable(previous)?previous:null);
    if(!validStage(result))throw new Error("同步返回的数据无效。");
    if(result.reason==="paused" && (!resumable(result) ||
       (previous && (result.pages<=previous.pages || result.cursor===previous.cursor))))
      result={...result,reason:"stalled"};
    const other=stages[kind==="following"?"followers":"following"];
    if(result.userId && other?.userId && result.userId!==other.userId)
      return {stages,reason:"account_mismatch"};
    stages[kind]=result;
    await persist(kind,result);
    if(cancelled())return {stages,reason:"cancelled"};
    if(!["complete","paused"].includes(result.reason))return {stages,reason:result.reason};
    if(result.reason==="paused")reason="paused";
  }
  return {stages,reason};
}
