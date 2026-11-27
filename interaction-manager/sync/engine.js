// Transport-neutral synchronizer. Only trusted extension code may supply a provider.
// A provider is NOT implemented by this module; fixture identity is not live X identity.
import {validId,normalizeEvent,mergeEvent} from '../core/events.js';
import {parseNotificationPayload} from '../adapters/notification-payload.js';
import {parsePostEvidence} from '../adapters/post-evidence.js';
import {decodeWebPostRecords} from '../adapters/web-post-records.js';
import {beginSession,endSession,openSyncJob,commitBatch,readEventPage,readCoverage,readUsers} from '../storage/repository.js';
import {rankInteractions} from '../analytics/ranking.js';
import {safeSyncDiagnostic} from './diagnostic.js';
const STATUS=new Map([[401,'unauthenticated'],[403,'forbidden'],[429,'rate_limited']]);
const validCursor=v=>v===null||typeof v==='string'&&v.length>0&&v.length<=2048;
const fail=code=>{throw Error(code);};
function identity(value,owner,previous=null){
  if(!validId(value?.ownerUserId)||value.ownerUserId!==owner||typeof value.sessionId!=='string'||!value.sessionId||value.sessionId.length>128||previous!==null&&value.sessionId!==previous)fail('identity_changed');
  return value.sessionId;
}
function check(signal,deadline){if(signal?.aborted)fail('cancelled');if(Date.now()>=deadline)fail('time_limit');}
// Bound waiting on an injected provider; cancellation also fences all subsequent commits.
async function bounded(fn,signal,deadline){
  check(signal,deadline);
  let timer,abort;
  try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Error('time_limit')),Math.max(0,deadline-Date.now()));
    abort=()=>reject(Error('cancelled'));
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  })]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function normalizePage(page,{ownerUserId,source,cursor,observedAt=Date.now()}){
  if(!page||!Number.isInteger(page.status))fail('invalid_response');
  if(page.status!==200)fail(STATUS.get(page.status)??'source_error');
  if(page.ownerUserId!==ownerUserId||page.source!==source||page.requestCursor!==cursor)fail('response_mismatch');
  if(typeof page.done!=='boolean'||!validCursor(page.nextCursor)||page.done!==(page.nextCursor===null)||!page.done&&page.nextCursor===cursor)fail('invalid_pagination');
  // Provider is responsible for proving a known timeline shape and explicit terminal evidence.
  if(page.structureVerified!==true||page.done&&page.terminalEvidence!=='explicit')fail('schema_changed');
  // The provider may supply an explicit bounded array of structured posts.
  // Never traverse arbitrary response trees or assume a referenced post is an event.
  const decoded=page.webPosts===undefined?null:decodeWebPostRecords(page.webPosts,{observedAt});
  const suppliedPosts=decoded?[...(page.posts??[]),...decoded.posts]:page.posts;
  const parsed=source==='notification'?parseNotificationPayload(page.payload,{ownerUserId,observedAt}):parsePostEvidence(suppliedPosts,{ownerUserId,observedAt});
  if(source==='notification'&&Array.isArray(suppliedPosts)){
    const posts=parsePostEvidence(suppliedPosts,{ownerUserId,observedAt});
    const byId=new Map(parsed.events.map(e=>[e.eventId,e]));
    for(const raw of posts.events){const e=normalizeEvent({...raw,source:'notification'},ownerUserId);if(e)byId.set(e.eventId,mergeEvent(byId.get(e.eventId),e));}
    parsed.events=[...byId.values()];
  }
  parsed.users=[...(parsed.users??[]),...(decoded?.users??[]),...(Array.isArray(page.users)?page.users:[]).map(u=>({...u,observedAt}))];
  if(parsed.stats?.truncated||parsed.events.length>1000)fail('page_limit');
  if(source==='notification'&&parsed.stats.unsupported>0&&parsed.stats.unsupported+parsed.stats.outOfScope===parsed.stats.rows)fail('schema_changed');
  const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000?v:0;
  const quality={unsupported:count(parsed.stats?.unsupported),unresolvedActors:count(parsed.stats?.unresolvedActors),foreignTargets:count(parsed.stats?.foreignTargets),ignored:Math.min(100000,count(page.ignored)+count(decoded?.ignored)+count(parsed.stats?.outOfScope))};
  return {...parsed,quality,nextCursor:page.nextCursor,done:page.done,observedAt};
}
export async function syncInteractions(db,provider,{ownerUserId,source='notification',refresh=false,maxPages=30,maxMs=90000,signal,onProgress=()=>{}}={}){
  if(!validId(ownerUserId)||!['notification','post'].includes(source)||!provider||typeof provider.identify!=='function'||typeof provider.readPage!=='function'||!Number.isInteger(maxPages)||maxPages<1||maxPages>100||!Number.isInteger(maxMs)||maxMs<1||maxMs>120000)fail('invalid_sync');
  const deadline=Date.now()+maxMs;let session=null,job=null,inserted=0,committed=0,stage='identity',httpStatus=null;
  try{
    const sessionId=identity(await bounded(()=>provider.identify({signal}),signal,deadline),ownerUserId);
    check(signal,deadline);
    stage='checkpoint';
    session=await beginSession(db,ownerUserId);
    job=await openSyncJob(db,session,{providerId:provider.id,source,refresh});
    while(!job.done&&committed<maxPages){
      stage='identity';httpStatus=null;
      check(signal,deadline);
      identity(await bounded(()=>provider.identify({signal}),signal,deadline),ownerUserId,sessionId);
      stage='read';
      const page=await bounded(()=>provider.readPage({ownerUserId,source,cursor:job.cursor,signal}),signal,deadline);
      stage='validate';httpStatus=page?.status;
      const parsed=normalizePage(page,{ownerUserId,source,cursor:job.cursor});
      if(parsed.nextCursor!==null&&job.seen.includes(parsed.nextCursor))fail('cursor_cycle');
      stage='identity';
      identity(await bounded(()=>provider.identify({signal}),signal,deadline),ownerUserId,sessionId);
      check(signal,deadline);
      stage='commit';
      const result=await commitBatch(db,session,parsed.events,{source,cursor:parsed.nextCursor,reason:parsed.done?'source_exhausted':'partial',observedAt:parsed.observedAt,users:parsed.users??[],signal,checkpoint:{providerId:provider.id,revision:job.revision,nextCursor:parsed.nextCursor,done:parsed.done,quality:parsed.quality}});
      job=result.job;inserted+=result.inserted;committed++;
      try{onProgress({pages:committed,inserted,done:job.done,stats:parsed.stats??{rejected:parsed.rejected}});}catch{}
    }
    return {reason:job.done?'source_exhausted':'page_limit',committed,inserted,historyComplete:false};
  }catch(e){
    // Return only known status codes, not provider error bodies, cursors or credentials.
    const known=new Set(['cancelled','time_limit','identity_changed','unauthenticated','forbidden','rate_limited','source_error','response_mismatch','invalid_pagination','schema_changed','page_limit','cursor_cycle','stale_session','stale_checkpoint','history_limit','invalid_job','invalid_checkpoint','open_notifications','owner_unverified','endpoint_not_observed','owner_mismatch','session_limit','invalid_cursor','ambiguous_cursor','terminal_unverified','workspace_limit']);
    const reason=known.has(e?.message)?e.message:'sync_failed';
    return {reason,committed,inserted,historyComplete:false,diagnostic:safeSyncDiagnostic(stage,e?.message,httpStatus)};
  }finally{if(session)await endSession(db,session).catch(()=>{});}
}
// Separate read session; callers must authenticate the currently selected owner first.
export async function readSyncRanking(db,session,options={}){
  const rows=[];let after=null;
  do{const p=await readEventPage(db,session,{after,limit:1000});rows.push(...p.rows);if(rows.length>50000)fail('workspace_limit');after=p.next;}while(after);
  const users=new Map((await readUsers(db,session)).map(u=>[u.userId,u]));
  const ranked=rankInteractions(rows,{...options,ownerUserId:session.ownerUserId});
  return {...ranked,people:ranked.people.map(p=>({...p,handle:users.get(p.userId)?.handle??null})),coverage:await readCoverage(db,session),stored:rows.length};
}
