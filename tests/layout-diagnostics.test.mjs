import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sanitizeLayout,sanitizeRender,sanitizeReproduction,classifyFailure,environment,classifyLayout} from '../sidepanel/layout-report.js';
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
 document.documentElement.setAttribute('data-app-version','private-build-marker');
 const modern=document.createElement('div');modern.setAttribute('role','link');modern.setAttribute('data-href','https://x.com/private-new/status/987654321');
 modern.innerHTML='<article><div dir="auto" class="whitespace-pre-wrap">private modern text</div><button data-engagement-action="reply">Reply</button></article>';
 document.body.append(modern);
 const modal=document.createElement('div');modal.setAttribute('role','dialog');modal.setAttribute('data-base-ui-portal','private-portal');
 modal.innerHTML='<article><a aria-hidden="true" href="https://x.com/private-new/status/987654321"></a><div dir="auto" class="whitespace-pre-wrap">private modern text</div></article><textarea aria-label="private label">private draft</textarea>';
 document.body.append(modal);modal.querySelector('textarea').focus();
 const ml=d.layout(),mg=d.gestureShape(modern.querySelector('button'));
 out.push(ml.modernAppMarker&&ml.modernReplyControls===1&&ml.modernPostWrappers===1&&ml.dialogTextareaCandidates===1&&ml.dialogs[0].modernCanonicalLinks===1&&ml.dialogs[0].textareaEditors===1&&mg.rule==='engagement'&&mg.post.modernAdapter&&mg.post.identityVerified);
 out.push(!JSON.stringify({ml,mg}).includes('private')&&!JSON.stringify({ml,mg}).includes('987654321'));
 out.push(mg.postTree.nodes.some(x=>x.dataHrefKind==='status')&&mg.postTree.nodes.some(x=>x.engagementAction==='reply')&&mg.controlPath.length>0);
 recorder.start('detailed');
 const button=modern.querySelector('button');
 recorder.gesture({isTrusted:true,target:button,type:'pointerdown'},'activation');
 recorder.gesture({isTrusted:true,target:button,type:'click'},'click');
 const started=time;
 for(const [id,t] of [...timers].sort((a,b)=>a[1].at-b[1].at)){if(t.at>started+20000)continue;time=t.at;timers.delete(id);t.fn();}
 recorder.mark('fill','verified');
 const detailed=recorder.finish('detailed');
 out.push(detailed.state==='complete'&&detailed.recordedMs>=20000&&detailed.clickRelation.sameControl&&detailed.details.length===3&&detailed.details[2].focusPath[0].tag==='textarea'&&detailed.marks.some(m=>m.reason==='verified'));
 out.push(!JSON.stringify(detailed).includes('private')&&!JSON.stringify(detailed).includes('987654321'));
 document.querySelector('#result').textContent=JSON.stringify(out);
 };
 const html='<!doctype html><html lang="en"><body><article id="post"><a href="https://x.com/private-name/status/987654321">time</a><div data-testid="tweetText">private text</div><button id="reply" data-testid="reply"><span role="button" data-testid="unknown-private-id" aria-label="private@example.test">icon</span></button></article><output id="result"></output><script>'+code+'</script><script>('+fixture.toString()+')()</script></body></html>';
 const file=path.join(dir,'fixture.html');writeFileSync(file,html);
 const browser=process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const result=spawnSync(browser,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--user-data-dir='+path.join(dir,'profile'),'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:25000,maxBuffer:2*1024*1024});
 assert.equal(result.status,0,result.stderr);
 const matches=result.stdout.match(/<output id="result">(\[[^\]]+\])<\/output>/);
 assert.ok(matches,result.stdout.slice(-500));const checks=JSON.parse(matches[1]);assert.equal(checks.length,13);assert.ok(checks.every(Boolean),JSON.stringify(checks));
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('quote-only source and existing verified copy-only route are not misclassified as missing post text or mount',()=>{const r={page:'x',contentScript:'running',floatingEnabled:true,reproduction:{state:'complete',gesture:{rule:'testid',post:{article:true,identityVerified:true,mainTextPresent:false,quoteTextPresent:true}},marks:[{stage:'activated',reason:'trusted_reply_click'},{stage:'copy_only',reason:'new_editor_unverified_parent'},{stage:'window',reason:'mounted'}],samples:[]}};assert.equal(classifyFailure(r),'window_mounted_during_capture');assert.equal(classifyFailure({...r,reproduction:{...r.reproduction,gesture:{...r.reproduction.gesture,post:{...r.reproduction.gesture.post,quoteTextPresent:false}}}}),'post_text_missing');});


