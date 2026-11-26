import {validId} from '../core/events.js';
import {parseNotificationPayload} from '../adapters/notification-payload.js';
import {parsePostEvidence} from '../adapters/post-evidence.js';
// The offline workspace is deliberately separate from verified live sessions.
// A file's declared owner is not proof of the user's current X identity.
export const OFFLINE_DB='reply-copilot-interactions-offline-v1';
export const MAX_FILE_BYTES=8*1024*1024;
export function parseImport(text,now=Date.now()){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_FILE_BYTES)throw Error('file_too_large');
  const data=JSON.parse(text);
  if(data?.format!=='xrh-interaction-evidence-v1'||!validId(data.ownerUserId)||!['notification','post'].includes(data.kind))throw Error('invalid_file');
  const observedAt=data.observedAt??now;
  if(!Number.isSafeInteger(observedAt)||observedAt<=0||observedAt>now)throw Error('invalid_observation_time');
  const context={ownerUserId:data.ownerUserId,observedAt};
  const result=data.kind==='notification'?parseNotificationPayload(data.payload,context):parsePostEvidence(data.posts,context);
  if(result.stats?.truncated)throw Error('source_limit');
  if(result.events.length>20000)throw Error('source_limit');
  const participants=new Set(result.events.flatMap(e=>[e.actorUserId,e.targetUserId]));
  const users=new Map((result.users??[]).map(u=>[u.userId,u]));
  if(data.users!==undefined&&(!Array.isArray(data.users)||data.users.length>20000))throw Error('invalid_users');
  for(const u of data.users??[])if(u&&participants.has(u.userId)&&validId(u.userId)&&typeof u.handle==='string'&&/^[A-Za-z0-9_]{1,15}$/.test(u.handle))users.set(u.userId,{userId:u.userId,handle:u.handle,observedAt});
  // Only normalized event fields survive. Raw content and unrelated payloads never persist.
  return {ownerUserId:data.ownerUserId,source:data.kind,observedAt,events:result.events,users:[...users.values()],stats:result.stats??{rejected:result.rejected}};
}
