import test from 'node:test';import assert from 'node:assert/strict';
import {momentumReceiptPatch,MOMENTUM_OUTBOX_PREFIX} from '../../services/creator-momentum.js';
import {DEFAULT_MOMENTUM_CONFIG} from '../../domain/creator-momentum.js';
test('receipt outbox has only account/request/time/bounded policy, never post, reply or token',()=>{
 const p=momentumReceiptPatch({ownerId:'account-a',input:{requestId:'request-a',sourceText:'private-post'},raw:'private-reply',completedAt:Date.now()},DEFAULT_MOMENTUM_CONFIG);
 assert.equal(Object.keys(p).length,1);assert.ok(Object.keys(p)[0].startsWith(MOMENTUM_OUTBOX_PREFIX));assert.equal(JSON.stringify(p).includes('private'),false);assert.equal(momentumReceiptPatch(null).constructor,Object);
});
test('invalid or not yet confirmed receipt cannot create an outbox entry or throw',()=>{for(const r of [{},null,{ownerId:'a',input:{requestId:'b'}},{ownerId:'a',input:{requestId:'b'},raw:'result'}])assert.deepEqual(momentumReceiptPatch(r),{});});
test('ACK replay before outbox drain preserves first confirmation day and policy, even across midnight',()=>{
 const at=new Date(2026,10,6,23,59).getTime();const first=Object.values(momentumReceiptPatch({ownerId:'A',input:{requestId:'same'},raw:'ack',completedAt:at}))[0];
 const replay=Object.values(momentumReceiptPatch({ownerId:'A',input:{requestId:'same'},raw:'ack',completedAt:at+5*60000},{...DEFAULT_MOMENTUM_CONFIG,version:'next-day'},first))[0];assert.equal(replay.at,at);assert.equal(replay.day,'2026-11-06');assert.equal(replay.policy.version,'default-v1');
});
