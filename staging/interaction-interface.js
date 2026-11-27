// Authorized Staging experiment. Same-origin read-only notification/post requests.
// No auth_token extraction, credential export, passive response capture, mutation or retry.
(() => {
 const WEB_BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
 // Read-only SearchTimeline seed/feature data from MIT Xplore 2e1d175.
 // See Xplore-LICENSE.txt. No intercepted response or observed endpoint is needed.
 const SEARCH_PATH='/i/api/graphql/fDwnkykAJtODs46h_XZfVg/SearchTimeline';
 const SEARCH_FEATURES={
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: false,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
 };
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
         if(k==='cursor'||/token|auth|secret|password|cookie|session/i.test(k))continue;
         if(/^(?:include_[a-z0-9_]+|skip_status|send_error_codes|simple_quoted_tweet|count|tweet_mode|cards_platform|ext)$/i.test(k)&&v.length<=2048)params.push([k,k==='count'&&/^\d+$/.test(v)?String(Math.min(Number(v),40)):v]);
       }
       return {kind:'rest',origin,path:u.pathname,params};
     }
   }
   fail('endpoint_not_observed');
 }
 // Metadata only: never intercept response bodies or authentication headers.
 // A route already used by X can replace a stale public seed; no denied request
 // is retried against another route. Metadata remains in this tab's memory.
 function backgroundEndpoints(i){
   const endpoints={
    notification:{kind:'rest',origin:location.origin,path:'/i/api/2/notifications/all.json',params:[['count','40'],['tweet_mode','extended']]},
    post:{kind:'search',origin:location.origin,path:SEARCH_PATH,variables:{rawQuery:'(@'+i.handle+' OR to:'+i.handle+') -from:'+i.handle,count:20,querySource:'typed_query',product:'Latest'},params:[['features',JSON.stringify(SEARCH_FEATURES)]]}
   };
   let entries=[];try{entries=performance.getEntriesByType('resource').slice(-1000);}catch{}
   try{endpoints.notification=endpointFrom(entries,location.origin);}catch{}
   for(let n=entries.length-1;n>=0;n--){
    try{
     const u=new URL(entries[n].name);
     if(u.origin!==location.origin||u.username||u.password||u.hash||!/^\/i\/api\/graphql\/[A-Za-z0-9_-]{8,100}\/SearchTimeline$/.test(u.pathname))continue;
     const params=[];
     for(const key of ['features','fieldToggles']){
      const raw=u.searchParams.get(key);if(raw===null)continue;
      const value=JSON.parse(raw);if(raw.length>16000||!obj(value)||Object.values(value).some(v=>typeof v!=='boolean'))throw Error('schema');
      params.push([key,JSON.stringify(value)]);
     }
     if(!params.some(([k])=>k==='features'))continue;
     endpoints.post={...endpoints.post,path:u.pathname,params};break;
    }catch{}
   }
   return endpoints;
 }
 async function providerId(endpoints){
   const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(endpoints)));
   return 'x-web-'+[...new Uint8Array(hash)].slice(0,16).map(n=>n.toString(16).padStart(2,'0')).join('');
 }
 function pageURL(endpoint,cursor,owner){
   if(cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>2048))fail('invalid_cursor');
   const url=new URL(endpoint.path,endpoint.origin);
   const p=new URLSearchParams(endpoint.params);
   if(endpoint.kind==='graphql'||endpoint.kind==='search'){
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
     if((viewer.rest_id!=null||viewer.legacy?.id_str!=null)&&(!viewerId||viewerId!==owner))fail('owner_mismatch');
     // A local signed-in identity is corroborated by the viewer response when present.
     instructions=viewer.timeline?.instructions??viewer.timeline?.timeline?.instructions??viewer.timeline_v2?.timeline?.instructions;
   }else if(kind==='search'){
     instructions=body.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
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
     const entries=[...arr(ins.entries??ins.addEntries?.entries)];
     if(ins.entry)entries.push(ins.entry);
     if(ins.replaceEntry?.entry)entries.push(ins.replaceEntry.entry);
     if(entries.length>2000)fail('page_limit');
     for(const entry of entries){
       const c=entry?.content;if(!obj(c))continue;
       cursor(c);cursor(c.operation?.cursor);
       const item=c.itemContent??c.item?.content;
       if(kind==='graphql'||kind==='search'){
         if(item?.__typename==='TimelineNotification'){
           const t=item.template;
           if(item.notification_icon==='person_icon'){
             if(!obj(t)||!(t.target_objects===undefined||Array.isArray(t.target_objects)&&t.target_objects.length===0)||!Array.isArray(t.from_users)||t.from_users.length<1||t.from_users.length>1000)fail('schema_changed');
             const actors=t.from_users.map(x=>({user_results:{result:minimalUser(x?.user_results?.result)}}));
             if(actors.some(x=>!x.user_results.result))fail('schema_changed');
             notifications.push({__typename:'TimelineNotification',notification_icon:'person_icon',template:{from_users:actors,target_objects:[]}});
             continue;
           }
           if(!['heart_icon','retweet_icon'].includes(item.notification_icon))fail('schema_changed');
           if(!obj(t)||!Array.isArray(t.from_users)||!Array.isArray(t.target_objects)||t.from_users.length>1000||t.target_objects.length!==1)fail('schema_changed');
           const target=minimalTweet(t.target_objects[0]?.tweet_results?.result);
           const actors=t.from_users.map(x=>({user_results:{result:minimalUser(x?.user_results?.result)}}));
           notifications.push({__typename:'TimelineNotification',notification_icon:item.notification_icon,template:{from_users:actors,target_objects:[{tweet_results:{result:target}}]}});
         }else if(item?.__typename==='TimelineTweet'){addPost(item.tweet_results?.result);}
         else if(Array.isArray(c.items)){
           if(c.items.length>100)fail('page_limit');
           for(const row of c.items){const nested=row?.item?.itemContent;if(nested?.__typename==='TimelineTweet')addPost(nested.tweet_results?.result);else ignored++;}
         }
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
   if(kind==='graphql'||kind==='search')payload={data:notifications};
   else{
     const n=Object.create(null),tweets=Object.create(null),people=Object.create(null);
     for(const [key,row] of Object.entries(global.notifications)){
       const a=row?.template?.aggregateUserActionsV1;
       if(row?.icon?.id==='person_icon'){
         if(!obj(a)||!(a.targetObjects===undefined||Array.isArray(a.targetObjects)&&a.targetObjects.length===0)||!Array.isArray(a.fromUsers)||a.fromUsers.length<1||a.fromUsers.length>1000)fail('schema_changed');
         const fromUsers=a.fromUsers.map(f=>({user:{id:stable(f?.user?.id,f?.user?.id_str)}}));
         if(fromUsers.some(f=>!f.user.id))fail('schema_changed');
         n[key]={icon:{id:'person_icon'},template:{aggregateUserActionsV1:{targetObjects:[],fromUsers}}};
         continue;
       }
       if(!['heart_icon','retweet_icon'].includes(row?.icon?.id))fail('schema_changed');
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
 let active=null,pendingConnection=null,startGeneration=0,lastRequestAt=0,limitedUntil=0;
 function liveIdentity(cacheOnly=false){
   if(!ORIGINS.has(location.origin)||!cacheOnly&&(!/^\/notifications\/?$/.test(location.pathname)||document.visibilityState!=='visible'))fail('open_notifications');
   const handles=[...document.querySelectorAll('a[data-testid="AppTabBar_Profile_Link"][href]')].filter(a=>a.getClientRects().length&&!a.closest('[hidden],[aria-hidden="true"]')).map(a=>{try{const u=new URL(a.href);const m=/^\/([A-Za-z0-9_]{1,15})\/?$/.exec(u.pathname);return u.origin===location.origin?m?.[1]:null;}catch{return null;}}).filter(Boolean);
   return identityFrom(document.cookie,handles);
 }
 function validate(sessionId){
   const i=liveIdentity(active?.background===true);
   if(!active||active.sessionId!==sessionId||active.ownerUserId!==i.ownerUserId||active.handle!==i.handle||active.controller.signal.aborted)fail('identity_changed');
   return i;
 }
 function cancel(){startGeneration++;pendingConnection=null;if(active)active.controller.abort();active=null;}
 async function readPage(m){
   const i=validate(m.sessionId),s=active;
   const source=m.source??'notification';
   const endpoint=s.background?s.endpoints?.[source]:source==='notification'?s.endpoint:null;
   if(!endpoint||m.ownerUserId!==i.ownerUserId||s.blocked||s.busy||s.pages>=30||Date.now()-s.startedAt>=90000)fail('session_limit');
   if(Date.now()<limitedUntil)fail('rate_limited');
   s.busy=true;
   let timedOut=false;
   const c=new AbortController(),abort=()=>c.abort(),timer=setTimeout(()=>{timedOut=true;c.abort();},12000);
   s.controller.signal.addEventListener('abort',abort,{once:true});
   try{
     // CSRF value is used only for its normal same-origin request header; never leaves this tab.
     const raw=/(?:^|;\s*)ct0=([^;]+)/.exec(document.cookie)?.[1];
     if(!raw||raw.length>512)fail('unauthenticated');
     let csrf;try{csrf=decodeURIComponent(raw);}catch{fail('unauthenticated');}
     const url=pageURL(endpoint,m.cursor,i.ownerUserId);
     if(lastRequestAt&&Date.now()-lastRequestAt<1800)await new Promise((resolve,reject)=>{const t=setTimeout(resolve,1800-(Date.now()-lastRequestAt));c.signal.addEventListener('abort',()=>{clearTimeout(t);reject(Error('cancelled'));},{once:true});});
     validate(m.sessionId);if(c.signal.aborted)fail('cancelled');
     lastRequestAt=Date.now();s.pages++;
     const response=await fetch(url,{method:'GET',credentials:'same-origin',headers:{authorization:'Bearer '+WEB_BEARER,'x-csrf-token':csrf,'x-twitter-auth-type':'OAuth2Session','x-twitter-active-user':'yes',accept:'application/json'},cache:'no-store',redirect:'error',signal:c.signal});
     validate(m.sessionId);
     // Explicit platform challenge: stop without reading or forwarding its body.
     if(response.headers.get('cf-mitigated')==='challenge')fail('forbidden');
     const remaining=response.headers.get('x-rate-limit-remaining');
     const reset=Number(response.headers.get('x-rate-limit-reset'))*1000;
     if(response.status===429||remaining==='0'){
       const retry=Number(response.headers.get('retry-after'))*1000;
       limitedUntil=Math.max(limitedUntil,Date.now()+Math.min(86400000,Math.max(60000,Number.isFinite(retry)?retry:0,Number.isFinite(reset)?reset-Date.now():0)));
     }
     if(response.status!==200){s.blocked=true;return {status:response.status};}
     const reader=response.body?.getReader();if(!reader)fail('schema_changed');
     let bytes=0;const chunks=[];
     try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2*1024*1024){await reader.cancel();fail('page_limit');}chunks.push(value);}}finally{reader.releaseLock();}
     const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
     let body;try{body=JSON.parse(new TextDecoder().decode(all));}catch{fail('schema_changed');}
     const projected=project(body,endpoint.kind,i.ownerUserId);validate(m.sessionId);
     if(!projected.done&&projected.nextCursor===m.cursor)fail('invalid_pagination');
     return {status:200,ownerUserId:i.ownerUserId,source,requestCursor:m.cursor,...projected};
   }catch(e){s.blocked=true;if(timedOut&&!s.controller.signal.aborted)throw Error('time_limit');throw e;}
   finally{clearTimeout(timer);s.controller.signal.removeEventListener('abort',abort);s.busy=false;}
 }
 const errors=new Set(['open_notifications','owner_unverified','endpoint_not_observed','identity_changed','owner_mismatch','session_limit','rate_limited','unauthenticated','forbidden','schema_changed','page_limit','invalid_cursor','invalid_pagination','ambiguous_cursor','terminal_unverified','time_limit','cancelled']);
 chrome.runtime.onMessage.addListener((m,sender,respond)=>{
   // Separate read-only local identity probe. Does not start a session or request X.
   if(m?.type==='XRH_STAGING_WORKBENCH_IDENTITY'&&sender.id===chrome.runtime.id&&!sender.tab&&(!sender.url||sender.url===chrome.runtime.getURL('staging/service-worker.js'))){
     try{respond({ok:true,value:liveIdentity(true)});}catch{respond({ok:false,error:'owner_unverified'});}
     return;
   }
   const background=sender.id===chrome.runtime.id&&!sender.tab&&sender.url===chrome.runtime.getURL('staging/service-worker.js');
   if(sender.id!==chrome.runtime.id||(!background&&sender.url!==chrome.runtime.getURL('sidepanel/sidepanel.html'))||m?.type!=='XRH_STAGING_INTERACTION_INTERFACE')return;
   (async()=>{
     if(m.action==='start'){
       const i=liveIdentity(background);if(m.authorized!==true)fail('unauthenticated');
       if(background&&(m.background!==true||typeof m.connectionId!=='string'||!/^[a-f0-9-]{36}$/i.test(m.connectionId)))fail('unauthenticated');
       const endpoint=background||m.readOnly===true?null:endpointFrom(performance.getEntriesByType('resource'),location.origin);
       const endpoints=background?backgroundEndpoints(i):null;
       cancel();const generation=startGeneration;pendingConnection=background?m.connectionId:null;
       const routeId=background?await providerId(endpoints):null;
       if(generation!==startGeneration||background&&pendingConnection!==m.connectionId)fail('cancelled');
       const current=liveIdentity(background);if(current.ownerUserId!==i.ownerUserId||current.handle!==i.handle)fail('identity_changed');
       pendingConnection=null;active={...i,background,connectionId:background?m.connectionId:null,endpoints,endpoint,sessionId:crypto.randomUUID(),controller:new AbortController(),startedAt:Date.now(),pages:0,busy:false,blocked:false,lastRequestAt:0};
       return {ownerUserId:i.ownerUserId,handle:i.handle,sessionId:active.sessionId,kind:endpoint?.kind??null,...(background?{sources:['notification','post'],providerId:routeId}:{})};
     }
     if(m.action==='cancel'){if(background&&pendingConnection!==null&&pendingConnection===m.connectionId||active&&(active.connectionId?active.connectionId===m.connectionId:active.sessionId===m.sessionId))cancel();return {};}
     const i=validate(m.sessionId);
     if(m.action==='identity')return {...i,sessionId:active.sessionId};
     if(m.action==='page')return readPage(m);
     fail('schema_changed');
   })().then(value=>respond({ok:true,value}),e=>respond({ok:false,error:errors.has(e?.message)?e.message:e?.name==='AbortError'?'cancelled':'source_error'}));
   return true;
 });
 addEventListener('pagehide',cancel,{once:true});
})();