test('V3 layout classification requires multiple modern signals, supports mixed and fails unknown',()=>{
 assert.equal(classifyLayout({textareaCandidates:1,modernAppMarker:true}),'unknown');
 assert.equal(classifyLayout({standardReplyControls:4}),'legacy');
 assert.equal(classifyLayout({modernAppMarker:true,modernReplyControls:3}),'modern');
 assert.equal(classifyLayout({modernBundlePresent:true,modernPostWrappers:3,modernBodyNodes:4}),'modern');
 assert.equal(classifyLayout({modernAppMarker:true,modernReplyControls:3,tweetContainers:1}),'mixed');
 assert.equal(classifyLayout({modernReplyControls:0,modernBodyNodes:1}),'unknown');
 const privateValue='private-user-4928484829';
 const l=sanitizeLayout({layoutFamily:privateValue,modernAppMarker:true,modernReplyControls:3,
  dialogs:Array.from({length:10},()=>({node:{tag:'div',role:'dialog',slot:privateValue,engagementAction:privateValue,href:privateValue},
  modernCanonicalLinks:1,textareaEditors:1,html:privateValue})),modernPostWrappers:privateValue});
 assert.equal(l.layoutFamily,'modern');assert.equal(l.dialogs.length,3);
 const r=sanitizeReproduction({state:'complete',facts:[{value:{editors:[{editor:{tag:'textarea',engagementAction:privateValue,value:privateValue},contextDetail:privateValue}]}}]},[],[]);
 assert.equal(r.facts[0].value.editors[0].contextDetail,'unknown');
 assert.doesNotMatch(JSON.stringify({l,r}),/private-user-4928484829/);
});


test('deep structural evidence is bounded and independently redacted at export boundary',()=>{
 const secret='private-id-4928484829';
 const bad={parentIndex:999,tag:secret,role:secret,testId:secret,engagementAction:secret,slot:secret,flags:['aria-label',secret],classes:['whitespace-pre-wrap',secret],hrefKind:secret,dataHrefKind:secret,labelKind:secret,html:secret,value:secret};
 const tree={nodes:Array.from({length:100},()=>bad),truncated:true};
 const raw={state:'complete',click:{postTree:tree,controlPath:Array(30).fill(bad),composedPath:[bad]},details:Array.from({length:5},()=>({label:'finish',dialogTrees:[tree,tree,tree],focusPath:[bad],editorPaths:[[bad]]})),marks:[{stage:'fill',reason:'verified',atMs:20000}]};
 const r=sanitizeReproduction(raw,['fill'],['verified']);
 assert.equal(r.click.postTree.nodes.length,48);
 assert.equal(r.click.controlPath.length,12);
 assert.equal(r.details.length,3);
 assert.equal(r.details[0].dialogTrees.length,2);
 assert.deepEqual(r.click.postTree.nodes[0].flags,['aria-label']);
 assert.equal(r.click.postTree.nodes[0].parentIndex,null);
 assert.doesNotMatch(JSON.stringify(r),/private-id-4928484829/);
});
test('V3 findings distinguish mounted-only, generation and verified fill',()=>{
 const base={page:'x',contentScript:'running',floatingEnabled:true,reproduction:{state:'complete',clickCaptured:true,click:{rule:'engagement',post:{article:true,identityVerified:true,mainTextPresent:true}},samples:[],marks:[{stage:'activated',reason:'trusted_reply_click'},{stage:'bound',reason:'new_focused_reply_editor'},{stage:'window',reason:'mounted'},{stage:'generation',reason:'succeeded'}]}};
 assert.equal(classifyFailure(base),'window_mounted_during_capture');
 for(const [reason,finding] of [['verified','fill_verified'],['draft_protected','fill_draft_protected'],['not_safe_to_focus','fill_safety_blocked'],['not_accepted','fill_not_accepted'],['readback_mismatch','fill_readback_mismatch']]){
  assert.equal(classifyFailure({...base,reproduction:{...base.reproduction,marks:[...base.reproduction.marks,{stage:'fill',reason}]}}),finding);
 }
});
