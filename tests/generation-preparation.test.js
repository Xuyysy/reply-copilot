import test from 'node:test';
import assert from 'node:assert/strict';
import {HistoryService} from '../services/history-service.js';
import {ReplyEngine} from '../services/reply-engine.js';
import {validOutput} from './helpers.js';

test('one history snapshot preserves the exact recent selections and full style counts',async()=>{
 let reads=0;const rows=[{reply:'old',style:'natural',events:['selected']},{reply:'automatic',style:'thoughtful',events:['applied']},{reply:'chosen',style:'light_humor',events:['copied']}];
 const history=new HistoryService({get:async()=>{reads++;return {replyHistory:rows};}});
 // Use the actual storage key, independent of UI preferences.
 const {HISTORY_KEY}=await import('../services/storage-service.js');
 history.storage={get:async()=>{reads++;return {[HISTORY_KEY]:rows};}};
 const expected={recentHistory:await history.getRecent(20),styleStats:await history.getStats()};reads=0;
 const actual=await history.getGenerationContext(20);assert.deepEqual(actual,expected);assert.equal(reads,1);
});
test('reply engine uses a single context read without changing prompts or optional injected histories',async()=>{
 let snapshots=0,seen;const context={recentHistory:[{reply:'Chosen example',style:'natural'}],styleStats:{natural:1}};
 const history={getGenerationContext:async()=>{snapshots++;return context;},getRecent:async()=>{throw Error('redundant history');},getStats:async()=>{throw Error('redundant stats');}};
 const engine=new ReplyEngine({historyService:history,aiClient:{generateReplies:async value=>{seen=value;return JSON.stringify(validOutput);}}});
 await engine.generate({sourceText:'Post content'});assert.equal(snapshots,1);assert.deepEqual(seen.recentHistory,context.recentHistory);assert.deepEqual(seen.styleStats,context.styleStats);
});
