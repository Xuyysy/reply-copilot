// Local interval preference only; not consent and never activates a task.
import {validId} from '../core/events.js';
import {AUTO_INTERVAL_MINUTES} from './auto-sync-policy.js';
const key=owner=>{if(!validId(owner))throw Error('invalid_owner');return 'xrh-interaction-interval-'+owner;};
const valid=v=>AUTO_INTERVAL_MINUTES.includes(v);
export function createSchedulePreferences(storage){
 return {
  async read(owner){const k=key(owner),v=(await storage.get(k))[k];return {intervalMinutes:valid(v)?v:60,enabled:false,reason:'source_unverified'};},
  async write(owner,intervalMinutes){const k=key(owner);if(!valid(intervalMinutes))throw Error('invalid_interval');await storage.set({[k]:intervalMinutes});return {intervalMinutes,enabled:false,reason:'source_unverified'};}
 };
}
