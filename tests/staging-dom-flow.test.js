import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function flow({associationOnly=false,homeComposer=false}={}){
 let next=0,commandCount=0,generationCount=0,now=0,entries=[],currentUrl='https://x.com/home';
 const handlers={},pending=[],logs=[],observers=[],timers=new Map(),statuses=[],hosts=[]; let action;
 const document={body:{},visibilityState:'visible',activeElement:null,hasFocus:()=>true,addEventListener:(n,h)=>handlers[n]=h,removeEventListener(){},execCommand(_c,_u,text){commandCount++;this.activeElement.innerText=text;this.activeElement.input?.();return true;}};
 const chrome={runtime:{id:'test',onMessage:{addListener(){},removeListener(){}},sendMessage(message){
   if(message.type==='REPLY_COPILOT_GET_BEHAVIOR')return Promise.resolve({ok:true,preferences:{autoGenerateOnReply:true,showFloatingWindow:true}});
   if(message.type==='REPLY_COPILOT_ACCOUNT_STATE')return Promise.resolve({ok:true,status:'credits_available'});
   if(message.type==='REPLY_COPILOT_GENERATE'){generationCount++;return new Promise(resolve=>pending.push(resolve));}
   return Promise.resolve({ok:true});
 }}};
 const assistant=()=>({host:(()=>{const h={isConnected:true,contains:()=>false,remove(){this.isConnected=false}};hosts.push(h);return h})(),showLoading(){},showResult(){},setAccountLabel(){},showApplied(){},showAccount(){},setStatus:s=>statuses.push(s),showReady(){},close(){}});
 class DataTransfer {setData(type,text){this[type]=text;}getData(type){return this[type]||'';}}
 class ClipboardEvent extends Event {constructor(type,options){super(type,options);this.clipboardData=options.clipboardData;}}
 const ctx={DataTransfer,ClipboardEvent,document,window:{getSelection:()=>({isCollapsed:true,anchorNode:document.activeElement,focusNode:document.activeElement}),addEventListener(){}},location:{get href(){return currentUrl}},performance:{now:()=>now},URL,chrome,console:{info:(...a)=>logs.push(a)},crypto:{randomUUID:()=>`r${++next}`},setTimeout:(fn,ms)=>ms===9000||ms===60000?(timers.set(ms,fn),ms):setTimeout(fn,ms),clearTimeout:id=>{timers.delete(id);clearTimeout(id)},setInterval,clearInterval,Symbol,MutationObserver:class{constructor(cb){this.cb=cb;observers.push(this)}observe(){this.live=true}disconnect(){this.live=false}},globalThis:null};ctx.globalThis=ctx;
 for(const name of ['composer-adapter','composer-association'])vm.runInNewContext(readFileSync(new URL(`../experiments/staging-no-debugger/content/${name}.js`,import.meta.url),'utf8'),ctx);
 const api=ctx.ZaneReplyCopilotContent;
 // Browser boundary only: state machine and content-script actions are real.
 api.composerAssociation.baseline=()=>({baselineModalCount:entries.filter(x=>x.modal!==false).length,visibleEditorCount:entries.length+(homeComposer?1:0),visibleReplyEditorCount:entries.filter(x=>x.modal!==false).length,baselineEditors:entries.map(x=>x.node)});
 api.composerAssociation.snapshot=(_d,p,_initial,_current,_at,quarantinedPosts=[])=>({now,visibleDialogCount:entries.filter(x=>x.modal!==false).length,routeAllowed:currentUrl==='https://x.com/home'||currentUrl==='https://x.com/compose/post',sourceUnchanged:!p.article.isConnected||p.article.post.statusId===p.statusId,editors:entries.map(x=>({...x,contextMatches:typeof x.contextText==='string'?x.contextText===p.sourceText:x.contextMatches,focused:x.node===document.activeElement,empty:!x.node.innerText,quarantinedContextMatch:Boolean(x.contextStatusId!==p.statusId&&quarantinedPosts.some(q=>q.statusId!==p.statusId&&q.sourceText===p.sourceText))}))});
 Object.assign(api,{experimentConfig:{associationOnly},replyDetector:{findReplyControl:target=>target.isReply?target:null},postExtractor:{extractPost:article=>article?.post||{ok:false}},inlineAssistant:{mount:(_anchor,handler)=>{action=handler;return assistant()}}});
 vm.runInNewContext(readFileSync(new URL('../experiments/staging-no-debugger/content/content-script.js',import.meta.url),'utf8'),ctx);
 function post(id){const editor={dispatchEvent(event){commandCount++;event.preventDefault();this.innerText=event.clipboardData.getData('text/plain');return false;},isConnected:true,innerText:'',parentElement:{isConnected:true},contains:n=>n===editor,focus(){document.activeElement=this},addEventListener(_n,cb){this.input=cb},removeEventListener(){}};const article={isConnected:true};article.post={ok:true,article,statusId:id,sourceText:`post text ${id}`,sourceUrl:`https://x.com/test/status/${id}`};return {editor,article,control:{isReply:true,closest:s=>s==='article'?article:null}};}
 const mutate=()=>{for(const o of observers)if(o.live)o.cb()};
 return {dialogReply:()=>{const target={isReply:true,closest:s=>s==='[role="dialog"]'?{}:null};handlers.pointerdown({type:'pointerdown',isTrusted:true,target});handlers.click({isTrusted:true,target})}, action:(name,data={})=>action(name,data),hosts,outside:()=>handlers.pointerdown({type:'pointerdown',isTrusted:true,target:{}}),post,pointer:(p)=>handlers.pointerdown({type:'pointerdown',isTrusted:true,target:p.control}),click:(p,trusted=true)=>{handlers.pointerdown({type:'pointerdown',isTrusted:trusted,target:p.control});handlers.click({isTrusted:trusted,target:p.control})},clickOnly:(p,control=p.control)=>handlers.click({isTrusted:true,target:control}),clickWithReplacement:(p)=>{handlers.pointerdown({type:'pointerdown',isTrusted:true,target:p.control});const replacement={isReply:true,closest:s=>s==='article'?p.article:null};handlers.click({isTrusted:true,target:replacement})},invalidateSource:(p,reason='post_text_unavailable')=>{p.article.post={...p.article.post,ok:false,reason,statusLinkCount:1,textNodeCount:0};},changeSource:(p,id)=>{p.article.post={...p.article.post,statusId:id,sourceUrl:`https://x.com/test/status/${id}`};},open:p=>{entries=[{node:p.editor,modal:true,contextMatches:true,contextText:p.article.post.sourceText,contextStatusId:null}];document.activeElement=p.editor;mutate()},close:(p,{notify=true,detach=true}={})=>{entries=[];if(detach)p.editor.isConnected=false;document.activeElement=null;if(notify)mutate()},entries:x=>{entries=x;mutate()},mutate,resolve:i=>pending[i]({ok:true,result:{recommendation:'reply',defaultStyle:'natural',replies:{natural:'中文 English 😀\nline'}}}),generations:()=>generationCount,commands:()=>commandCount,logs,statuses,document,timeout:ms=>timers.get(ms)?.(),route:url=>{currentUrl=url;mutate()},time:n=>{now=n},report:()=>ctx.__xrhStagingDiagnosticReport?.(),escape:()=>handlers.keydown({type:'keydown',key:'Escape',isTrusted:true,target:document.activeElement}),focus:node=>{document.activeElement=node;handlers.focusin()},beforeTyping:node=>handlers.beforeinput?.({isTrusted:true,target:node}),typing:p=>{p.editor.innerText='user draft';p.editor.input?.()}};
}
test('missing status link and detached original still bind from a captured activation',async()=>{const f=flow(),p=f.post('101');f.click(p);p.article.isConnected=false;f.open(p);await sleep(0);assert.equal(f.generations(),1);f.resolve(0);await sleep(110);assert.equal(f.commands(),1);assert.equal(p.editor.innerText,'中文 English 😀\nline');});
test('association-only mode mounts status without calling AI or inserting',async()=>{const f=flow({associationOnly:true}),p=f.post('101');f.click(p);f.open(p);await sleep(0);assert.equal(f.generations(),0);assert.equal(f.commands(),0);assert.ok(f.statuses.some(x=>x.includes('不调用 AI')));});
test('untrusted activation cannot generate',async()=>{const f=flow(),p=f.post('101');f.click(p,false);f.open(p);await sleep(0);assert.equal(f.generations(),0);});
test('trusted click remains usable if pointerdown was missed',async()=>{const f=flow(),p=f.post('101');f.clickOnly(p);f.open(p);await sleep(0);assert.equal(f.generations(),1);assert.equal(JSON.parse(f.report()).pathCounts.activation_not_captured,1);assert.ok(JSON.parse(f.report()).pathCounts.trusted_click_recovered_activation===1);});
test('a dynamically replaced Reply control is accepted only inside the same verified post article',async()=>{const f=flow(),p=f.post('101');f.clickWithReplacement(p);f.open(p);await sleep(0);assert.equal(f.generations(),1);assert.ok(JSON.parse(f.report()).pathCounts.activation_control_replaced===1);});
test('same-text different post without modal status identity is refused after a prior verified click',async()=>{const f=flow({associationOnly:true}),a=f.post('101'),b=f.post('102');b.article.post.sourceText=a.article.post.sourceText;f.click(a);f.open(a);await sleep(0);f.close(a);f.click(b);f.open(b);await sleep(0);assert.equal(f.generations(),0);assert.ok(f.logs.some(x=>x[2]?.includes('stale_activation_ambiguous')));});
test('failure report counts source, activation, context, focus and acquisition expiry paths without content',async()=>{
 const source=flow(),sp=source.post('101');source.invalidateSource(sp);source.click(sp);assert.ok(JSON.parse(source.report()).pathCounts.source_unverified>=1);
 const changed=flow(),cp=changed.post('201');changed.pointer(cp);changed.changeSource(cp,'999');changed.clickOnly(cp);assert.ok(JSON.parse(changed.report()).pathCounts.source_changed===1);
 const focus=flow(),fp=focus.post('301');focus.click(fp);focus.entries([{node:fp.editor,modal:true,contextMatches:true,contextStatusId:null}]);assert.ok(JSON.parse(focus.report()).pathCounts.awaiting_editor_focus===1);
 const expired=flow(),ep=expired.post('401');expired.click(ep);expired.timeout(9000);assert.ok(JSON.parse(expired.report()).pathCounts.association_expired===1);
 for(const f of [source,changed,focus,expired])assert.doesNotMatch(f.report(),/same post text|https:|sourceUrl|requestId|中文/);
});
test('rapid same-post or same-text different-post clicks stop the pending operation',async()=>{for(const different of [false,true]){const f=flow(),p=f.post('101'),q=different?f.post('102'):p;if(different)q.article.post.sourceText=p.article.post.sourceText;f.click(p);f.click(q);f.open(q);await sleep(0);assert.equal(f.generations(),0);assert.ok(f.logs.some(x=>x[2]?.includes('competing_activation')));}});
test('preexisting dialog prevents a new activation',async()=>{const f=flow(),p=f.post('101'),q=f.post('102');f.open(q);f.click(p);f.open(p);await sleep(0);assert.equal(f.generations(),0);});
test('focus arriving after the modal is observed completes the same association',async()=>{const f=flow(),p=f.post('101');f.click(p);f.entries([{node:p.editor,modal:true,contextMatches:true,contextStatusId:null}]);await sleep(0);assert.equal(f.generations(),0);f.focus(p.editor);await sleep(0);assert.equal(f.generations(),1);});
test('multiple editors and a conflicting post id cannot generate',async()=>{for(const mode of ['multiple','conflict']){const f=flow(),p=f.post('101'),q=f.post('102');f.click(p);f.document.activeElement=p.editor;const x={node:p.editor,modal:true,contextMatches:true,contextStatusId:mode==='conflict'?'102':null};f.entries(mode==='multiple'?[x,{...x,node:q.editor}]:[x]);await sleep(0);assert.equal(f.generations(),0);}});
test('typing during generation preserves the user draft',async()=>{const f=flow(),p=f.post('101');f.click(p);f.open(p);await sleep(0);f.typing(p);f.resolve(0);await sleep(110);assert.equal(f.commands(),0);assert.equal(p.editor.innerText,'user draft');});
test('closing or replacing editor while generation runs rejects late results',async()=>{for(const replacement of [false,true]){const f=flow(),p=f.post('101'),q=f.post('102');f.click(p);f.open(p);await sleep(0);f.entries(replacement?[{node:q.editor,modal:true,contextMatches:true,contextStatusId:null}]:[]);f.resolve(0);await sleep(110);assert.equal(f.commands(),0);}});
test('source recycling, cancellation, or route change prevents delayed insertion',async()=>{for(const change of [f=>f.escape(),f=>f.route('https://x.com/search'),(f,p)=>{p.article.post={...p.article.post,statusId:'999'};f.mutate()}]){const f=flow(),p=f.post('101');f.click(p);f.open(p);await sleep(0);change(f,p);f.resolve(0);await sleep(110);assert.equal(f.commands(),0);}});
test('acquisition timeout cannot revive on late modal creation and logs no post data',async()=>{const f=flow(),p=f.post('101');f.click(p);f.timeout(9000);f.open(p);await sleep(0);assert.equal(f.generations(),0);assert.doesNotMatch(JSON.stringify(f.logs),/same post text|https:|"(?:statusId|sourceUrl|requestId)"/);});

