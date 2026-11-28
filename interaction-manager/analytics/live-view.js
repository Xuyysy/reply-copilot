import {primaryEvents,validId,mergeEvent} from '../core/events.js';
import {rankInteractions} from './ranking.js';
const TYPES=new Set(['all','like','repost','reply','quote','mention']);
const DAY=86400000;
function select(data,{type='all',direction='inbound',days=null,now=Date.now(),sort='count',query=''}={}){
 if(!validId(data?.ownerUserId)||!Array.isArray(data.rows)||!TYPES.has(type)||!['inbound','outbound','both'].includes(direction)||!(days===null||Number.isInteger(days)&&days>0&&days<=3650)||!Number.isFinite(now)||!['count','weighted','recent'].includes(sort))throw Error('invalid_view');
 // Use the same canonical observations for ranking, detail, and date filters.
 const unique=new Map();
 for(const e of data.rows)if(e.ownerUserId===data.ownerUserId&&e.evidenceQuality==='confirmed')unique.set(e.eventId,mergeEvent(unique.get(e.eventId),e));
 const rows=primaryEvents([...unique.values()]).filter(e=>type==='all'||e.type===type);
 return {rows,options:{ownerUserId:data.ownerUserId,direction,days,now,sort},query:String(query).trim().toLowerCase().replace(/^@/,'').slice(0,40)};
}
export function analyzeLiveDataset(data,settings={}){
 const {rows,options,query}=select(data,settings);
 const names=new Map((data.users??[]).filter(u=>u.ownerUserId===data.ownerUserId&&typeof u.handle==='string'&&/^[A-Za-z0-9_]{1,15}$/.test(u.handle)).map(u=>[u.userId,u.handle]));
 const result=rankInteractions(rows,options);
 const people=result.people.map(p=>({...p,handle:names.get(p.userId)??null})).filter(p=>!query||p.userId.includes(query)||p.handle?.toLowerCase().includes(query));
 return {...result,people,totalPeople:result.people.length,stored:data.rows.length,coverage:data.coverage??[],jobs:data.jobs??[]};
}
export function interactionDetails(data,userId,settings={}){
 if(!validId(userId))throw Error('invalid_user');
 const {rows,options}=select(data,settings);
 return rows.filter(e=>(options.direction==='both'||e.direction===options.direction)&&(e.direction==='inbound'?e.actorUserId:e.targetUserId)===userId&&(e.occurredAt===null?options.days===null:e.occurredAt<=options.now&&(options.days===null||e.occurredAt>=options.now-options.days*DAY))).sort((a,b)=>(b.occurredAt??0)-(a.occurredAt??0)||a.eventId.localeCompare(b.eventId));
}
