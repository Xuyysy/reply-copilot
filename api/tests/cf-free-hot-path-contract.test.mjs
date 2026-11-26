import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDeepSeekResult} from '../src/deepseek-client.js';
import {serializeModelOutput,validateParsedModelOutput,serializeValidatedModelOutput,validateModelOutput} from '../src/ai-model-provider.js';
import {parseAIOutput} from '../../utils/output-parser.js';
import {rerankV5DefaultStyle} from '../../prompts/reply-v5-quality.js';
const basic={recommendation:'reply',defaultStyle:'natural',language:'zh',reason:' context ',replies:{natural:'确实如此',light_humor:' 好玩 ',thoughtful:' 这件事的背景很重要 '},quoteCandidate:null};
test('legacy combined validation preserves old wire bytes and rejection boundaries',()=>{
 const inputs=[basic,{...basic,score:0},{...basic,score:100},{...basic,score:null},{...basic,defaultStyle:undefined,best_reply_style:'sharp',language:undefined},{...basic,recommendation:'quote',quoteCandidate:' 引用 '},{...basic,score:101},{...basic,defaultStyle:'bad'},{...basic,language:'bad'},{...basic,replies:{natural:'Ａ',light_humor:'a',thoughtful:'c'}},{...basic,replies:{natural:' A ',light_humor:'a',thoughtful:'c'}},{...basic,recommendation:'quote'},{...basic,replies:{...basic.replies,funny:'other',sharp:'other'},defaultStyle:undefined,best_reply_style:'sharp'}];
 for(const value of inputs){
  const raw=JSON.stringify(value);
  const old=()=>{validateDeepSeekResult({raw,finishReason:'stop'});return serializeModelOutput(raw)};
  const next=()=>serializeValidatedModelOutput(validateParsedModelOutput(validateDeepSeekResult({raw,finishReason:'stop'})));
  let previous;try{previous=old()}catch{assert.throws(next);continue;}
  assert.equal(next(),previous);
  assert.deepEqual(parseAIOutput(next()),parseAIOutput(previous));
  assert.equal(rerankV5DefaultStyle(next(),{ENVIRONMENT:'production'},2),rerankV5DefaultStyle(previous,{ENVIRONMENT:'production'},2));
 }
 for(const raw of ['','{}','[]','not json','\`\`\`json\n'+JSON.stringify(basic)+'\n\`\`\`'])assert.throws(()=>validateParsedModelOutput(validateDeepSeekResult({raw,finishReason:'stop'})));
});
test('managed wire normalization is idempotent, including optional score and legacy aliases',()=>{
 for(const value of [basic,{...basic,score:null},{...basic,score:0},{...basic,score:100},{...basic,defaultStyle:undefined,best_reply_style:'sharp',language:undefined},{...basic,recommendation:'quote',quote_candidate:' 引用 ',quoteCandidate:undefined}]){
  const raw=JSON.stringify(value),wire=serializeValidatedModelOutput(validateModelOutput(raw));
  assert.equal(serializeModelOutput(wire),wire);
 }
});