test('after competing activations a third click cannot claim a late modal from an earlier post',async()=>{const f=flow(),a=f.post('101'),b=f.post('102'),c=f.post('103');f.click(a);f.click(b);f.click(c);f.open(a);await sleep(0);assert.equal(f.generations(),0);assert.equal(f.commands(),0);});
test('an expired acquisition cannot lend a late same-text modal to the next click',async()=>{const f=flow(),a=f.post('101'),b=f.post('102');b.article.post.sourceText=a.article.post.sourceText;f.click(a);f.timeout(9000);f.click(b);f.open(a);await sleep(0);assert.equal(f.generations(),0);});

test('typing before focus/binding cancels even when the user subsequently clears the draft',async()=>{const f=flow(),p=f.post('101');f.click(p);f.entries([{node:p.editor,modal:true,contextMatches:true,contextStatusId:null}]);f.beforeTyping(p.editor);f.focus(p.editor);await sleep(0);assert.equal(f.generations(),0);assert.equal(f.commands(),0);});

 test('lost document focus blocks insertion with safe boolean evidence',async()=>{const f=flow(),p=f.post('101');f.click(p);f.open(p);await sleep(0);f.document.hasFocus=()=>false;f.resolve(0);await sleep(110);assert.equal(f.commands(),0);const event=f.logs.find(x=>x[1]==='insert_context_changed');assert.equal(JSON.parse(event[2]).documentFocused,false);assert.doesNotMatch(event[2],/same post text|https:|中文/);});


