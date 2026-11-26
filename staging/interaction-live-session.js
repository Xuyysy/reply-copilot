import {normalizeSnapshot,mergeConfirmed,ranking} from './interaction-ranking.js';
export const SESSION_MAX_MS=90000, MAX_READS=60, POLL_MS=1500;
const TOKEN=/^[a-f0-9-]{36}$/i;
export function createLiveSession({tabId,now=Date.now()}={}){
  if(!Number.isInteger(tabId)||tabId<0)throw Error('no_tab');
  return {tabId,startedAt:now,reads:0,documentToken:null,owner:null,accumulated:null,snapshot:null,stats:null,stopReason:null};
}
export function acceptRead(session,result,{tabId,now=Date.now()}={}){
  if(session.stopReason)throw Error('session_stopped');
  if(tabId!==session.tabId)throw Error('tab_changed');
  if(now-session.startedAt>SESSION_MAX_MS||session.reads>=MAX_READS)throw Error('session_limit');
  if(!result?.ok)throw Error(result?.reason||'parse_failed');
  if(typeof result.documentToken!=='string'||!TOKEN.test(result.documentToken))throw Error('document_unverified');
  const next=normalizeSnapshot(result);
  if(session.documentToken&&session.documentToken!==result.documentToken)throw Error('document_changed');
  if(session.owner&&session.owner!==next.owner)throw Error('owner_changed');
  const accumulated=mergeConfirmed(session.accumulated,next,tabId);
  return {...session,owner:next.owner,documentToken:result.documentToken,reads:session.reads+1,accumulated,snapshot:next,stats:{scanned:result.scanned,unresolved:result.unresolved,missingTargetRows:result.missingTargetRows,truncated:!!result.truncated}};
}
export function liveRanking(session,{mode='confirmed',type='all',query=''}={}){
  const events=mode==='snapshot'?session?.snapshot?.events??[]:(session?.accumulated?.entries??[]).map(x=>x[1]);
  const q=String(query).trim().toLowerCase().replace(/^@/,'');
  return ranking(events.filter(e=>(type==='all'||e.type===type)&&(!q||e.actor.includes(q))));
}
export function canReadMore(session,now=Date.now()){
  return !!session&&!session.stopReason&&session.reads<MAX_READS&&now-session.startedAt<SESSION_MAX_MS;
}
