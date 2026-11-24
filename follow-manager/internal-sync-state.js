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

// A user-initiated refresh can span ordinary local work budgets without
// needing a new click. Never continue after a service/permission error,
// cancellation, a cursor loop, storage limit, or a non-advancing checkpoint.
export async function runStageBatches({initial=null,run,persist,cancelled=()=>false,
    deadline=Date.now()+45*60*1000,now=Date.now,maxBatches=20}) {
  let result=initial, previous=resumable(initial)?initial:null;
  const seen=new Set(previous?.cursor?[previous.cursor]:[]);
  for(let i=0;i<maxBatches;i++){
    if(cancelled() || now()>=deadline) return result;
    result=await run(previous,i);
    if(!validStage(result)) throw new Error("同步返回的数据无效。");
    if(result.reason==="paused" && (!resumable(result) ||
       (previous && result.pages<=previous.pages) || seen.has(result.cursor))){
      result={...result,reason:"stalled"};
    }
    await persist(result);
    if(result.reason!=="paused" || cancelled() || now()>=deadline) return result;
    seen.add(result.cursor);
    previous=result;
  }
  return result;
}
