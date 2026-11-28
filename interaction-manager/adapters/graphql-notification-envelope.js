// Pure, bounded schema adapter for an already supplied GraphQL notifications
// envelope. No network, browser session, credentials, endpoint or route logic.
// Deliberately narrower than generic recursive tweet walking.
import {validId} from '../core/events.js';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const objectAt=(x,...keys)=>keys.reduce((v,k)=>record(v)?v[k]:undefined,x);
const fail=code=>{throw Error(code);};
export function inspectNotificationTimelineEnvelope(payload,{ownerUserId}={}){
 if(Array.isArray(payload?.errors)&&payload.errors.length)fail('schema_changed');
 const data=objectAt(payload,'data');
 if(!record(data)||!Object.hasOwn(data,'viewer_v2')&&!Object.hasOwn(data,'viewer'))return null;
 if(!validId(ownerUserId))fail('invalid_notification_context');
 const root=data.viewer_v2??data.viewer;
 const viewer=objectAt(root,'user_results','result');
 if(!record(viewer))fail('schema_changed');
 const ids=[viewer.rest_id,objectAt(viewer,'legacy','id_str')].filter(x=>x!==undefined&&x!==null);
 if(ids.some(x=>!validId(x)||x!==ownerUserId))fail('owner_mismatch');
 const candidates=[
  objectAt(viewer,'notification_timeline','timeline','instructions'),
  objectAt(viewer,'notification_timeline','instructions'),
  objectAt(viewer,'timeline','instructions'),
  objectAt(viewer,'timeline','timeline','instructions'),
  objectAt(viewer,'timeline_v2','timeline','instructions'),
 ];
 const present=candidates.filter(x=>x!==undefined&&x!==null);
 if(!present.length||present.some(x=>!Array.isArray(x))||present.some(x=>x!==present[0])||present[0].length>500)fail('schema_changed');
 const notifications=[];let ignored=0,entryCount=0,terminal=false;
 const cursors=new Set();
 const addCursor=c=>{
  if(!record(c)||(c.cursorType!=='Bottom'&&c.cursor_type!=='Bottom'))return;
  if(typeof c.value!=='string'||!c.value||c.value.length>2048)fail('invalid_pagination');
  cursors.add(c.value);
 };
 const acceptItem=item=>{
  if(item?.__typename==='TimelineNotification'){
   if(notifications.length>=2000)fail('page_limit');
   notifications.push(item);
  }else if(item!==undefined&&item!==null)ignored++;
 };
 for(const ins of present[0]){
  if(!record(ins))fail('schema_changed');
  if(ins.type==='TimelineTerminateTimeline'&&ins.direction==='Bottom'||objectAt(ins,'terminateTimeline','direction')==='Bottom')terminal=true;
  let entries=[];
  for(const candidate of [ins.entries,objectAt(ins,'addEntries','entries')]){
   if(candidate===undefined||candidate===null)continue;
   if(!Array.isArray(candidate))fail('schema_changed');
   entries.push(...candidate);
  }
  for(const entry of [ins.entry,objectAt(ins,'replaceEntry','entry')])if(entry!==undefined&&entry!==null)entries.push(entry);
  if((entryCount+=entries.length)>2000)fail('page_limit');
  for(const entry of entries){
   const content=objectAt(entry,'content');
   if(!record(content)){ignored++;continue;}
   addCursor(content);
   addCursor(objectAt(content,'operation','cursor'));
   const item=content.itemContent??objectAt(content,'item','content');
   if(item!==undefined&&item!==null)acceptItem(item);
   if(content.items!==undefined&&content.items!==null){
    if(!Array.isArray(content.items)||content.items.length>100)fail('page_limit');
    for(const row of content.items)acceptItem(objectAt(row,'item','itemContent')??objectAt(row,'item','content','itemContent'));
   }
  }
 }
 if(cursors.size>1||terminal&&cursors.size)fail('ambiguous_cursor');
 if(!terminal&&!cursors.size)fail('terminal_unverified');
 return {notifications,ignored,nextCursor:terminal?null:[...cursors][0],done:terminal,viewerVerified:ids.length>0};
}
