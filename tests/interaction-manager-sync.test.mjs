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
