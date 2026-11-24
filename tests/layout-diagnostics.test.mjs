import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sanitizeLayout,sanitizeRender,sanitizeReproduction,classifyFailure,environment} from '../sidepanel/layout-report.js';
test('V2 structure diagnostics never exports unknown DOM attribute values or raw page identifiers',()=>{
 const secret='private@example.test/status/938475938475',raw={tag:secret,role:secret,testId:secret,ariaLabelPresent:true,editable:false,href:secret};
 const layout=sanitizeLayout({pageType:secret,language:secret,viewportWidth:1234,focusedEditor:raw,candidates:Array.from({length:20},()=>({node:raw,focused:true})),url:secret});
 const render=sanitizeRender({source:secret,connected:true,occlusion:secret,html:secret});
 const reproduction=sanitizeReproduction({state:'complete',gesture:{target:raw,ancestors:Array(20).fill(raw),rule:secret,post:{article:true,identityVerified:true,sourceText:secret}},marks:[{stage:secret,reason:secret,atMs:3,extra:secret}],facts:[{atMs:0,value:{editors:[{contextStatusId:secret,contextMatches:secret}]}}]},['capture'],['known']);
 assert.equal(layout.candidates.length,5);assert.equal(reproduction.gesture.ancestors.length,8);assert.equal(reproduction.marks[0].reason,'unknown');
 assert.doesNotMatch(JSON.stringify({layout,render,reproduction}),/private@example|938475938475/);
});
test('V2 separates uncovered host, unrecognized click, missing post identity, and inline editor',()=>{
 const base={page:'x',contentScript:'running',floatingEnabled:true,environment:{manifestHostMatch:true}};
 const rep={state:'complete',gesture:{rule:'testid',post:{article:true,identityVerified:true,mainTextPresent:true}},marks:[{stage:'activated',reason:'trusted_reply_click'}],samples:[{layout:{inlineCandidates:0,dialogStandardEditors:0,nonstandardCandidates:0}},{layout:{inlineCandidates:1,dialogStandardEditors:0,nonstandardCandidates:1}}]};
 assert.equal(classifyFailure({...base,environment:{manifestHostMatch:false}}),'manifest_host_not_matched');
 assert.equal(classifyFailure({...base,reproduction:rep}),'inline_editor_candidate');
 assert.equal(classifyFailure({...base,reproduction:{...rep,gesture:{...rep.gesture,rule:'unrecognized'}}}),'reply_control_unrecognized');
 assert.equal(classifyFailure({...base,reproduction:{...rep,gesture:{...rep.gesture,post:{...rep.gesture.post,identityVerified:false}}}}),'post_identity_unverified');
 assert.equal(classifyFailure({...base,contentScript:'no_response'}),'content_script_unreachable');
 assert.equal(environment('Mozilla Chrome/145.0.0.0 Edg/145.0.0.0',{url:'https://www.x.com/a/status/123',incognito:true},{content_scripts:[{matches:['https://x.com/*']}]}).manifestHostMatch,false);
});
test('real Chrome records unrecognized nested controls, new editor layout and sanitized render states',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'xrh-layout-diagnostics-'));
 try{
 const code=['post-extractor','reply-detector','layout-diagnostics'].map(n=>readFileSync(new URL('../content/'+n+'.js',import.meta.url),'utf8')).join('\n');
 const fixture=()=>{
 const api=ZaneReplyCopilotContent, d=api.layoutDiagnostics, out=[];
 const target=document.querySelector('#reply span'),g=d.gestureShape(target);
 out.push(g.rule==='unrecognized'&&g.replyTestIdAncestor&&g.outerRecognized&&g.post.article&&g.post.identityVerified&&g.post.mainTextPresent);
 out.push(g.target.testId==='other'&&g.target.ariaLabelPresent&&!JSON.stringify(g).includes('private'));
 let time=0,next=0,timers=new Map();
 const recorder=d.createRecorder(()=>({layout:d.layout(),render:d.render(null,'none')}),{now:()=>time,later:(fn,ms)=>{timers.set(++next,{fn,at:time+ms});return next},clear:id=>timers.delete(id)});
 recorder.gesture({isTrusted:true,target,type:'pointerdown'},'activation');
 out.push(recorder.finish('test').state==='lost');
 recorder.start('test');
 recorder.gesture({isTrusted:false,target,type:'pointerdown'},'activation');
 out.push(recorder.finish('test').state==='no_click');
 recorder.start('test');
 recorder.gesture({isTrusted:true,target,type:'pointerdown'},'activation');
 recorder.gesture({isTrusted:true,target,type:'click'},'click');
 out.push(recorder.finish('test').state==='recording');
 const editor=document.createElement('div');editor.contentEditable='true';editor.style.minHeight='20px';document.body.append(editor);editor.focus();
 for(const [id,t] of [...timers].sort((a,b)=>a[1].at-b[1].at)){if(t.at>12000)continue;time=t.at;timers.delete(id);t.fn();}
 const report=recorder.finish('test');
 out.push(report.state==='complete'&&report.samples.at(-1).layout.inlineCandidates===1&&report.samples.at(-1).layout.nonstandardCandidates===1&&report.click.rule==='unrecognized');
 out.push(recorder.finish('test').state==='lost'&&!JSON.stringify(report).includes('private'));
 const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;width:80px;height:80px;opacity:0';document.body.append(host);
 out.push(d.render(host,'active').transparent===true);
 document.querySelector('#result').textContent=JSON.stringify(out);
 };
 const html='<!doctype html><html lang="en"><body><article id="post"><a href="https://x.com/private-name/status/987654321">time</a><div data-testid="tweetText">private text</div><button id="reply" data-testid="reply"><span role="button" data-testid="unknown-private-id" aria-label="private@example.test">icon</span></button></article><output id="result"></output><script>'+code+'</script><script>('+fixture.toString()+')()</script></body></html>';
 const file=path.join(dir,'fixture.html');writeFileSync(file,html);
 const browser=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const result=spawnSync(browser,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--user-data-dir='+path.join(dir,'profile'),'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:25000,maxBuffer:2*1024*1024});
 assert.equal(result.status,0,result.stderr);
 const matches=result.stdout.match(/<output id="result">(\[[^\]]+\])<\/output>/);
 assert.ok(matches,result.stdout.slice(-500));const checks=JSON.parse(matches[1]);assert.equal(checks.length,8);assert.ok(checks.every(Boolean),JSON.stringify(checks));
 }finally{rmSync(dir,{recursive:true,force:true})}
});