test('five completed reply sessions can run consecutively without a page reload',async()=>{
 for(const detach of [true,false]){
  const f=flow();
  for(let i=0;i<5;i++){
   const p=f.post(String(101+i));f.click(p);f.open(p);await sleep(0);
   assert.equal(f.generations(),i+1);f.resolve(i);await sleep(100);
   assert.equal(f.commands(),i+1);assert.equal(p.editor.innerText,'中文 English 😀\nline');
   // A new trusted click may arrive before MutationObserver delivers closure.
   f.close(p,{notify:false,detach});
  }
  assert.ok(!f.logs.some(x=>x[2]?.includes('activation_requires_reload')));
 }
});
test('a late response from a closed session cannot write into the next reply session',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);f.open(a);await sleep(0);
 f.close(a,{notify:false});f.click(b);f.open(b);await sleep(0);assert.equal(f.generations(),2);
 f.resolve(0);await sleep(100);assert.equal(f.commands(),0);assert.equal(b.editor.innerText,'');
 f.resolve(1);await sleep(100);assert.equal(f.commands(),1);assert.equal(b.editor.innerText,'中文 English 😀\nline');
});
test('closing an expired bound editor permits another normal reply session',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);f.open(a);await sleep(0);
 f.timeout(60000);f.close(a);f.click(b);f.open(b);await sleep(0);assert.equal(f.generations(),2);
 f.resolve(0);await sleep(100);assert.equal(f.commands(),0);f.resolve(1);await sleep(100);assert.equal(f.commands(),1);
});
test('a competing reply while a bound editor is still visible remains rejected',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);f.open(a);await sleep(0);
 f.click(b);f.resolve(0);await sleep(100);assert.equal(f.generations(),1);assert.equal(f.commands(),0);
 assert.ok(f.logs.some(x=>x[2]?.includes('competing_activation')));
});


