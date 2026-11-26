import {summarize,compareSnapshots,profileChanges} from "./model.js";
export const CHANGE_LABELS=Object.freeze({
 newFollowers:"新增粉丝",missingFollowers:"粉丝名单中消失",newFollowing:"新增关注",missingFollowing:"关注名单中消失",
 newMutuals:"新增互关",missingMutuals:"原互关关系消失",renamed:"用户名变化",verificationChanged:"已知蓝 V 状态变化"
});
function latest(rows){
 const map=new Map();
 for(const u of rows||[]){const old=map.get(u.userId);if(!old||String(u.observedAt)>=String(old.observedAt))map.set(u.userId,u);}
 return map;
}
export function snapshotMetrics(s){
 if(!s||s.completeness!=="complete")return null;
 const summary=summarize(s.relationshipByUserId),users=latest(s.users);let blueFollowers=0,blueMutuals=0,knownFollowers=0,unknownFollowers=0;
 for(const [id,r] of Object.entries(s.relationshipByUserId)){if(r.follower!==true)continue;const blue=users.get(id)?.isBlueVerified;
  if(typeof blue!=="boolean"){unknownFollowers++;continue;}knownFollowers++;if(blue){blueFollowers++;if(r.following===true)blueMutuals++;}}
 return {...summary,blueFollowers,blueMutuals,knownFollowers,unknownFollowers,mutualRate:summary.following?summary.mutual/summary.following:null};
}
export function analyzeHistory(current,prior){
 const base=compareSnapshots(current,prior),profiles=profileChanges(current,prior);if(!base||!profiles)return null;
 const a=current.relationshipByUserId,b=prior.relationshipByUserId,newFollowing=[],missingFollowing=[];
 for(const id of new Set([...Object.keys(a),...Object.keys(b)])){
  if(a[id]?.following===true&&b[id]?.following!==true)newFollowing.push(id);
  if(a[id]?.following!==true&&b[id]?.following===true)missingFollowing.push(id);
 }
 const changes={...base,newFollowing,missingFollowing,...profiles},before=latest(prior.users),after=latest(current.users),rows=[];
 for(const [kind,items] of Object.entries(changes))for(const item of items){
  const id=typeof item==="string"?item:item.userId,u=after.get(id)||before.get(id);
  rows.push({kind,userId:id,handle:u?.handle??null,displayName:u?.displayName??null,before:typeof item==="string"?null:item.before,after:typeof item==="string"?null:item.after});
 }
 const previous=snapshotMetrics(prior),next=snapshotMetrics(current);
 return {previous,next,rows,counts:Object.fromEntries(Object.keys(CHANGE_LABELS).map(k=>[k,changes[k].length])),delta:Object.fromEntries(["followers","following","mutual","blueFollowers","blueMutuals","unknownFollowers"].map(k=>[k,next[k]-previous[k]]))};
}
export function filterChanges(rows,kind,query){
 const q=String(query||"").trim().replace(/^@/,"").toLowerCase();
 return rows.filter(r=>(kind==="all"||r.kind===kind)&&(!q||[r.userId,r.handle,r.displayName,r.before,r.after].some(v=>typeof v==="string"&&v.toLowerCase().includes(q)))).sort((a,b)=>a.kind.localeCompare(b.kind)||a.userId.localeCompare(b.userId));
}
export function changeValue(v){return v===true?"蓝 V":v===false?"非蓝 V":v??"";}
export function historyCsv(rows){
 const cell=(v,force=false)=>{let x=String(v??"");if(force||/^[\s]*[=+\-@\t\r\n]/.test(x))x="'"+x;return '"'+x.replaceAll('"','""')+'"';};
 return ["change,user_id,handle,display_name,before,after",...rows.map(r=>[cell(CHANGE_LABELS[r.kind]),cell(r.userId,true),cell(r.handle),cell(r.displayName),cell(changeValue(r.before)),cell(changeValue(r.after))].join(","))].join("\r\n");
}
