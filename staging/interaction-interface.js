// Authorized Staging experiment. Same-origin read-only X notification requests.
// No auth_token extraction, credential export, background polling, mutation or retry.
(() => {
 const WEB_BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
 const ID=/^[1-9]\d{0,19}$/, HANDLE=/^[A-Za-z0-9_]{1,15}$/;
 const ORIGINS=new Set(['https://x.com','https://twitter.com']);
 const fail=code=>{throw Error(code);};
 const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
 const arr=x=>Array.isArray(x)?x:[];
 const stable=(...v)=>{const a=v.filter(x=>x!==null&&x!==undefined);return a.length&&a.every(x=>typeof x==='string'&&ID.test(x))&&new Set(a).size===1?a[0]:null;};
 function identityFrom(cookie,handles){
   const raw=/(?:^|;\s*)twid=([^;]+)/.exec(cookie)?.[1];let decoded;
   try{decoded=decodeURIComponent(raw??'').replace(/^"|"$/g,'');}catch{fail('owner_unverified');}
   const id=/^u=([1-9]\d{0,19})$/.exec(decoded)?.[1];
   const unique=[...new Set(handles.map(h=>h.toLowerCase()))];
   if(!id||unique.length!==1||!HANDLE.test(unique[0]))fail('owner_unverified');
   return {ownerUserId:id,handle:unique[0]};
 }
 function endpointFrom(entries,origin){
   if(!ORIGINS.has(origin))fail('wrong_origin');
   for(let i=entries.length-1;i>=0;i--){
     let u;try{u=new URL(entries[i].name);}catch{continue;}
     if(u.origin!==origin||u.username||u.password||u.hash)continue;
     if(/^\/i\/api\/graphql\/[A-Za-z0-9_-]{8,100}\/NotificationsTimeline$/.test(u.pathname)){
       try{
         const variables=JSON.parse(u.searchParams.get('variables')??'null');
         if(!obj(variables)||JSON.stringify(variables).length>8192)continue;
         if(Object.keys(variables).some(k=>/token|auth|secret|password|cookie|session/i.test(k)))continue;
         if(Object.entries(variables).some(([k,v])=>v!==null&&typeof v!=='boolean'&&!(k==='count'&&Number.isInteger(v)&&v>0)&&!(['cursor','timelineType','timeline_type','userId','user_id','viewerId','viewer_id'].includes(k)&&typeof v==='string'&&v.length<=2048)))continue;
         if(Object.hasOwn(variables,'cursor')&&typeof variables.cursor!=='string'&&variables.cursor!==null)continue;
         const mode=variables.timelineType??variables.timeline_type;
         if(mode!=null&&!/^all$/i.test(String(mode)))continue;
         delete variables.cursor;
         if(typeof variables.count==='number')variables.count=Math.min(variables.count,40);
         const params=new URLSearchParams();
         for(const key of ['features','fieldToggles']){
           const raw=u.searchParams.get(key);if(raw===null)continue;
           const v=JSON.parse(raw);if(!obj(v)||raw.length>16000||Object.values(v).some(x=>typeof x!=='boolean'))throw Error('schema');
           params.set(key,JSON.stringify(v));
         }
         return {kind:'graphql',origin,path:u.pathname,variables,params:[...params]};
       }catch{continue;}
     }
     if(u.pathname==='/i/api/2/notifications/all.json'){
       const params=[];
       for(const [k,v] of u.searchParams){
         if(k==='cursor')continue;
         if(/^(?:include_[a-z0-9_]+|skip_status|send_error_codes|simple_quoted_tweet|count|tweet_mode|cards_platform|ext)$/i.test(k)&&v.length<=2048)params.push([k,k==='count'&&/^\d+$/.test(v)?String(Math.min(Number(v),40)):v]);
       }
       return {kind:'rest',origin,path:u.pathname,params};
     }
   }
   fail('endpoint_not_observed');
 }
 function pageURL(endpoint,cursor,owner){
   if(cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>2048))fail('invalid_cursor');
   const url=new URL(endpoint.path,endpoint.origin);
   const p=new URLSearchParams(endpoint.params);
   if(endpoint.kind==='graphql'){
     const variables={...endpoint.variables};
     for(const k of ['userId','user_id','viewerId','viewer_id'])if(variables[k]!=null&&variables[k]!==owner)fail('owner_mismatch');
     if(cursor!==null)variables.cursor=cursor;
     p.set('variables',JSON.stringify(variables));
   }else if(cursor!==null)p.set('cursor',cursor);
   url.search=p.toString();return url.href;
 }
 const minimalUser=u=>{
   if(!obj(u))return null;
   const rest_id=stable(u.rest_id,u.legacy?.id_str,u.id_str);
   if(!rest_id)return null;
   const h=u.core?.screen_name??u.legacy?.screen_name??u.screen_name;
   return {rest_id,core:typeof h==='string'&&HANDLE.test(h)?{screen_name:h}:{}};
 };
 function unwrap(t){return t?.__typename==='TweetWithVisibilityResults'?t.tweet:t;}
 function minimalTweet(raw){
   const t=unwrap(raw);if(!obj(t))return null;
   const rest_id=stable(t.rest_id,t.legacy?.id_str,t.id_str);
   const user=minimalUser(t.core?.user_results?.result);
   const owner=stable(user?.rest_id,t.legacy?.user_id_str,t.user_id_str);
   return rest_id&&owner?{__typename:'Tweet',rest_id,legacy:{user_id_str:owner},core:{user_results:{result:user??{rest_id:owner}}}}:null;
 }
 function postEvidence(raw,owner,users){
   const t=unwrap(raw),mt=minimalTweet(t);if(!mt)return null;
   const actor=mt.legacy.user_id_str;if(actor===owner)return null;
   const legacy=t.legacy??t;
   const q=minimalTweet(t.quoted_status_result?.result);
   const mentionIds=arr(legacy.entities?.user_mentions).map(m=>stable(m.id_str)).filter(Boolean);
   const replyToUserId=stable(legacy.in_reply_to_user_id_str),replyToPostId=stable(legacy.in_reply_to_status_id_str);
   if(replyToUserId!==owner&&q?.legacy.user_id_str!==owner&&!mentionIds.includes(owner))return null;
   const u=minimalUser(t.core?.user_results?.result);if(u?.core.screen_name)users.push({userId:u.rest_id,handle:u.core.screen_name});
   const ms=Date.parse(legacy.created_at??'');
   return {postId:mt.rest_id,authorUserId:actor,replyToUserId,replyToPostId,quotedUserId:q?.legacy.user_id_str??null,quotedPostId:q?.rest_id??null,mentionedUserIds:mentionIds,createdAt:Number.isFinite(ms)&&ms>0?ms:null};
 }
 function project(body,kind,owner){
   if(!obj(body)||arr(body.errors).length)fail('schema_changed');
   const notifications=[],posts=[],users=[],bottom=new Set();let terminal=false,ignored=0;
   let instructions,viewer=null,global=null;
   if(kind==='graphql'){
     viewer=body.data?.viewer_v2?.user_results?.result??body.data?.viewer?.user_results?.result;
     if(!obj(viewer))fail('schema_changed');
     const viewerId=stable(viewer.rest_id,viewer.legacy?.id_str);
     if(viewerId&&viewerId!==owner)fail('owner_mismatch');
     // A local signed-in identity is corroborated by the viewer response when present.
     instructions=viewer.timeline?.instructions??viewer.timeline?.timeline?.instructions??viewer.timeline_v2?.timeline?.instructions;
   }else{
     global=body.globalObjects;instructions=body.timeline?.instructions;
     if(!obj(global)||!obj(global.notifications)||!obj(global.tweets))fail('schema_changed');
   }
   if(!Array.isArray(instructions)||instructions.length>500)fail('schema_changed');
   function cursor(c){
     if(c?.cursorType!=='Bottom'&&c?.cursor_type!=='Bottom')return;
     if(typeof c.value!=='string'||!c.value||c.value.length>2048)fail('invalid_pagination');
     bottom.add(c.value);
   }
   function addPost(t){const p=postEvidence(t,owner,users);if(p)posts.push(p);}
   for(const ins of instructions){
     if(!obj(ins))fail('schema_changed');
     if(ins.type==='TimelineTerminateTimeline'&&ins.direction==='Bottom'||ins.terminateTimeline?.direction==='Bottom')terminal=true;
     const entries=arr(ins.entries??ins.addEntries?.entries);
     if(ins.entry)entries.push(ins.entry);
     if(ins.replaceEntry?.entry)entries.push(ins.replaceEntry.entry);
     if(entries.length>2000)fail('page_limit');
     for(const entry of entries){
       const c=entry?.content;if(!obj(c))continue;
       cursor(c);cursor(c.operation?.cursor);
       const item=c.itemContent??c.item?.content;
       if(kind==='graphql'){
         if(item?.__typename==='TimelineNotification'){
           if(!['heart_icon','retweet_icon'].includes(item.notification_icon)){ignored++;continue;}
           const t=item.template;
           if(!obj(t)||!Array.isArray(t.from_users)||!Array.isArray(t.target_objects)||t.from_users.length>1000||t.target_objects.length!==1)fail('schema_changed');
           const target=minimalTweet(t.target_objects[0]?.tweet_results?.result);
           const actors=t.from_users.map(x=>({user_results:{result:minimalUser(x?.user_results?.result)}}));
           notifications.push({__typename:'TimelineNotification',notification_icon:item.notification_icon,template:{from_users:actors,target_objects:[{tweet_results:{result:target}}]}});
         }else if(item?.__typename==='TimelineTweet'){addPost(item.tweet_results?.result);}
         else if(item)ignored++;
       }else{
         const tweetId=item?.tweet?.id;
         if(typeof tweetId==='string'&&Object.hasOwn(global.tweets,tweetId)){
           const t=global.tweets[tweetId],u=global.users?.[t?.user_id_str];
           const qid=t?.quoted_status_id_str,q=typeof qid==='string'&&Object.hasOwn(global.tweets,qid)?global.tweets[qid]:null;
           addPost({...t,core:{user_results:{result:u}},quoted_status_result:q?{result:q}:null});
         }
       }
     }
   }
   if(bottom.size>1||terminal&&bottom.size)fail('ambiguous_cursor');
   if(!terminal&&!bottom.size)fail('terminal_unverified');
   let payload;
   if(kind==='graphql')payload={data:notifications};
   else{
     const n=Object.create(null),tweets=Object.create(null),people=Object.create(null);
     for(const [key,row] of Object.entries(global.notifications)){
       if(!['heart_icon','retweet_icon'].includes(row?.icon?.id)){ignored++;continue;}
       const a=row?.template?.aggregateUserActionsV1;
       if(!Array.isArray(a?.targetObjects)||a.targetObjects.length!==1||!Array.isArray(a.fromUsers)||a.fromUsers.length>1000)fail('schema_changed');
       const id=stable(a.targetObjects[0]?.tweet?.id),t=id&&Object.hasOwn(global.tweets,id)?global.tweets[id]:null;
       if(!id||!t)continue;
       tweets[id]={id_str:t.id_str??id,user_id_str:t.user_id_str};
       const fromUsers=a.fromUsers.map(f=>{const aid=stable(f?.user?.id,f?.user?.id_str),u=aid&&Object.hasOwn(global.users??{},aid)?global.users[aid]:null;if(aid&&u)people[aid]={id_str:u.id_str??aid,screen_name:u.screen_name};return {user:{id:aid}};});
       n[key]={icon:{id:row.icon.id},template:{aggregateUserActionsV1:{targetObjects:[{tweet:{id}}],fromUsers}}};
     }
     payload={globalObjects:{notifications:n,tweets,users:people}};
   }
   return {payload,posts,users,nextCursor:terminal?null:[...bottom][0],done:terminal,terminalEvidence:terminal?'explicit':null,structureVerified:true,ignored,viewerVerified:kind==='graphql'&&stable(viewer.rest_id,viewer.legacy?.id_str)===owner};
 }
 globalThis.ReplyCopilotInteractionInterface=Object.freeze({identityFrom,endpointFrom,pageURL,project});
 if(typeof chrome==='undefined'||!chrome.runtime?.onMessage)return;
 let active=null;
 function liveIdentity(cacheOnly=false){
   if(!ORIGINS.has(location.origin)||!cacheOnly&&(!/^\/notifications\/?$/.test(location.pathname)||document.visibilityState!=='visible'))fail('open_notifications');
   const handles=[...document.querySelectorAll('a[data-testid="AppTabBar_Profile_Link"][href]')].filter(a=>a.getClientRects().length&&!a.closest('[hidden],[aria-hidden="true"]')).map(a=>{try{const u=new URL(a.href);const m=/^\/([A-Za-z0-9_]{1,15})\/?$/.exec(u.pathname);return u.origin===location.origin?m?.[1]:null;}catch{return null;}}).filter(Boolean);
   return identityFrom(document.cookie,handles);
 }
 function validate(sessionId){
   const i=liveIdentity();
   if(!active||active.sessionId!==sessionId||active.ownerUserId!==i.ownerUserId||active.handle!==i.handle||active.controller.signal.aborted)fail('identity_changed');
   return i;
 }
 function cancel(){if(active)active.controller.abort();active=null;}
 async function readPage(m){
   const i=validate(m.sessionId),s=active;
   if(!s.endpoint||m.ownerUserId!==i.ownerUserId||s.blocked||s.busy||s.pages>=30||Date.now()-s.startedAt>=90000)fail('session_limit');
   s.busy=true;
   const c=new AbortController(),abort=()=>c.abort(),timer=setTimeout(abort,12000);
   s.controller.signal.addEventListener('abort',abort,{once:true});
   try{
     // CSRF value is used only for its normal same-origin request header; never leaves this tab.
     const raw=/(?:^|;\s*)ct0=([^;]+)/.exec(document.cookie)?.[1];
     if(!raw||raw.length>512)fail('unauthenticated');
     let csrf;try{csrf=decodeURIComponent(raw);}catch{fail('unauthenticated');}
     const url=pageURL(s.endpoint,m.cursor,i.ownerUserId);
     if(s.lastRequestAt&&Date.now()-s.lastRequestAt<1800)await new Promise((resolve,reject)=>{const t=setTimeout(resolve,1800-(Date.now()-s.lastRequestAt));c.signal.addEventListener('abort',()=>{clearTimeout(t);reject(Error('cancelled'));},{once:true});});
     validate(m.sessionId);if(c.signal.aborted)fail('cancelled');
     s.lastRequestAt=Date.now();s.pages++;
     const response=await fetch(url,{method:'GET',credentials:'same-origin',headers:{authorization:'Bearer '+WEB_BEARER,'x-csrf-token':csrf,'x-twitter-auth-type':'OAuth2Session','x-twitter-active-user':'yes',accept:'application/json'},cache:'no-store',redirect:'error',signal:c.signal});
     validate(m.sessionId);
     if(response.status!==200){s.blocked=true;return {status:response.status};}
     const reader=response.body?.getReader();if(!reader)fail('schema_changed');
     let bytes=0;const chunks=[];
     try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2*1024*1024){await reader.cancel();fail('page_limit');}chunks.push(value);}}finally{reader.releaseLock();}
     const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
     let body;try{body=JSON.parse(new TextDecoder().decode(all));}catch{fail('schema_changed');}
     const projected=project(body,s.endpoint.kind,i.ownerUserId);validate(m.sessionId);
     return {status:200,ownerUserId:i.ownerUserId,source:'notification',requestCursor:m.cursor,...projected};
   }finally{clearTimeout(timer);s.controller.signal.removeEventListener('abort',abort);s.busy=false;}
 }
 const errors=new Set(['open_notifications','owner_unverified','endpoint_not_observed','identity_changed','owner_mismatch','session_limit','unauthenticated','schema_changed','page_limit','invalid_cursor','invalid_pagination','ambiguous_cursor','terminal_unverified','cancelled']);
 chrome.runtime.onMessage.addListener((m,sender,respond)=>{
   // Separate read-only local identity probe. Does not start a session or request X.
   if(m?.type==='XRH_STAGING_WORKBENCH_IDENTITY'&&sender.id===chrome.runtime.id&&!sender.tab&&(!sender.url||sender.url===chrome.runtime.getURL('staging/service-worker.js'))){
     try{respond({ok:true,value:liveIdentity(true)});}catch{respond({ok:false,error:'owner_unverified'});}
     return;
   }
   if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('sidepanel/sidepanel.html')||m?.type!=='XRH_STAGING_INTERACTION_INTERFACE')return;
   (async()=>{
     if(m.action==='start'){
       const i=liveIdentity();if(m.authorized!==true)fail('unauthenticated');
       const endpoint=m.readOnly===true?null:endpointFrom(performance.getEntriesByType('resource'),location.origin);
       cancel();active={...i,endpoint,sessionId:crypto.randomUUID(),controller:new AbortController(),startedAt:Date.now(),pages:0,busy:false,blocked:false,lastRequestAt:0};
       return {ownerUserId:i.ownerUserId,handle:i.handle,sessionId:active.sessionId,kind:endpoint?.kind??null};
     }
     if(m.action==='cancel'){if(active?.sessionId===m.sessionId)cancel();return {};}
     const i=validate(m.sessionId);
     if(m.action==='identity')return {...i,sessionId:active.sessionId};
     if(m.action==='page')return readPage(m);
     fail('schema_changed');
   })().then(value=>respond({ok:true,value}),e=>respond({ok:false,error:errors.has(e?.message)?e.message:e?.name==='AbortError'?'cancelled':'source_error'}));
   return true;
 });
 addEventListener('pagehide',cancel,{once:true});
})();