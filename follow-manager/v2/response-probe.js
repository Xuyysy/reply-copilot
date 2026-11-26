// Single-response developer acceptance probe. No network transport, no credential
// access, no replay, no storage, no background listener and no real completeness claim.
import {stableId} from "./model.js";
import {inspectResponseShape} from "./source-diagnostics.js";
import {classifyResponseStatus} from "./response-adapter.js";
const MAX_BODY=2*1024*1024;
const KINDS=new Set(["followers","following"]);
export function matchesRelationshipRequest(url,kind){
 if(!KINDS.has(kind)||typeof url!=="string"||url.length>32768)return false;
 try{
  const u=new URL(url);
  if(!["https://x.com","https://twitter.com"].includes(u.origin)||u.username||u.password)return false;
  const match=/^\/i\/api\/graphql\/[A-Za-z0-9_-]{1,128}\/(Followers|Following)\/?$/.exec(u.pathname);
  return match?.[1].toLowerCase()===kind;
 }catch{return false;}
}
export function createResponseProbe({network,notify,clock=()=>Date.now(),schedule=setTimeout,unschedule=clearTimeout}){
 let state=null;
 const emit=event=>notify(event);
 function finish(s,report){
  if(state!==s)return;
  state=null;
  network.onRequestFinished.removeListener(s.listener);
  network.onNavigated.removeListener(s.navigate);
  unschedule(s.timer);
  emit(report);
 }
 function stop(reason="stopped"){if(state)finish(state,{phase:"stopped",reason});}
 function start({ownerUserId,kind,authorized}){
  if(state)throw Error("already_running");
  if(authorized!==true||!stableId(ownerUserId)||!KINDS.has(kind))throw Error("invalid_probe_context");
  const s={ownerUserId,kind,claimed:false,deadline:clock()+60000};
  state=s;
  const complete=report=>finish(s,report);
  s.navigate=()=>stop("navigation");
  s.listener=entry=>{
   if(state!==s||s.claimed)return;
   if(clock()>=s.deadline){stop("timeout");return;}
   // Intentionally read only the URL and response status/size. Never inspect
   // request/response headers, postData, HAR exports or credentials.
   if(!matchesRelationshipRequest(entry?.request?.url,s.kind))return;
   s.claimed=true;
   network.onRequestFinished.removeListener(s.listener);
   const status=entry?.response?.status;
   const failure=classifyResponseStatus(status);
   if(failure){complete({phase:"rejected",kind:s.kind,reason:failure});return;}
   const size=entry?.response?.content?.size;
   if(typeof size==="number"&&size>MAX_BODY){complete({phase:"rejected",kind:s.kind,reason:"response_too_large"});return;}
   try{entry.getContent((body,encoding)=>{
    if(state!==s)return;
    if(clock()>=s.deadline){stop("timeout");return;}
    if(encoding||typeof body!=="string"||!body.length||body.length>MAX_BODY||new TextEncoder().encode(body).length>MAX_BODY){
     complete({phase:"rejected",kind:s.kind,reason:"unsupported_or_oversize_body"});return;
    }
    let payload;try{payload=JSON.parse(body)}catch{complete({phase:"rejected",kind:s.kind,reason:"invalid_json"});return;}
    // Only the explicitly supplied target is eligible. A target ID does not
    // establish the signed-in viewer's identity. Never emit a mismatched payload.
    if(payload?.data?.user?.result?.rest_id!==s.ownerUserId){
     complete({phase:"rejected",kind:s.kind,reason:"target_mismatch"});return;
    }
    const result=inspectResponseShape({ownerUserId:s.ownerUserId,kind:s.kind,cursor:null,expected:null,observedAt:new Date(clock()).toISOString(),status,payload});
    complete({phase:"observed",kind:s.kind,report:result});
   });}catch{complete({phase:"rejected",kind:s.kind,reason:"body_unavailable"});}
  };
  try{
   network.onRequestFinished.addListener(s.listener);
   network.onNavigated.addListener(s.navigate);
   s.timer=schedule(()=>{if(state===s)stop("timeout")},60000);
  }catch{finish(s,{phase:"rejected",kind,reason:"devtools_unavailable"});return;}
  emit({phase:"waiting",kind});
 }
 return {start,stop,get active(){return state!==null}};
}
