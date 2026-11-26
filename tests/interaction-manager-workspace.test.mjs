import test from 'node:test';
import assert from 'node:assert/strict';
import {parseImport} from '../interaction-manager/ui/import.js';
const now=1800000000000,ownerUserId='111';
const fixture={format:'xrh-interaction-evidence-v1',ownerUserId,kind:'post',observedAt:now,posts:[{postId:'123',authorUserId:'222',replyToUserId:'111',replyToPostId:'456',createdAt:now-1000}]};
test('offline import normalizes evidence, excludes unrelated content',()=>{
 const r=parseImport(JSON.stringify({...fixture,privateText:'never persist'}),now);
 assert.equal(r.events.length,1);assert.equal(r.events[0].actorUserId,'222');assert.equal(r.events[0].direction,'inbound');assert.equal(Object.hasOwn(r,'privateText'),false);
});
test('offline import rejects arbitrary format, numeric ID and future observation',()=>{
 for(const x of [{...fixture,format:'other'},{...fixture,ownerUserId:111},{...fixture,observedAt:now+1}])assert.throws(()=>parseImport(JSON.stringify(x),now));
});
