// Staging opt-in bounded DevTools observer. Only reads matching native GET responses.
// Never reads request headers, cookies, request body, HAR exports, or sends X requests.
import {normalizeObservations} from '../interaction-manager/sync/engine.js';
const MAX=2*1024*1024;
export function responseKind(url,source){
 if(typeof url!=='string'||url.length>32768)return null;
 try{
  const u=new URL(url);
  if(!['https://x.com','https://twitter.com'].includes(u.origin)||u.username||u.password)return null;
  if(source==='notification'&&u.pathname==='/i/api/2/notifications/all.json')return 'rest';
  const op=/^\/i\/api\/graphql\/[A-Za-z0-9_-]{8,100}\/(NotificationsTimeline|SearchTimeline)$/.exec(u.pathname)?.[1];
  return source==='notification'&&op==='NotificationsTimeline'?'graphql':source==='post'&&op==='SearchTimeline'?'search':null;
 }catch{return null;}
}
const codes=new Set(['schema_changed','owner_mismatch','page_limit','invalid_pagination','ambiguous_cursor','terminal_unverified','unauthenticated','forbidden','rate_limited','cancelled','identity_changed','owner_unverified','busy','invalid_context','workspace_limit']);
export function createInteractionResponseProbe({network,project,commit,notify,clock=()=>Date.now(),schedule=setTimeout,unschedule=clearTimeout}){
 let active=null;
 function totals(s){return {pages:s.pages,accepted:s.accepted,inserted:s.inserted,skipped:s.skipped,historyComplete:false};}
 function finish(s,report){
  if(active!==s)return;
  active=null;network.onRequestFinished.removeListener(s.listener);network.onNavigated.removeListener(s.navigate);unschedule(s.timer);notify({...totals(s),...report});
 }
 function stop(reason='stopped'){if(active)finish(active,{phase:'stopped',reason,saveMayHaveCompleted:active.committing===true});}
 function start({source,ownerUserId,authorized,maxPages=1}){
  if(active||authorized!==true||![1,5].includes(maxPages)||!['notification','post'].includes(source)||!/^[1-9]\d{0,19}$/.test(ownerUserId))throw Error('invalid_context');
  const s={source,ownerUserId,claimed:false,deadline:clock()+60000,maxPages,pages:0,accepted:0,inserted:0,skipped:0};active=s;
  s.navigate=()=>stop('navigation');
  s.listener=entry=>{
   if(active!==s)return;
   if(clock()>=s.deadline){stop('timeout');return;}
   const kind=responseKind(entry?.request?.url,source);
   if(!kind||entry?.request?.method!=='GET')return;
   const status=entry?.response?.status;
   const reject=reason=>finish(s,{phase:'rejected',reason,source,routeKind:kind,httpStatus:Number.isInteger(status)?status:null,saveMayHaveCompleted:s.committing===true});
   if(status!==200){reject(({401:'unauthenticated',403:'forbidden',429:'rate_limited'})[status]??'source_error');return;}
   // Never queue raw bodies; if a second response arrives during a save, count it as skipped.
   if(s.claimed){s.skipped++;return;}
   s.claimed=true;
   if(entry?.response?.content?.size>MAX){reject('page_limit');return;}
   try{entry.getContent(async(body,encoding)=>{
    if(active!==s)return;
    if(clock()>=s.deadline){stop('timeout');return;}
    if(encoding||typeof body!=='string'||!body.length||body.length>MAX||new TextEncoder().encode(body).length>MAX){reject('invalid_body');return;}
    try{
     const parsed=normalizeObservations(project(JSON.parse(body),kind,ownerUserId,{observedSample:true}),{ownerUserId,source,observedAt:clock()});
     if(parsed.stats?.unsupported||parsed.stats?.unresolvedActors||parsed.events.length>1000||parsed.users.length>2000){reject('schema_changed');return;}
     if(active!==s||clock()>=s.deadline){stop('timeout');return;}
     s.committing=true;
     const result=await commit({events:parsed.events.filter(e=>e.direction==='inbound'),users:parsed.users,sequence:s.pages+1});
     if(active!==s)return;
     s.committing=false;s.pages++;s.accepted+=result.accepted;s.inserted+=result.inserted;
     const report={source,routeKind:kind,httpStatus:200,quality:parsed.quality};
     if(s.pages>=s.maxPages){finish(s,{phase:'saved',...report});return;}
     s.claimed=false;notify({phase:'progress',...totals(s),...report});
    }catch(e){reject(codes.has(e?.message)?e.message:'source_error');}
   });}catch{reject('body_unavailable');}
  };
  try{network.onRequestFinished.addListener(s.listener);network.onNavigated.addListener(s.navigate);s.timer=schedule(()=>stop('timeout'),60000);}
  catch{finish(s,{phase:'rejected',reason:'devtools_unavailable'});return;}
  notify({phase:'waiting',source,...totals(s),maxPages});
 }
 return {start,stop,get active(){return active!==null;}};
}
