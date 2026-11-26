import {stableId,selectUsers,summarize,relationshipById} from "./model.js";
import {LIVE_SOURCE} from "./store.js";
export function buildCacheView(data,owner,mode="latest"){
 if(!stableId(owner)||data?.ownerUserId!==owner||!["latest","progress"].includes(mode))throw Error("invalid_owner");
 const chosen=mode==="progress"?data.progress?.view:data.snapshot??data.progress?.view;
 if(!chosen)return {view:null,summary:null,history:data.history??[],protectedIds:new Set()};
 if(chosen.source!==LIVE_SOURCE||chosen.ownerUserId!==owner||!Array.isArray(chosen.users))throw Error("invalid_source");
 // Recompute from positive observations, never trust negative flags in a partial map.
 const quality=chosen===data.snapshot&&chosen.completeness==="complete"?"complete":"partial";
 const view={...chosen,completeness:quality,relationshipByUserId:relationshipById(chosen.users,quality)};
 const sum=summarize(view.relationshipByUserId);
 return {view,summary:{...sum,notFollowingBack:quality==="complete"?sum.notFollowingBack:null,iHaveNotFollowedBack:quality==="complete"?sum.iHaveNotFollowedBack:null},history:data.history??[],protectedIds:new Set((data.protectedUsers??[]).map(x=>x.userId))};
}
export function filterCacheView(state,options={}){
 if(!state.view)return [];
 if(state.view.completeness!=="complete"&&["notFollowingBack","iHaveNotFollowedBack"].includes(options.kind))return [];
 return selectUsers(state.view,options,state.protectedIds);
}
export function cacheCsv(state,users){
 if(!state.view)return "";
 const cell=(v,force=false)=>{let s=String(v??"");if(force||/^[\s]*[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const flag=v=>v===true?"yes":v===false?"no":"unknown";
 return ["user_id,handle,display_name,following,follower,followers_count,protected,coverage,captured_at",...users.map(u=>{
  const r=state.view.relationshipByUserId[u.userId];
  return [cell(u.userId,true),cell(u.handle),cell(u.displayName),cell(flag(r?.following)),cell(flag(r?.follower)),cell(u.followersCount),cell(state.protectedIds.has(u.userId)?"yes":"no"),cell(state.view.completeness),cell(state.view.capturedAt)].join(",");
 })].join("\r\n");
}