test('normal modal closure removes the old assistant without showing a competition error',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);f.open(a);await sleep(0);
 f.outside();f.close(a);assert.equal(f.hosts[0].isConnected,false);
 assert.ok(!f.logs.some(x=>x[2]?.includes('competing_activation')));
 f.click(b);f.open(b);await sleep(0);assert.equal(f.generations(),2);
 f.resolve(0);await sleep(100);assert.equal(f.commands(),0);f.resolve(1);await sleep(100);assert.equal(f.commands(),1);
});

test('regenerating does not orphan the editor lifecycle before the next reply',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);f.open(a);await sleep(0);
 f.resolve(0);await sleep(100);assert.equal(f.commands(),1);
 f.action('regenerate');await sleep(0);assert.equal(f.generations(),2);
 f.close(a,{notify:false});f.click(b);f.open(b);await sleep(0);
 assert.equal(f.generations(),3);f.resolve(1);await sleep(100);assert.equal(b.editor.innerText,'');
 f.resolve(2);await sleep(100);assert.equal(f.commands(),2);
 assert.ok(!f.logs.some(x=>x[2]?.includes('competing_activation')));
});

test('native reply dialog controls do not trigger a competing post activation',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);f.open(a);await sleep(0);f.resolve(0);await sleep(100);
 f.dialogReply();f.close(a,{notify:false});f.click(b);f.open(b);await sleep(0);
 assert.equal(f.generations(),2);assert.ok(!f.logs.some(x=>x[2]?.includes('competing_activation')));
});
test('ten consecutive reply associations without AI',async()=>{
 const f=flow({associationOnly:true});for(let i=0;i<10;i++){const p=f.post(String(100+i));f.click(p);f.open(p);await sleep(0);assert.equal(f.statuses.filter(x=>x.includes('关联验证通过')).length,i+1);f.close(p,{notify:i%2===0,detach:i%3!==0});}
 assert.equal(f.generations(),0);assert.ok(!f.logs.some(x=>x[2]?.includes('competing_activation')));
});

