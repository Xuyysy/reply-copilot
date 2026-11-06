import test from 'node:test';import assert from 'node:assert/strict';
import {generationFixture} from '../../scripts/lib/generation-performance-fixture.mjs';
import {DEFAULT_MOMENTUM_CONFIG} from '../../domain/creator-momentum.js';
const sourceRoot=new URL('../..',import.meta.url).pathname;
for(const [name,feature]of [['old server',null],['free',{eligible:false,policy:DEFAULT_MOMENTUM_CONFIG}],['paid global OFF',{eligible:true,policy:DEFAULT_MOMENTUM_CONFIG}],['paid global ON',{eligible:true,policy:{...DEFAULT_MOMENTUM_CONFIG,enabled:true}}]])test('actual content/background generation stays fast and records only ACK after '+name,async()=>{
 const r=await generationFixture({sourceRoot,options:{momentumFeature:feature}});assert.deepEqual(r.calls,{generations:1,acks:1,debits:1,insertions:1});
 assert.equal(r.requestPaths.filter(p=>p==='/v1/entitlements').length,1,'reuse initial account preflight only');assert.equal(r.requestPaths.length,5,'3 original account reads + generate + ACK; no feature HTTP');assert.equal(r.momentumOutboxCount,1);assert.ok(r.marks.insert>=r.marks.ack_end);
});
for(const [name,option]of [['ACK failure',{ackLost:true}],['invalid response',{invalidOutput:true}],['upstream offline',{offline:true}]])test('no activity receipt from '+name,async()=>{const r=await generationFixture({sourceRoot,options:{...option,waitForFailure:true}});assert.equal(r.momentumOutboxCount,0);});
