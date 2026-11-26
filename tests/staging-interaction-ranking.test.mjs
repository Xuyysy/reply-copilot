import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSnapshot,ranking,mergeConfirmed} from '../staging/interaction-ranking.js';
import '../staging/interaction-capture.js';
const {profile,status,action}=globalThis.ReplyCopilotInteractionCapture;
const snapshot=(events,owner='me')=>normalizeSnapshot({ok:true,owner,events});
const e=(actor,type,row,postId=null)=>({actor,type,row,postId});
test('strict profile/status origins and exact notification phrases',()=>{
  assert.equal(profile('/Alice'),'alice');
  assert.equal(profile('https://evil.example/Alice'),null);
  assert.equal(profile('/notifications'),null);
  assert.deepEqual(status('/Me/status/123'),{handle:'me',id:'123'});
  assert.equal(status('/Me/status/123/photo/1'),null);
  assert.equal(action('liked your post'),'like');
  assert.equal(action('赞了你的帖子'),'like');
  assert.equal(action('reposted your post'),'repost');
  assert.equal(action('I liked your post as a joke'),null);
});
test('count distinct replies, dedupe stable events, separate unknown rows',()=>{
  const s=snapshot([e('alice','reply',0,'11'),e('alice','reply',1,'11'),e('alice','reply',2,'12'),e('alice','like',3),e('alice','like',3),e('bob','like',4),e('me','reply',5,'13')]);
  assert.deepEqual(ranking(s.events),[{actor:'alice',like:1,reply:2,repost:0,total:3},{actor:'bob',like:1,reply:0,repost:0,total:1}]);
  const first=mergeConfirmed(null,s,7);
  assert.equal(first.entries.length,2);
  assert.equal(mergeConfirmed(first,s,7).entries.length,2);
  assert.equal(mergeConfirmed(first,snapshot([e('bob','like',0,'99')],'other'),7).entries.length,1);
  assert.equal(mergeConfirmed(first,snapshot([]),8).entries.length,0);
});
test('reject malformed snapshot and exclude invalid records',()=>{
  assert.throws(()=>normalizeSnapshot({ok:true,owner:'@me',events:[]}));
  assert.equal(snapshot([e('https://bad','like',0),e('a','follow',0),e('a','like',200),e('a','like',0,'not-id')]).events.length,0);
});
