import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveSession,acceptRead,canReadMore,liveRanking} from '../staging/interaction-live-session.js';
const token='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const row=(actor,postId,type='like',i=0)=>({actor,type,postId,row:i});
const batch=(events,owner='me',documentToken=token)=>({ok:true,owner,documentToken,events,scanned:events.length,unresolved:0,missingTargetRows:0});
test('session accumulates only deduplicable visible rows and filters ranking',()=>{
  let s=createLiveSession({tabId:4,now:1000});
  s=acceptRead(s,batch([row('alice','11'),row('bob',null)]),{tabId:4,now:1001});
  s=acceptRead(s,batch([row('alice','11'),row('alice','12','reply'),row('bob',null)]),{tabId:4,now:2000});
  assert.equal(s.accumulated.entries.length,2);
  assert.equal(liveRanking(s)[0].total,2);
  assert.equal(liveRanking(s,{mode:'snapshot'}).length,2);
  assert.equal(liveRanking(s,{type:'reply',query:'@ALI'})[0].total,1);
  assert.equal(liveRanking(s,{query:'bob'}).length,0);
});
test('different account, document, tab and timeout fail closed',()=>{
  const s=acceptRead(createLiveSession({tabId:4,now:1000}),batch([]),{tabId:4,now:1001});
  assert.throws(()=>acceptRead(s,batch([],'other'),{tabId:4,now:2000}),/owner_changed/);
  assert.throws(()=>acceptRead(s,batch([],'me','bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'),{tabId:4,now:2000}),/document_changed/);
  assert.throws(()=>acceptRead(s,batch([]),{tabId:5,now:2000}),/tab_changed/);
  assert.equal(canReadMore(s,91000),false);
  assert.throws(()=>acceptRead(s,batch([]),{tabId:4,now:91001}),/session_limit/);
});
