// Offline parser for already authorized, locally provided payloads only.
// No network, cookies, endpoint discovery or capture hooks.
// Shapes are based on public X-Insights fixtures; live X compatibility is not yet validated.
import {validId,normalizeEvent,mergeEvent} from '../core/events.js';
import {inspectNotificationTimelineEnvelope} from './graphql-notification-envelope.js';
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:null;
const arr=v=>Array.isArray(v)?v:[];
const stable=(...ids)=>{const known=ids.filter(x=>x!==undefined&&x!==null);return known.length&&known.every(validId)&&new Set(known).size===1?known[0]:null;};
const ref=(id,value)=>{const handle=value?.core?.screen_name??value?.legacy?.screen_name??value?.screen_name;return validId(id)&&typeof handle==='string'&&/^[A-Za-z0-9_]{1,15}$/.test(handle)?{userId:id,handle}:null;};
const typeOf=icon=>icon==='heart_icon'?'like':icon==='retweet_icon'?'repost':null;
function modernTweet(raw){
  let t=obj(raw);
  if(t?.__typename==='TweetWithVisibilityResults')t=obj(t.tweet);
  if(!t||t.__typename&&t.__typename!=='Tweet')return null;
  const id=stable(t.rest_id,t.legacy?.id_str);
  const user=t.core?.user_results?.result;
  const owner=stable(user?.rest_id,user?.legacy?.id_str,t.legacy?.user_id_str);
  return id&&owner?{id,owner}:null;
}
// Known out-of-scope follow notices are not malformed interaction rows.
// Require an explicit actor shape and no target posts; ambiguous/unknown kinds
// remain unsupported. Icon mapping corroborated by X-Insights notification parser.
const noTargets=v=>v===undefined||Array.isArray(v)&&v.length===0;
function modern(row){
  const type=typeOf(row.notification_icon), template=obj(row.template);
  if(row.notification_icon==='person_icon'&&template&&noTargets(template.target_objects)&&Array.isArray(template.from_users)&&template.from_users.length>0&&template.from_users.length<=1000&&template.from_users.every(u=>{const v=u?.user_results?.result;return !!stable(v?.rest_id,v?.legacy?.id_str);}))return {outOfScope:true};
  if(!type||!template||arr(template.target_objects).length!==1)return null;
  const target=modernTweet(template.target_objects[0]?.tweet_results?.result);
  if(!target)return null;
  const actors=arr(template.from_users).map(u=>{const v=u?.user_results?.result;const id=stable(v?.rest_id,v?.legacy?.id_str);return {id,user:ref(id,v)};});
  return {type,target,actors};
}
function legacy(row,tweets,users){
  const type=typeOf(row?.icon?.id), agg=obj(row?.template?.aggregateUserActionsV1);
  if(row?.icon?.id==='person_icon'&&agg&&noTargets(agg.targetObjects)&&Array.isArray(agg.fromUsers)&&agg.fromUsers.length>0&&agg.fromUsers.length<=1000&&agg.fromUsers.every(u=>!!stable(u?.user?.id,u?.user?.id_str)))return {outOfScope:true};
  if(!type||!agg||arr(agg.targetObjects).length!==1)return null;
  const id=agg.targetObjects[0]?.tweet?.id;
  if(!validId(id)||!Object.hasOwn(tweets,id))return null;
  const t=obj(tweets[id]);
  const owner=stable(t?.user_id_str), targetId=stable(id,t?.id_str);
  if(!owner||!targetId)return null;
  return {type,target:{id:targetId,owner},actors:arr(agg.fromUsers).map(u=>{const id=stable(u?.user?.id,u?.user?.id_str);const v=id&&Object.hasOwn(users,id)?users[id]:null;return {id,user:stable(id,v?.id_str)===id?ref(id,v):null};})};
}
export function parseNotificationPayload(payload,{ownerUserId,observedAt=Date.now()}={}){
  if(!validId(ownerUserId)||!Number.isSafeInteger(observedAt)||observedAt<=0||!obj(payload))throw Error('invalid_notification_context');
  const records=new Map(), people=new Map(), stats={rows:0,unsupported:0,outOfScope:0,unresolvedActors:0,foreignTargets:0,truncated:false};
  function add(item){
    stats.rows++;
    if(!item){stats.unsupported++;return;}
    if(item.outOfScope){stats.outOfScope++;return;}
    if(item.target.owner!==ownerUserId){stats.foreignTargets++;return;}
    if(!item.actors.length){stats.unresolvedActors++;return;}
    if(item.actors.length>1000){stats.truncated=true;return;}
    for(const {id:actor,user} of item.actors){
      // Notification timestamps may refer to the aggregate update, not the action.
      const e=normalizeEvent({ownerUserId,actorUserId:actor,targetUserId:ownerUserId,type:item.type,targetPostId:item.target.id,observedAt,occurredAt:null,source:'notification',evidenceQuality:'confirmed'},ownerUserId);
      if(!e){stats.unresolvedActors++;continue;}
      if(records.size>=20000&&!records.has(e.eventId)){stats.truncated=true;return;}
      records.set(e.eventId,mergeEvent(records.get(e.eventId),e));
      if(user)people.set(user.userId,{...user,observedAt});
    }
  }
  const old=obj(payload.globalObjects);
  if(old){
    const notifications=obj(old.notifications)??{},tweets=obj(old.tweets)??{},users=obj(old.users)??{};
    for(const row of Object.values(notifications)){if(stats.rows>=20000){stats.truncated=true;break;}add(legacy(row,tweets,users));}
  }
  // Prefer a validated owner-bound timeline when a raw GraphQL viewer envelope
  // is supplied. Existing projected arrays and legacy REST payloads remain supported.
  const envelope=inspectNotificationTimelineEnvelope(payload,{ownerUserId});
  const stack=envelope?envelope.notifications:[payload.data??payload], seen=new WeakSet();let visited=0;
  while(stack.length){
    const node=stack.pop();if(!node||typeof node!=='object'||seen.has(node))continue;
    seen.add(node);if(++visited>100000||stats.rows>=20000){stats.truncated=true;break;}
    if(node.__typename==='TimelineNotification'){add(modern(node));continue;}
    for(const [key,v] of Object.entries(node)){
      if(key==='globalObjects'||key==='__proto__'||!v||typeof v!=='object')continue;
      if(stack.length>=100000){stats.truncated=true;break;}
      stack.push(v);
    }
  }
  return {events:[...records.values()],users:[...people.values()],stats,historyComplete:false};
}
