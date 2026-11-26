// Local-only shape report. Pass a redacted response body and explicit request context.
// Never include user IDs, handles, cursors, response messages, raw values or request headers in output.
import {parseRelationshipResponse} from "./response-adapter.js";
const KNOWN=new Set(["invalid_context","access_denied","rate_limited","source_unavailable","source_error","unexpected_status","response_error","target_mismatch","unknown_timeline","unknown_instruction","ambiguous_terminal","page_capacity","unknown_entry","ambiguous_cursor","unresolved_user","user_entry_mismatch","conflicting_user","unknown_end"]);
const bounded=n=>Number.isSafeInteger(n)&&n>=0?Math.min(n,10000):0;
export function inspectResponseShape(context){
 const root=context?.payload?.data?.user?.result;
 const modern=root?.timeline_v2?.timeline,legacy=root?.timeline?.timeline;
 const timeline=modern??legacy;
 const instructions=Array.isArray(timeline?.instructions)?timeline.instructions:[];
 const shape={timeline:modern&&legacy?"both":modern?"modern":legacy?"legacy":"missing",instructions:bounded(instructions.length),
  targetIdPresent:typeof root?.rest_id==="string",targetMatches:typeof context?.ownerUserId==="string"&&root?.rest_id===context.ownerUserId,
  directItems:0,nestedItems:0,modules:0,bottomCursors:0,explicitTerminations:0,otherEntries:0};
 for(const i of instructions.slice(0,1000)){
  if(i?.type==="TimelineTerminateTimeline"&&i.direction==="Bottom")shape.explicitTerminations++;
  for(const e of (Array.isArray(i?.entries)?i.entries:[]).slice(0,1100)){
   const c=e?.content;
   if(c?.entryType==="TimelineTimelineCursor"&&c.cursorType==="Bottom")shape.bottomCursors++;
   else if(c?.entryType==="TimelineTimelineModule")shape.modules++;
   else if(c?.itemContent?.user_results)shape.directItems++;
   else if(c?.item?.itemContent?.user_results||c?.item?.content?.itemContent?.user_results||c?.content?.itemContent?.user_results)shape.nestedItems++;
   else if(c?.entryType!=="TimelineTimelineCursor")shape.otherEntries++;
  }
 }
 for(const k of ["directItems","nestedItems","modules","bottomCursors","explicitTerminations","otherEntries"])shape[k]=bounded(shape[k]);
 try{const p=parseRelationshipResponse(context);return {format:"xrh-follow-shape-v1",shape,parser:"accepted",users:p.users.length,terminal:p.terminal,coverage:"unverified_source"}}
 catch(e){return {format:"xrh-follow-shape-v1",shape,parser:"rejected",reason:KNOWN.has(e?.message)?e.message:"unrecognized_error",coverage:"unverified_source"}}
}
