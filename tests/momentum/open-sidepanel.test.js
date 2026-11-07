import test from 'node:test';
import assert from 'node:assert/strict';
import {openReplySidePanel} from '../../services/open-sidepanel.js';

test('side panel consumes click activation synchronously and only publishes context after open', async()=>{
 const calls=[];
 let release;
 const opened=new Promise(resolve=>{release=resolve;});
 const result=openReplySidePanel(()=>{calls.push('open');return opened;},()=>calls.push('context'));
 assert.deepEqual(calls,['open']);
 release();
 assert.deepEqual(await result,{ok:true});
 assert.deepEqual(calls,['open','context']);
 const failure=await openReplySidePanel(()=>Promise.reject(Error('gesture lost')),()=>assert.fail('must not queue context'));
 assert.equal(failure.ok,false);
 assert.match(failure.error,/无法打开/);
});
