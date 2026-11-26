// Pure parser for a bounded, synthetic/redacted representation of a relationship response.
// No transport, credential access, endpoint discovery, or live authorization is provided here.
import {stableId,userRef} from "./model.js";
const KINDS=new Set(["followers","following"]);
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
function error(code){throw Error(code)}
function user(result,observedAt){
 if(!object(result)||result.__typename!=="User"||!stableId(result.rest_id))error("unresolved_user");
 const core=object(result.core)?result.core:{},legacy=object(result.legacy)?result.legacy:{};
 const verificationType=result.verified_type==="Business"?"gold":result.verified_type==="Government"?"grey":result.is_blue_verified===true?"blue":null;
 return userRef({userId:result.rest_id,handle:core.screen_name??legacy.screen_name,displayName:core.name??legacy.name,
  avatarUrl:result.avatar?.image_url??legacy.profile_image_url_https,description:legacy.description,followersCount:legacy.followers_count,
  followingCount:legacy.friends_count,postsCount:legacy.statuses_count,createdAt:core.created_at??legacy.created_at,
  protected:typeof result.privacy?.protected==="boolean"?result.privacy.protected:legacy.protected,
  verificationType,isBlueVerified:typeof result.is_blue_verified==="boolean"?result.is_blue_verified:null},observedAt);
}
export function classifyResponseStatus(status){
 if(status===401||status===403)return "access_denied";
 if(status===429)return "rate_limited";
 if(status===404)return "source_unavailable";
 if(status>=500&&status<=599)return "source_error";
 if(status!==200)return "unexpected_status";
 return null;
}
export function parseRelationshipResponse({ownerUserId,kind,cursor,expected,observedAt,status,payload}){
 if(!stableId(ownerUserId)||!KINDS.has(kind)||!(cursor===null||typeof cursor==="string"&&cursor.length>0&&cursor.length<=512)||
   !(expected===null||integer(expected))||typeof observedAt!=="string"||!Number.isFinite(Date.parse(observedAt)))error("invalid_context");
 const failure=classifyResponseStatus(status);if(failure)error(failure);
 if(!object(payload)||Object.hasOwn(payload,"errors")&&(!Array.isArray(payload.errors)||payload.errors.length>0))error("response_error");
 const root=payload.data?.user?.result;
 // A response's target profile is not proof of the viewer's logged-in identity.
 if(!object(root)||root.__typename!=="User"||root.rest_id!==ownerUserId)error("target_mismatch");
 const timeline=root.timeline_v2?.timeline??root.timeline?.timeline;
 if(!object(timeline)||!Array.isArray(timeline.instructions)||timeline.instructions.length>1000)error("unknown_timeline");
 let nextCursor=null,hasBottom=false,terminal=false,entryCount=0,unresolved=0;
 const users=new Map();
 for(const instruction of timeline.instructions){
  if(!object(instruction))error("unknown_instruction");
  if(instruction.type==="TimelineTerminateTimeline"){
   if(instruction.direction!=="Bottom"||terminal)error("ambiguous_terminal");terminal=true;continue;
  }
  if(instruction.type!=="TimelineAddEntries"||!Array.isArray(instruction.entries))error("unknown_instruction");
  for(const entry of instruction.entries){
   if(++entryCount>1100)error("page_capacity");
   const c=entry?.content;
   if(!object(c))error("unknown_entry");
   if(c.entryType==="TimelineTimelineCursor"){
    if(c.cursorType==="Top")continue;
    if(c.cursorType!=="Bottom"||hasBottom||typeof c.value!=="string"||!c.value.length||c.value.length>512)error("ambiguous_cursor");
    hasBottom=true;nextCursor=c.value;continue;
   }
   if(c.entryType!=="TimelineTimelineItem"||c.itemContent?.itemType!=="TimelineUser")error("unknown_entry");
   let u;try{u=user(c.itemContent.user_results?.result,observedAt)}catch(e){if(e.message!=="unresolved_user")throw e;unresolved++;continue;}
   // An unresolved or conflicting identity is evidence of missing coverage.
   if(entry.entryId!=="user-"+u.userId)error("user_entry_mismatch");
   if(users.has(u.userId)){const prior=users.get(u.userId);if(prior.handle!==u.handle||prior.isBlueVerified!==u.isBlueVerified)error("conflicting_user");}
   else users.set(u.userId,u);
  }
 }
 if(terminal&&hasBottom)error("ambiguous_terminal");
 if(!terminal&&!hasBottom)error("unknown_end");
 if(unresolved)error("unresolved_user");
 return {cursor,users:[...users.values()],expected,terminal,nextCursor:terminal?null:nextCursor,
  coverage:"unverified_source",observedAt};
}
