// Only observed rows. Unknown post identities never enter cumulative counts.
const handle=/^[a-z0-9_]{1,15}$/;
const id=/^[1-9]\d{0,19}$/;
const types=new Set(['like','reply','repost']);
export function normalizeSnapshot(value) {
  if (!value?.ok||typeof value.owner!=='string'||!handle.test(value.owner)||!Array.isArray(value.events)||value.events.length>10000) throw new Error('invalid_snapshot');
  const unique=new Map();
  for(const e of value.events){
    if(!e||typeof e.actor!=='string'||!handle.test(e.actor)||e.actor===value.owner||!types.has(e.type)||!Number.isInteger(e.row)||e.row<0||e.row>=200||!(e.postId===null||typeof e.postId==='string'&&id.test(e.postId))) continue;
    const k=e.postId?e.type+':'+e.actor+':'+e.postId:e.type+':'+e.actor+':row:'+e.row;
    unique.set(k,{actor:e.actor,type:e.type,postId:e.postId,row:e.row});
  }
  return {owner:value.owner,events:[...unique.values()]};
}
export function ranking(events){
  const by=new Map();
  for(const e of events){
    const p=by.get(e.actor)||{actor:e.actor,like:0,reply:0,repost:0,total:0};
    p[e.type]++;p.total++;by.set(e.actor,p);
  }
  return [...by.values()].sort((a,b)=>b.total-a.total||b.reply-a.reply||a.actor.localeCompare(b.actor));
}
export function mergeConfirmed(previous,snapshot,tabId){
  const same=previous?.owner===snapshot.owner&&previous?.tabId===tabId;
  const map=new Map(same?previous.entries:[]);
  for(const e of snapshot.events) if(e.postId) map.set(e.type+':'+e.actor+':'+e.postId,e);
  // Never silently evict data or mix sessions at the limit.
  if(map.size>20000) throw new Error('session_limit');
  return {owner:snapshot.owner,tabId,entries:[...map]};
}
