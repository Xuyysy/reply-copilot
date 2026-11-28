// Transport-free adapter for local extension alarm bookkeeping. No listener,
// network operation, provider or task invocation is installed by this module.
import {validId} from '../core/events.js';
import {validateAutoSchedule} from './auto-sync-policy.js';
const PREFIX='xrh-local-interaction-schedule:';
const nameFor=owner=>{if(!validId(owner))throw Error('invalid_owner');return PREFIX+owner;};
export function createScheduleClock(alarms){
 if(!alarms||typeof alarms.create!=='function'||typeof alarms.clear!=='function'||typeof alarms.get!=='function')throw Error('alarm_unavailable');
 async function reconcile(schedule){
  const s=validateAutoSchedule(schedule),name=nameFor(s.ownerUserId);
  if(s.state!=='waiting'){await alarms.clear(name);return {armed:false};}
  const alarm=await alarms.get(name);
  if(alarm?.scheduledTime===s.nextAt&&!alarm.periodInMinutes)return {armed:true};
  await alarms.clear(name);
  // A one-shot alarm only records a due time; it cannot invoke a task.
  await alarms.create(name,{when:s.nextAt});
  return {armed:true};
 }
 return {reconcile,clear:owner=>alarms.clear(nameFor(owner)),
  isDue:(alarm,schedule,now)=>{
   const s=validateAutoSchedule(schedule);
   return s.state==='waiting'&&alarm?.name===nameFor(s.ownerUserId)&&alarm.scheduledTime===s.nextAt&&Number.isSafeInteger(now)&&now>=s.nextAt;
  }};
}
