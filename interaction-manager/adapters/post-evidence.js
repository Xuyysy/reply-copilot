// Explicit tweet relationship evidence only. Does not infer @mentions from prose.
import {validId,normalizeEvent,mergeEvent,primaryEvents} from '../core/events.js';
export function parsePostEvidence(posts,{ownerUserId,observedAt=Date.now()}={}){
  if(!validId(ownerUserId)||!Number.isSafeInteger(observedAt)||observedAt<=0||!Array.isArray(posts)||posts.length>20000)throw Error('invalid_post_context');
  const events=new Map();let rejected=0;
  for(const p of posts){
    if(!p||!validId(p.postId)||!validId(p.authorUserId)){rejected++;continue;}
    const candidates=[];
    if(p.repostedUserId!=null||p.repostedPostId!=null){
      if(!validId(p.repostedUserId)||!validId(p.repostedPostId)){rejected++;continue;}
      candidates.push(['repost',p.repostedUserId,p.repostedPostId]);
    }else{
    if(validId(p.replyToUserId)&&validId(p.replyToPostId))candidates.push(['reply',p.replyToUserId,p.replyToPostId]);
    if(validId(p.quotedUserId)&&validId(p.quotedPostId))candidates.push(['quote',p.quotedUserId,p.quotedPostId]);
    if(Array.isArray(p.mentionedUserIds)&&p.mentionedUserIds.length<=100)for(const u of new Set(p.mentionedUserIds))if(validId(u))candidates.push(['mention',u,null]);
    }
    for(const [type,targetUserId,targetPostId] of candidates){
      if(targetUserId!==ownerUserId&&p.authorUserId!==ownerUserId)continue;
      const e=normalizeEvent({ownerUserId,actorUserId:p.authorUserId,targetUserId,type,eventPostId:p.postId,targetPostId,occurredAt:p.createdAt??null,observedAt,source:'post',evidenceQuality:'confirmed'},ownerUserId);
      if(!e){rejected++;continue;}
      events.set(e.eventId,mergeEvent(events.get(e.eventId),e));
    }
  }
  return {events:primaryEvents([...events.values()]),rejected,historyComplete:false};
}
