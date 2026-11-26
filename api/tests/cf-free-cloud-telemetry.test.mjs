import test from 'node:test';
import assert from 'node:assert/strict';
import {correlateInvocationLogs as join} from '../scripts/cf-free-business-cloud/telemetry.mjs';
const script='synthetic',version='11111111-1111-1111-1111-111111111111',cases=[{id:'case-1'},{id:'case-2'}],opts={script,version,cases};
function event(id,extra,worker={}){return {$metadata:{service:script,requestId:id},$workers:{scriptName:script,scriptVersion:{id:version},requestId:id,eventType:'fetch',...worker},...extra};}
test('joins exact version and invocation identity, preserves actual CPU and drops raw contents',()=>{
 const input=[event('secret-id',{xrhAcceptanceCase:'case-1',secret:'ignored'}),event('secret-id',{}, {cpuTimeMs:12.4,outcome:'ok'}),event('cron',{xrhAcceptanceCron:123},{eventType:'scheduled'}),event('cron',{}, {eventType:'cron',cpuTimeMs:8.1,outcome:'ok'}),event('other',{xrhAcceptanceCase:'case-2'}),event('other',{}, {scriptVersion:{id:'wrong'},cpuTimeMs:2,outcome:'ok'})];
 assert.deepEqual(join(input,opts),{samples:[{id:'case-1',cpuMs:12.4,outcome:'ok'}],cron:[{scheduledTime:123,cpuMs:8.1,outcome:'ok'}],warnings:[]});
});
test('duplicate case association, duplicate invocation and wrong event type cannot produce evidence',()=>{
 const input=[event('a',{xrhAcceptanceCase:'case-1'}),event('a',{}, {cpuTimeMs:1,outcome:'ok'}),event('b',{xrhAcceptanceCase:'case-1'}),event('b',{}, {cpuTimeMs:10,outcome:'ok'}),event('c',{xrhAcceptanceCase:'case-2'}),event('c',{}, {cpuTimeMs:2,outcome:'ok'}),event('c',{}, {cpuTimeMs:3,outcome:'ok'})];
 assert.deepEqual(join(input,opts),{samples:[],cron:[],warnings:['AMBIGUOUS_INVOCATION_ASSOCIATIONS']});
});
