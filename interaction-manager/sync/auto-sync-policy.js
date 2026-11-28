// Transport-neutral opt-in scheduling policy. No timer, network, credentials
// or live provider is registered here. The caller must durably serialize claims.
import {validId} from '../core/events.js';
export const AUTO_INTERVAL_MINUTES=Object.freeze([30,60,120]);
const timeOk=n=>Number.isSafeInteger(n)&&n>=0;
const providerOk=v=>typeof v==='string'&&/^[a-z0-9-]{1,50}$/.test(v);
const tokenOk=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
function next(now,minutes){if(!timeOk(now)||!AUTO_INTERVAL_MINUTES.includes(minutes)||!timeOk(now+minutes*60000))throw Error('invalid_schedule');return now+minutes*60000;}
export function validateAutoSchedule(s){
 if(!s||!validId(s.ownerUserId)||!providerOk(s.providerId)||!AUTO_INTERVAL_MINUTES.includes(s.intervalMinutes)||!tokenOk(s.scheduleId)||!['waiting','running','paused','disabled'].includes(s.state))throw Error('invalid_schedule');
 if(s.state==='waiting'?!timeOk(s.nextAt):s.nextAt!==null)throw Error('invalid_schedule');
 if(s.state==='running'?!tokenOk(s.runId):s.runId!==null)throw Error('invalid_schedule');
 return s;
}
const pause=(s,reason,state='paused')=>({...s,state,reason,nextAt:null,runId:null});
const matches=(s,g)=>g?.approved===true&&g?.authorized===true&&g.ownerUserId===s.ownerUserId&&g.providerId===s.providerId&&g.bindingVerified===true;
export function enableAutoSync({ownerUserId,providerId,scheduleId,intervalMinutes=60,now,gate}){
 const s=validateAutoSchedule({ownerUserId,providerId,scheduleId,intervalMinutes,state:'waiting',nextAt:next(now,intervalMinutes),runId:null,reason:null});
 if(!matches(s,gate))throw Error('schedule_not_authorized');
 return s;
}
export function claimAutoSync(schedule,{now,gate,busy=false,runId}={}){
 const s=validateAutoSchedule(schedule);if(!timeOk(now))throw Error('invalid_schedule');
 if(s.state==='disabled'||s.state==='paused')return {action:'none',schedule:s};
 if(!matches(s,gate))return {action:'none',schedule:pause(s,'authorization_changed')};
 if(s.state==='running'||busy||now<s.nextAt)return {action:'none',schedule:s};
 if(!tokenOk(runId))throw Error('invalid_schedule');
 return {action:'run',schedule:{...s,state:'running',runId,nextAt:null,reason:null}};
}
export function settleAutoSync(schedule,{scheduleId,runId,reason,now,gate}={}){
 const s=validateAutoSchedule(schedule);
 if(s.state!=='running'||s.scheduleId!==scheduleId||s.runId!==runId)return s;
 if(!timeOk(now))throw Error('invalid_schedule');
 if(!matches(s,gate))return pause(s,'authorization_changed');
 // No catch-up burst: the next due time is measured from completion.
 if(reason==='source_exhausted'||reason==='page_limit')return {...s,state:'waiting',reason,runId:null,nextAt:next(now,s.intervalMinutes)};
 const known=['rate_limited','forbidden','unauthenticated','schema_changed','identity_changed','cancelled','time_limit','source_error','source_unavailable'];
 return pause(s,known.includes(reason)?reason:'sync_failed');
}
export function stopAutoSync(schedule){return pause(validateAutoSchedule(schedule),'user_disabled','disabled');}
export function recoverAutoSync(schedule){const s=validateAutoSchedule(schedule);return s.state==='running'?pause(s,'interrupted'):s;}
