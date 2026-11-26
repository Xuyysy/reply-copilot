import {fixturePage,FIXTURE_OWNER} from "./fixture.js";
import {parseRelationshipResponse} from "./response-adapter.js";
// Deterministic test source. Viewer identity is simulated; never establishes actual X ownership.
export function createFixtureSource(size){
 if(!Number.isSafeInteger(size)||size<0||size>50000)throw Error("invalid_fixture_size");
 const identity=Object.freeze({ownerUserId:FIXTURE_OWNER,sessionId:crypto.randomUUID(),source:"fixture"});
 return Object.freeze({
  kind:"fixture",
  async readIdentity(){return identity;},
  async page({ownerUserId,kind,cursor,signal}){
   if(signal?.aborted)throw Error("cancelled");
   if(ownerUserId!==identity.ownerUserId)throw Error("identity_changed");
   const p=fixturePage(kind,cursor,size);
   const entries=p.users.map(u=>({entryId:"user-"+u.userId,content:{entryType:"TimelineTimelineItem",itemContent:{itemType:"TimelineUser",user_results:{result:{
    __typename:"User",rest_id:u.userId,core:{screen_name:u.handle,name:u.displayName},legacy:{followers_count:u.followersCount,friends_count:u.followingCount},...(u.verificationType==="blue"?{is_blue_verified:true}:{})
   }}}}}));
   if(!p.terminal)entries.push({entryId:"cursor-bottom",content:{entryType:"TimelineTimelineCursor",cursorType:"Bottom",value:p.nextCursor}});
   const instructions=[{type:"TimelineAddEntries",entries}];if(p.terminal)instructions.push({type:"TimelineTerminateTimeline",direction:"Bottom"});
   return parseRelationshipResponse({ownerUserId,kind,cursor,expected:size,observedAt:new Date().toISOString(),status:200,
    payload:{data:{user:{result:{__typename:"User",rest_id:ownerUserId,timeline_v2:{timeline:{instructions}}}}}}});
  }
 });
}
