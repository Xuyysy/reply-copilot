import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiInput } from '../src/ai-input.js';
const input={requestId:'12345678-1234-4234-8234-123456789012',post:{text:'Test post',url:'https://x.com/test/status/123'},replyStyle:'bold'};
test('hosted AI preserves the bold style offered by extension settings',()=>{assert.equal(normalizeAiInput(input).replyStyle,'bold');});
test('AI accepts only actual X post URLs, not suffix hosts or trailing paths',()=>{
 for(const url of ['https://x.com.evil.test/test/status/123','https://x.com/test/status/123/evil','https://user:pass@x.com/test/status/123'])assert.throws(()=>normalizeAiInput({...input,post:{...input.post,url}}));
 assert.equal(normalizeAiInput({...input,post:{...input.post,url:''}}).post.url,'');
 assert.equal(normalizeAiInput({...input,post:{...input.post,url:input.post.url+'?token=private#tracking'}}).post.url,input.post.url);
});
test('AI input size and request ID are validated; histories remain bounded',()=>{
 assert.throws(()=>normalizeAiInput({...input,requestId:'bad'}));
 assert.throws(()=>normalizeAiInput({...input,post:{text:'a'.repeat(12001)}}));
 assert.equal(normalizeAiInput({...input,recentHistory:Array(30).fill({reply:'hi'})}).history.length,20);
 assert.equal(normalizeAiInput({...input,replyStyle:'unknown'}).replyStyle,'natural-friendly');
});