test('successful fill is not replaced by internal editor lifecycle text',async()=>{
 const f=flow(),p=f.post('101'),replacement=f.post('102');f.click(p);f.open(p);await sleep(0);f.resolve(0);await sleep(100);assert.equal(f.commands(),1);
 f.entries([{node:replacement.editor,modal:true,contextMatches:true,contextStatusId:null}]);
 assert.ok(f.logs.some(x=>x[2]?.includes('editor_replaced_or_closed')));
 assert.ok(!f.statuses.some(x=>/关联已停止|editor_replaced_or_closed|competing_activation|association_expired/.test(x)));
});
test('pre-fill lifecycle failures use user wording while retaining diagnostic reasons',async()=>{
 const f=flow(),p=f.post('101');f.click(p);f.timeout(9000);
 assert.ok(f.logs.some(x=>x[2]?.includes('association_expired')));
 assert.ok(f.statuses.every(x=>!/association_expired|关联已停止/.test(x)));
});

test('an expired unbound activation recovers on a fresh click after the page is quiescent',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');
 b.article.post.sourceText='a distinct second post';
 f.click(a);f.timeout(9000);
 f.click(b);f.open(b);await sleep(0);
 assert.equal(f.generations(),1);
 f.resolve(0);await sleep(100);
 assert.equal(f.commands(),1);
});

