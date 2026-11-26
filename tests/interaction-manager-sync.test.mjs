import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePage} from '../interaction-manager/sync/engine.js';
const ctx={ownerUserId:'111',source:'post',cursor:null,observedAt:1800000000000};
const page={status:200,ownerUserId:'111',source:'post',requestCursor:null,done:true,nextCursor:null,terminalEvidence:'explicit',structureVerified:true,posts:[{postId:'123',authorUserId:'222',replyToUserId:'111',replyToPostId:'456',createdAt:1799999999999}]};
test('explicit end and stable owner are mandatory',()=>{
 assert.equal(normalizePage(page,ctx).events.length,1);
 for(const [change,error] of [[{ownerUserId:'333'},'response_mismatch'],[{done:false},'invalid_pagination'],[{terminalEvidence:null},'schema_changed'],[{structureVerified:false},'schema_changed'],[{requestCursor:'other'},'response_mismatch'],[{status:429},'rate_limited'],[{status:401},'unauthenticated'],[{status:403},'forbidden']])assert.throws(()=>normalizePage({...page,...change},ctx),new RegExp(error));
});
test('notification schema changes cannot become a successful empty history',()=>{
 const context={...ctx,source:'notification'};
 assert.throws(()=>normalizePage({...page,source:'notification',payload:{data:[{__typename:'TimelineNotification',notification_icon:'unknown'}]}},context),/schema_changed/);
});

const follow={__typename:'TimelineNotification',notification_icon:'person_icon',template:{from_users:[{user_results:{result:{rest_id:'222'}}}],target_objects:[]}};
const notificationPage=payload=>({...page,source:'notification',posts:[],payload});
test('well-formed out-of-scope follow rows do not produce interactions or schema failures',()=>{
 const context={...ctx,source:'notification'};
 const legacy={globalObjects:{notifications:{a:{icon:{id:'person_icon'},template:{aggregateUserActionsV1:{fromUsers:[{user:{id:'222'}}],targetObjects:[]}}}}}};
 for(const payload of [{data:[follow]},legacy]){const result=normalizePage(notificationPage(payload),context);assert.equal(result.events.length,0);assert.equal(result.stats.outOfScope,1);assert.equal(result.quality.ignored,1);assert.equal(result.stats.unsupported,0);}
});
test('known out-of-scope notices do not mask an otherwise unsupported page',()=>{
 const context={...ctx,source:'notification'};
 for(const data of [[follow,{__typename:'TimelineNotification',notification_icon:'unknown'}],[{...follow,template:{from_users:[{user_results:{result:{rest_id:'not-an-id'}}}]}}],[{...follow,template:{...follow.template,target_objects:[{}]}}]])assert.throws(()=>normalizePage(notificationPage({data}),context),/schema_changed/);
});
