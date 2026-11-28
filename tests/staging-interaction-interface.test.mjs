import test from 'node:test';
import assert from 'node:assert/strict';
import '../staging/interaction-interface.js';
import {normalizePage} from '../interaction-manager/sync/engine.js';
const api=globalThis.ReplyCopilotInteractionInterface,origin='https://x.com',owner='111';
test('local owner requires matching visible profile and stable signed-in ID; only observed same-origin notification paths',()=>{
 assert.deepEqual(api.identityFrom('twid=u%3D111',['Me']),{ownerUserId:owner,handle:'me'});
 assert.throws(()=>api.identityFrom('twid=u%3D111',['Me','Other']),/owner_unverified/);
 assert.throws(()=>api.endpointFrom([{name:'https://example.com/i/api/2/notifications/all.json'}],origin),/endpoint_not_observed/);
 const ep=api.endpointFrom([{name:origin+'/i/api/2/notifications/all.json?count=80&cursor=old&token=discard'}],origin);
 assert.equal(api.pageURL(ep,'new',owner),origin+'/i/api/2/notifications/all.json?count=40&cursor=new');
 const gql=api.endpointFrom([{name:origin+'/i/api/graphql/ABCDEFGH/NotificationsTimeline?variables='+encodeURIComponent(JSON.stringify({count:20,cursor:'old',timelineType:'All'}))}],origin);
 assert.equal(JSON.parse(new URL(api.pageURL(gql,'next',owner)).searchParams.get('variables')).cursor,'next');
});
test('modern response requires known timeline and explicit pagination; projects only needed evidence',()=>{
 const user=(id,h)=>({rest_id:id,core:{screen_name:h}});
 const tweet={rest_id:'555',core:{user_results:{result:user(owner,'me')}},legacy:{full_text:'private content'}};
 const notification={__typename:'TimelineNotification',notification_icon:'heart_icon',template:{from_users:[{user_results:{result:user('222','alice')}}],target_objects:[{tweet_results:{result:tweet}}]}};
 const reply={rest_id:'777',core:{user_results:{result:user('222','alice')}},legacy:{in_reply_to_user_id_str:owner,in_reply_to_status_id_str:'555',full_text:'not retained'}};
 const body={data:{viewer_v2:{user_results:{result:{rest_id:owner,timeline:{instructions:[{entries:[{content:{itemContent:notification}},{content:{itemContent:{__typename:'TimelineTweet',tweet_results:{result:reply}}}},{content:{cursorType:'Bottom',value:'next'}}]}]}}}}}};
 const p=api.project(body,'graphql',owner);
 assert.equal(p.nextCursor,'next');assert.equal(p.viewerVerified,true);assert.equal(p.posts.length,1);assert.ok(!JSON.stringify(p).includes('private content'));assert.ok(!JSON.stringify(p).includes('not retained'));
 const parsed=normalizePage({status:200,ownerUserId:owner,source:'notification',requestCursor:null,...p},{ownerUserId:owner,source:'notification',cursor:null});
 assert.equal(parsed.events.length,2);assert.deepEqual(parsed.events.map(e=>e.type).sort(),['like','reply']);
 assert.throws(()=>api.project(body,'graphql','333'),/owner_mismatch/);
 body.data.viewer_v2.user_results.result.timeline.instructions[0].entries.pop();
 assert.throws(()=>api.project(body,'graphql',owner),/terminal_unverified/);
});
test('legacy response explicit bottom termination, known globalObjects and minimal data',()=>{
 const body={globalObjects:{notifications:{one:{icon:{id:'heart_icon'},template:{aggregateUserActionsV1:{targetObjects:[{tweet:{id:'555'}}],fromUsers:[{user:{id:'222'}}]}}}},tweets:{555:{id_str:'555',user_id_str:owner,full_text:'omit'}},users:{222:{id_str:'222',screen_name:'alice'}}},timeline:{instructions:[{terminateTimeline:{direction:'Bottom'}}]}};
 const p=api.project(body,'rest',owner);assert.equal(p.done,true);assert.equal(p.nextCursor,null);assert.ok(!JSON.stringify(p).includes('omit'));assert.equal(p.viewerVerified,false);
 assert.equal(normalizePage({status:200,ownerUserId:owner,source:'notification',requestCursor:null,...p},{ownerUserId:owner,source:'notification',cursor:null}).events.length,1);
});
test('source checkpoint fingerprints do not change when only the other endpoint changes',async()=>{
 const notification={kind:'rest',origin,path:'/fixture-notification',params:[]};
 const post={kind:'search',origin,path:'/fixture-post',params:[]};
 const first=await api.sourceProviderIds({notification,post});
 const second=await api.sourceProviderIds({notification,post:{...post,path:'/fixture-post-v2'}});
 assert.match(first.notification,/^x-web-[a-f0-9]{32}$/);assert.notEqual(first.notification,first.post);assert.equal(first.notification,second.notification);assert.notEqual(first.post,second.post);
});