test('a competing activation recovers after the old reply dialog is actually closed',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');
 f.click(a);f.open(a);await sleep(0);
 f.click(b);f.close(a);
 f.click(b);f.open(b);await sleep(0);
 assert.equal(f.generations(),2);
 f.resolve(0);f.resolve(1);await sleep(100);
 assert.equal(f.commands(),1);
});

test('quiescent recovery does not claim a late same-text composer from a quarantined activation',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');
 b.article.post.sourceText=a.article.post.sourceText;
 f.click(a);f.timeout(9000);f.click(b);f.open(a);await sleep(0);
 assert.equal(f.generations(),0);
 assert.ok(f.logs.some(x=>x[2]?.includes('stale_activation_ambiguous')));
});

test('recovery remains blocked while any old dialog or editor is still visible',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');b.article.post.sourceText='a distinct second post';
 f.click(a);f.timeout(9000);f.open(a);f.click(b);
 assert.equal(JSON.parse(f.report()).recoveryRequired,true);
 assert.equal(f.generations(),0);
 f.close(a);f.click(b);f.open(b);await sleep(0);
 assert.equal(f.generations(),1);
});

test('fresh sessions remain available after 30s, 90s, 3m and 5m idle gaps',async()=>{
 const f=flow({associationOnly:true});
 let now=0;
 for(const [i,gap] of [30_000,90_000,180_000,300_000].entries()){
  now+=gap;f.time(now);
  const p=f.post(String(200+i));p.article.post.sourceText=`idle gap post ${i}`;
  f.click(p);f.open(p);await sleep(0);
  assert.ok(f.statuses.some(x=>x.includes('关联验证通过')));
  f.close(p);
 }
 assert.equal(f.generations(),0);
});

test('an expired bound editor closed after background-style time passage permits the next session',async()=>{
 const f=flow({associationOnly:true}),a=f.post('301'),b=f.post('302');
 f.click(a);f.open(a);await sleep(0);f.time(180_000);f.timeout(60_000);f.close(a);
 f.click(b);f.open(b);await sleep(0);
 assert.ok(f.statuses.filter(x=>x.includes('关联验证通过')).length>=2);
 assert.equal(JSON.parse(f.report()).recoveryRequired,false);
});

test('diagnostic report is copyable and contains no post content, URL or request identifier',()=>{
 const f=flow(),p=f.post('101');f.click(p);
 const report=JSON.parse(f.report());
 assert.equal(report.build,'staging-post-context-20261029-1');
 assert.deepEqual(report.pathCounts,{});
 assert.ok(Array.isArray(report.events));
 assert.doesNotMatch(JSON.stringify(report),/same post text|https:|"(?:statusId|sourceUrl|requestId)"|中文/);
});

test('a permanent home composer does not lock recovery after a rejected reply modal closes',async()=>{
 const f=flow({homeComposer:true}),a=f.post('401'),b=f.post('402');
 b.article.post.sourceText='distinct next post';
 f.click(a);f.entries([{node:a.editor,modal:true,contextMatches:false,contextStatusId:null}]);
 assert.ok(f.logs.some(x=>x[2]?.includes('reply_context_unconfirmed')));
 assert.equal(JSON.parse(f.report()).pathCounts.reply_context_unconfirmed,1);
 f.close(a);f.click(b);f.open(b);await sleep(0);
 assert.equal(f.generations(),1);
 f.resolve(0);await sleep(100);assert.equal(f.commands(),1);
 assert.equal(JSON.parse(f.report()).recoveryRequired,false);
});
