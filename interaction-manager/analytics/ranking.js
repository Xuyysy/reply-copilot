import {validId,primaryEvents,mergeEvent} from '../core/events.js';
const WEIGHT=Object.freeze({like:1,repost:2,reply:3,mention:3,quote:4});
const DAY=86400000;
// Pure computation, no I/O. Windows exclude unknown/conflicting times.
export function rankInteractions(rows,{ownerUserId,direction='inbound',days=null,now=Date.now(),sort='count',halfLife=14}={}){
  if(!validId(ownerUserId)||!['inbound','outbound','both'].includes(direction)||!(days===null||Number.isInteger(days)&&days>0&&days<=3650)||!Number.isFinite(now)||!['count','weighted','recent'].includes(sort)||!Number.isFinite(halfLife)||halfLife<=0)throw Error('invalid_rank_options');
  const unique=new Map();
  for(const e of rows)if(e.ownerUserId===ownerUserId&&e.evidenceQuality==='confirmed')unique.set(e.eventId,mergeEvent(unique.get(e.eventId),e));
  const by=new Map();let unknownTime=0,excludedUnknownTime=0;
  for(const e of primaryEvents([...unique.values()])){
    if(direction!=='both'&&e.direction!==direction)continue;
    if(e.occurredAt===null){unknownTime++;if(days!==null){excludedUnknownTime++;continue;}}
    else if(e.occurredAt>now||days!==null&&e.occurredAt<now-days*DAY)continue;
    const other=e.direction==='inbound'?e.actorUserId:e.targetUserId;
    const p=by.get(other)??{userId:other,inbound:0,outbound:0,count:0,weighted:0,recent:0,unknownTime:0,lastAt:null,byType:{like:0,repost:0,reply:0,mention:0,quote:0}};
    p[e.direction]++;p.count++;p.byType[e.type]++;p.weighted+=WEIGHT[e.type];
    if(e.occurredAt!==null){p.recent+=WEIGHT[e.type]*2**(-(now-e.occurredAt)/DAY/halfLife);p.lastAt=Math.max(p.lastAt??0,e.occurredAt);}
    else p.unknownTime++;
    by.set(other,p);
  }
  const people=[...by.values()].sort((a,b)=>b[sort]-a[sort]||b.count-a.count||(b.lastAt??0)-(a.lastAt??0)||a.userId.localeCompare(b.userId));
  return {people,unknownTime,excludedUnknownTime};
}
