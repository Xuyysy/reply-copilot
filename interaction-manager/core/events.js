// Source adapters must verify the owner and actor before constructing confirmed events.
// IDs are strings: X snowflakes may exceed Number.MAX_SAFE_INTEGER.
const ID=/^[1-9]\d{0,19}$/;
const TYPES=new Set(['reply','quote','mention','like','repost']);
const SOURCES=new Set(['notification','post','archive','authorized-api']);
export function validId(value){return typeof value==='string'&&ID.test(value);}
function epoch(value){return Number.isSafeInteger(value)&&value>0;}
export function normalizeEvent(input,owner){
  if(!validId(owner)||input?.ownerUserId!==owner||!validId(input.actorUserId)||!validId(input.targetUserId)||!TYPES.has(input.type)||!SOURCES.has(input.source))return null;
  const {actorUserId:a,targetUserId:b,type}=input;
  if(a===b||a!==owner&&b!==owner)return null;
  const direction=a===owner?'outbound':'inbound';
  if(input.direction!==undefined&&input.direction!==direction)return null;
  const eventPostId=input.eventPostId??null,targetPostId=input.targetPostId??null;
  if(eventPostId!==null&&!validId(eventPostId)||targetPostId!==null&&!validId(targetPostId))return null;
  const byEvent=type==='reply'||type==='quote'||type==='mention';
  if(byEvent&&!eventPostId||!byEvent&&!targetPostId)return null;
  if(!epoch(input.observedAt))return null;
  const occurredAt=input.occurredAt??null;
  if(occurredAt!==null&&(!epoch(occurredAt)||occurredAt>input.observedAt))return null;
  if(input.evidenceQuality!=='confirmed')return null;
  const eventId=[owner,type,a,b,byEvent?eventPostId:targetPostId].join(':');
  return {eventId,ownerUserId:owner,actorUserId:a,targetUserId:b,direction,type,eventPostId,targetPostId,occurredAt,observedAt:input.observedAt,source:input.source,evidenceQuality:'confirmed',sources:[input.source],timeConflict:false};
}
// A conflicting timestamp is not resolved by last-writer-wins; it remains unknown.
export function mergeEvent(previous,next){
  if(!previous)return next;
  if(previous.eventId!==next.eventId)throw Error('event_identity_mismatch');
  const conflict=previous.timeConflict||next.timeConflict||(previous.occurredAt!==null&&next.occurredAt!==null&&previous.occurredAt!==next.occurredAt);
  return {...previous,
    targetPostId:previous.targetPostId??next.targetPostId,eventPostId:previous.eventPostId??next.eventPostId,
    observedAt:Math.min(previous.observedAt,next.observedAt),
    occurredAt:conflict?null:previous.occurredAt??next.occurredAt,timeConflict:Boolean(conflict),
    sources:[...new Set([...previous.sources,...next.sources])].sort()};
}
// Keep one primary semantic interaction per post/actor/recipient, so a reply's
// implicit mention is not a second interaction. An independent mention remains.
export function primaryEvents(events){
  const primary=new Set(events.filter(e=>e.type==='reply'||e.type==='quote').map(e=>[e.ownerUserId,e.actorUserId,e.targetUserId,e.eventPostId].join(':')));
  return events.filter(e=>e.type!=='mention'||!primary.has([e.ownerUserId,e.actorUserId,e.targetUserId,e.eventPostId].join(':')));
}
