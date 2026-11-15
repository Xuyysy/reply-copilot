import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPrompts} from '../prompts/prompt-builder.js';
import {buildLiveProductionV3Prompts} from '../prompts/prompt-v3-live-parity.js';

const args={postContext:{text:'New AI tools keep shipping updates every week. Do you use them?',url:'https://x.com/example/status/123'},replyStyle:'natural-friendly',outputSchemaVersion:2};

test('Production live V3 parity changes only V2 system style rules, preserves schema and user',()=>{
 const base=buildPrompts(args),actual=buildLiveProductionV3Prompts(args);
 assert.notEqual(actual.system,base.system);
 assert.equal(actual.user,base.user);
 assert.match(actual.system,/OFFHAND HUMAN REPLY RULES\n- Write an X comment, not a response essay/);
 assert.match(actual.system,/Required JSON shape/);
 assert.equal(actual.system.slice(0,actual.system.indexOf('\nOFFHAND HUMAN REPLY RULES')),base.system.slice(0,base.system.indexOf('\nOFFHAND HUMAN REPLY RULES')));
 assert.equal(actual.system.slice(actual.system.indexOf('\nRequired JSON shape')),base.system.slice(base.system.indexOf('\nRequired JSON shape')));
});

test('Production parity helper cannot change V1 prompt hash or behavior',()=>{
 const first={...args,outputSchemaVersion:1};
 assert.deepEqual(buildLiveProductionV3Prompts(first),buildPrompts(first));
});

test('Live V3 only activates for Production outputSchemaVersion V2 in API source',()=>{
 const ai=readFileSync(new URL('../api/src/ai.ts',import.meta.url),'utf8');
 assert.match(ai,/env\.ENVIRONMENT===\"production\"&&input\.outputSchemaVersion===2\?buildLiveProductionV3Prompts:buildPrompts/);
});
