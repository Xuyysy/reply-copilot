import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const {buildSync}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const folder=mkdtempSync(path.join(tmpdir(),'xrh-cost-ui-'));
const outfile=path.join(folder,'render.cjs');
buildSync({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Panel from './src/components/admin/AiCostBreakdown';export const render=(props)=>renderToStaticMarkup(React.createElement(Panel,props));`,resolveDir:new URL('..',import.meta.url).pathname,loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',define:{'import.meta.env':'{}'},outfile});
const {render}=createRequire(import.meta.url)(outfile);
rmSync(folder,{recursive:true,force:true});
const today={requests:2,inputTokens:123,outputTokens:456,costMicroUsd:789};
const month={requests:5,inputTokens:1000,outputTokens:2000,costMicroUsd:12345};
const rows=[{provider:'Qwen',model:'qwen3.7-flash',configurationSource:'managed',today,month},{provider:'DeepSeek',model:'deepseek-flash',configurationSource:'legacy',today,month}];

test('cost breakdown renders both UTC periods with pinned provider labels, tokens and micro-USD amounts in both languages',()=>{
 for(const language of ['zh','en']){
  const html=render({rows,language});
  assert.equal((html.match(/<table/g)||[]).length,2);
  for(const value of ['Qwen','qwen3.7-flash','Legacy DeepSeek','deepseek-flash','123','456','$0.000789','$0.012345'])assert.ok(html.includes(value),value);
  assert.ok(html.includes(language==='zh'?'生成请求数':'Generation requests'));
  assert.ok(html.includes(language==='zh'?'今日（UTC）':'Today (UTC)'));
  assert.ok(html.includes(language==='zh'?'本月（UTC）':'This month (UTC)'));
 }
});

test('empty cost history and unresolved provider have clear localized states and model names are escaped',()=>{
 assert.ok(render({rows:[],language:'zh'}).includes('暂无模型成本记录'));
 assert.ok(render({rows:[],language:'en'}).includes('No model cost records yet'));
 const html=render({rows:[{...rows[0],configurationSource:'unresolved',model:'<script>alert(1)</script>'}],language:'en'});
 assert.ok(html.includes('Unresolved provider'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
});
