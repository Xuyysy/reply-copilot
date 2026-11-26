// Offline parser for already authorized, locally provided payloads only.
// No network, cookies, endpoint discovery or capture hooks.
// Shapes are based on public X-Insights fixtures; live X compatibility is not yet validated.
import {validId,normalizeEvent,mergeEvent} from '../core/events.js';
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:null;
const arr=v=>Array.isArray(v)?v:[];
const stable=(...ids)=>{const known=ids.filter(x=>x!==undefined&&x!==null);return known.length&&known.every(validId)&&new Set(known).size===1?known[0]:null;};
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
function modern(row){
  const type=typeOf(row.notification_icon), template=obj(row.template);
  if(!type||!template||arr(template.target_objects).length!==1)return null;
  const target=modernTweet(template.target_objects[0]?.tweet_results?.result);
  if(!target)return null;
  const actors=arr(template.from_users).map(u=>{const v=u?.user_results?.result;return stable(v?.rest_id,v?.legacy?.id_str);});
  return {type,target,actors};
}
function legacy(row,tweets){
  const type=typeOf(row?.icon?.id), agg=obj(row?.template?.aggregateUserActionsV1);
  if(!type||!agg||arr(agg.targetObjects).length!==1)return null;
  const id=agg.targetObjects[0]?.tweet?.id;
  if(!validId(id)||!Object.hasOwn(tweets,id))return null;
  const t=obj(tweets[id]);
  const owner=stable(t?.user_id_str), targetId=stable(id,t?.id_str);
  if(!owner||!targetId)return null;
  return {type,target:{id:targetId,owner},actors:arr(agg.fromUsers).map(u=>stable(u?.user?.id,u?.user?.id_str))};
}
export function parseNotificationPayload(payload,{ownerUserId,observedAt=Date.now()}={}){
  if(!validId(ownerUserId)||!Number.isSafeInteger(observedAt)||observedAt<=0||!obj(payload))throw Error('invalid_notification_context');
  const records=new Map(), stats={rows:0,unsupported:0,unresolvedActors:0,foreignTargets:0,truncated:false};
  function add(item){
    stats.rows++;
    if(!item){stats.unsupported++;return;}
    if(item.target.owner!==ownerUserId){stats.foreignTargets++;return;}
    if(!item.actors.length){stats.unresolvedActors++;return;}
    if(item.actors.length>1000){stats.truncated=true;return;}
    for(const actor of item.actors){
      // Notification timestamps may refer to the aggregate update, not the action.
      const e=normalizeEvent({ownerUserId,actorUserId:actor,targetUserId:ownerUserId,type:item.type,targetPostId:item.target.id,observedAt,occurredAt:null,source:'notification',evidenceQuality:'confirmed'},ownerUserId);
      if(!e){stats.unresolvedActors++;continue;}
      if(records.size>=20000&&!records.has(e.eventId)){stats.truncated=true;return;}
      records.set(e.eventId,mergeEvent(records.get(e.eventId),e));
    }
  }
  const old=obj(payload.globalObjects);
  if(old){
    const notifications=obj(old.notifications)??{},tweets=obj(old.tweets)??{};
    for(const row of Object.values(notifications)){if(stats.rows>=20000){stats.truncated=true;break;}add(legacy(row,tweets));}
  }
  // Only known TimelineNotification objects; never infer a notification from tweet text.
  const stack=[payload.data??payload], seen=new WeakSet();let visited=0;
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
  return {events:[...records.values()],stats,historyComplete:false};
}
