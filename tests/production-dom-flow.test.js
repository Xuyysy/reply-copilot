import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function flow({associationOnly=false,homeComposer=false,autoGenerateOnReply=true,performanceTracing=false}={}){
 let next=0,commandCount=0,generationCount=0,snapshotCount=0,now=0,entries=[],currentUrl='https://x.com/home';
 const handlers={},pending=[],logs=[],observers=[],timers=new Map(),statuses=[],hosts=[]; let action;
 const document={body:{},visibilityState:'visible',activeElement:null,hasFocus:()=>true,addEventListener:(n,h)=>handlers[n]=h,removeEventListener(){},execCommand(_c,_u,text){commandCount++;this.activeElement.innerText=text;this.activeElement.input?.();return true;}};
 const chrome={runtime:{id:'test',onMessage:{addListener(){},removeListener(){}},sendMessage(message){
   if(message.type==='REPLY_COPILOT_PERFORMANCE_STATE')return Promise.resolve({enabled:performanceTracing});
   if(message.type==='REPLY_COPILOT_GET_BEHAVIOR')return Promise.resolve({ok:true,preferences:{autoGenerateOnReply,showFloatingWindow:true}});
   if(message.type==='REPLY_COPILOT_ACCOUNT_STATE')return Promise.resolve({ok:true,status:'credits_available'});
   if(message.type==='REPLY_COPILOT_GENERATE'){generationCount++;return new Promise(resolve=>pending.push(resolve));}
   return Promise.resolve({ok:true});
 }}};
 const assistant=()=>({showExperimentalFill:enabled=>statuses.push(enabled?"experimental_fill_available":"experimental_fill_hidden"),host:(()=>{const h={isConnected:true,style:{},contains:()=>false,remove(){this.isConnected=false}};hosts.push(h);return h})(),showLoading(){},showResult(){},setAccountLabel(){},showApplied(){},showAccount(){},enterPostReplyMode(){statuses.push('post_reply_interactive')},setStatus:s=>statuses.push(s),showReady(){},close(){}});
 class DataTransfer {setData(type,text){this[type]=text;}getData(type){return this[type]||'';}}
 class ClipboardEvent extends Event {constructor(type,options){super(type,options);this.clipboardData=options.clipboardData;}}
 const ctx={DataTransfer,ClipboardEvent,document,window:{getSelection:()=>({isCollapsed:true,anchorNode:document.activeElement,focusNode:document.activeElement}),addEventListener(){}},location:{get href(){return currentUrl}},performance:{now:()=>now},URL,chrome,console:{info:(...a)=>logs.push(a)},crypto:{randomUUID:()=>`r${++next}`},setTimeout:(fn,ms)=>ms===360||ms===800||ms===9000||ms===60000||ms===30000?(timers.set(ms,fn),ms):setTimeout(fn,ms),clearTimeout:id=>{timers.delete(id);clearTimeout(id)},setInterval,clearInterval,Symbol,MutationObserver:class{constructor(cb){this.cb=cb;observers.push(this)}observe(){this.live=true}disconnect(){this.live=false}},globalThis:null};ctx.globalThis=ctx;
 vm.runInNewContext(readFileSync(new URL("../utils/generation-performance.js",import.meta.url),"utf8"),ctx);
 for(const name of ['composer-adapter','composer-association'])vm.runInNewContext(readFileSync(new URL(`../content/${name}.js`,import.meta.url),'utf8'),ctx);
 const api=ctx.ZaneReplyCopilotContent;
 // Browser boundary only: state machine and content-script actions are real.
 api.composerAssociation.baseline=()=>({baselineModalCount:entries.filter(x=>x.modal!==false).length,visibleEditorCount:entries.length+(homeComposer?1:0),visibleReplyEditorCount:entries.filter(x=>x.modal!==false).length,baselineEditors:entries.map(x=>x.node)});
 api.composerAssociation.snapshot=(_d,p,_initial,_current,_at,quarantinedPosts=[])=>({now,visibleDialogCount:entries.filter(x=>x.modal!==false).length,routeAllowed:currentUrl==='https://x.com/home'||currentUrl==='https://x.com/compose/post',sourceUnchanged:!p.article.isConnected||p.article.post.statusId===p.statusId,editors:entries.map(x=>({...x,focused:x.node===document.activeElement,empty:!x.node.innerText,quarantinedContextMatch:Boolean(x.contextStatusId!==p.statusId&&quarantinedPosts.some(q=>q.statusId!==p.statusId&&q.sourceText===p.sourceText))}))});
 const originalSnapshot=api.composerAssociation.snapshot;
 api.composerAssociation.snapshot=(...args)=>{snapshotCount++;return originalSnapshot(...args);};
 Object.assign(api,{experimentConfig:{associationOnly},replyDetector:{findReplyControl:target=>target.isReply?target:null},postExtractor:{extractPost:article=>article?.post||{ok:false}},inlineAssistant:{mount:(_anchor,handler)=>{action=handler;return assistant()}}});
 vm.runInNewContext(readFileSync(new URL('../content/content-script.js',import.meta.url),'utf8'),ctx);
 function post(id){const editor={dispatchEvent(event){commandCount++;event.preventDefault();this.innerText=event.clipboardData.getData('text/plain');return false;},isConnected:true,innerText:'',parentElement:{isConnected:true},contains:n=>n===editor,focus(){document.activeElement=this},addEventListener(_n,cb){this.input=cb},removeEventListener(){}};const article={isConnected:true};article.post={ok:true,article,statusId:id,sourceText:'same post text',sourceUrl:`https://x.com/test/status/${id}`};return {editor,article,control:{isReply:true,closest:s=>s==='article'?article:null}};}
 const mutate=()=>{for(const o of observers)if(o.live)o.cb()};
 return {snapshotCalls:()=>snapshotCount,perfReport:()=>ctx.replyCopilotPerformanceReport?.(),dialogReply:()=>{const target={isReply:true,closest:s=>s==='[role="dialog"]'?{}:null};handlers.pointerdown({type:'pointerdown',isTrusted:true,target});handlers.click({isTrusted:true,target})}, action:(name,data={})=>action(name,data),hosts,outside:()=>handlers.pointerdown({type:'pointerdown',isTrusted:true,target:{}}),post,click:(p,trusted=true)=>{handlers.pointerdown({type:'pointerdown',isTrusted:trusted,target:p.control});handlers.click({isTrusted:trusted,target:p.control})},open:p=>{entries=[{node:p.editor,modal:true,contextMatches:true,contextStatusId:null}];document.activeElement=p.editor;mutate()},close:(p,{notify=true,detach=true}={})=>{entries=[];if(detach)p.editor.isConnected=false;document.activeElement=null;if(notify)mutate()},entries:x=>{entries=x;mutate()},mutate,resolve:i=>pending[i]({ok:true,result:{recommendation:'reply',defaultStyle:'natural',replies:{natural:'中文 English 😀\nline'}}}),generations:()=>generationCount,commands:()=>commandCount,logs,statuses,document,timeout:ms=>timers.get(ms)?.(),route:url=>{currentUrl=url;mutate()},time:n=>{now=n},report:()=>ctx.__xrhStagingDiagnosticReport?.(),escape:()=>handlers.keydown({type:'keydown',key:'Escape',isTrusted:true,target:document.activeElement}),focus:node=>{document.activeElement=node;handlers.focusin()},beforeTyping:node=>handlers.beforeinput?.({isTrusted:true,target:node}),typing:p=>{p.editor.innerText='user draft';p.editor.input?.()}};
}
test('missing status link and detached original still bind from a captured activation',async()=>{const f=flow(),p=f.post('101');f.click(p);p.article.isConnected=false;f.open(p);await sleep(0);assert.equal(f.generations(),1);f.resolve(0);await sleep(110);assert.equal(f.commands(),1);assert.equal(p.editor.innerText,'中文 English 😀\nline');});

test('untrusted activation cannot generate',async()=>{const f=flow(),p=f.post('101');f.click(p,false);f.open(p);await sleep(0);assert.equal(f.generations(),0);});

test('preexisting dialog prevents a new activation',async()=>{const f=flow(),p=f.post('101'),q=f.post('102');f.open(q);f.click(p);f.open(p);await sleep(0);assert.equal(f.generations(),0);});
test('focus arriving after the modal is observed completes the same association',async()=>{const f=flow(),p=f.post('101');f.click(p);f.entries([{node:p.editor,modal:true,contextMatches:true,contextStatusId:null}]);await sleep(0);assert.equal(f.generations(),0);f.focus(p.editor);await sleep(0);assert.equal(f.generations(),1);});
test('multiple editors and a conflicting post id cannot generate',async()=>{for(const mode of ['multiple','conflict']){const f=flow(),p=f.post('101'),q=f.post('102');f.click(p);f.document.activeElement=p.editor;const x={node:p.editor,modal:true,contextMatches:true,contextStatusId:mode==='conflict'?'102':null};f.entries(mode==='multiple'?[x,{...x,node:q.editor}]:[x]);await sleep(0);assert.equal(f.generations(),0);}});
test('typing during generation preserves the user draft',async()=>{const f=flow(),p=f.post('101');f.click(p);f.open(p);await sleep(0);f.typing(p);f.resolve(0);await sleep(110);assert.equal(f.commands(),0);assert.equal(p.editor.innerText,'user draft');});
test('closing or replacing editor while generation runs rejects late results',async()=>{for(const replacement of [false,true]){const f=flow(),p=f.post('101'),q=f.post('102');f.click(p);f.open(p);await sleep(0);f.entries(replacement?[{node:q.editor,modal:true,contextMatches:true,contextStatusId:null}]:[]);f.resolve(0);await sleep(110);assert.equal(f.commands(),0);}});
test('source recycling, cancellation, or route change prevents delayed insertion',async()=>{for(const change of [f=>f.escape(),f=>f.route('https://x.com/search'),(f,p)=>{p.article.post={...p.article.post,statusId:'999'};f.mutate()}]){const f=flow(),p=f.post('101');f.click(p);f.open(p);await sleep(0);change(f,p);f.resolve(0);await sleep(110);assert.equal(f.commands(),0);}});
test('acquisition timeout cannot revive on late modal creation and logs no post data',async()=>{const f=flow(),p=f.post('101');f.click(p);f.timeout(9000);f.open(p);await sleep(0);assert.equal(f.generations(),0);assert.doesNotMatch(JSON.stringify(f.logs),/same post text|https:|statusId|sourceUrl/);});

test('after competing activations a third click cannot claim a late modal from an earlier post',async()=>{const f=flow(),a=f.post('101'),b=f.post('102'),c=f.post('103');f.click(a);f.click(b);f.click(c);f.open(a);await sleep(0);assert.equal(f.generations(),0);assert.equal(f.commands(),0);});
test('an expired acquisition cannot lend a late same-text modal to the next click',async()=>{const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);f.timeout(9000);f.click(b);f.open(a);await sleep(0);assert.equal(f.generations(),0);});

test('typing before focus/binding cancels even when the user subsequently clears the draft',async()=>{const f=flow(),p=f.post('101');f.click(p);f.entries([{node:p.editor,modal:true,contextMatches:true,contextStatusId:null}]);f.beforeTyping(p.editor);f.focus(p.editor);await sleep(0);assert.equal(f.generations(),0);assert.equal(f.commands(),0);});

 test('lost document focus blocks insertion with safe boolean evidence',async()=>{const f=flow(),p=f.post('101');f.click(p);f.open(p);await sleep(0);f.document.hasFocus=()=>false;f.resolve(0);await sleep(110);assert.equal(f.commands(),0);assert.ok(f.statuses.some(x=>x.includes('回复框')));});


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
 assert.ok(f.statuses.some(x=>x.includes('另一个回复操作')));
});


test('normal modal closure removes the old assistant without showing a competition error',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);f.open(a);await sleep(0);
 f.outside();f.close(a);await sleep(380);assert.equal(f.hosts[0].isConnected,false);
 assert.ok(!f.logs.some(x=>x[2]?.includes('competing_activation')));
 f.click(b);f.open(b);await sleep(0);assert.equal(f.generations(),2);
 f.resolve(0);await sleep(100);assert.equal(f.commands(),0);f.resolve(1);await sleep(100);assert.equal(f.commands(),1);
});

test('applied reply closes native dialog but retains interactive 30s copy-only panel',async()=>{
 const f=flow(),a=f.post('101');f.click(a);f.open(a);await sleep(0);
 f.resolve(0);await sleep(110);assert.equal(f.commands(),1);
 f.close(a);await sleep(380);
 assert.equal(f.hosts[0].isConnected,true,'completed reply briefly remains visible');
 assert.notEqual(f.hosts[0].style.pointerEvents,'none','buttons remain clickable');
 assert.ok(f.statuses.includes('post_reply_interactive'));
 f.action('settings');f.action('selected',{style:'natural',reply:'old reply'});
 f.action('copied',{style:'natural',reply:'old reply'});
 f.action('feedback',{feedback:'good',style:'natural'});
 f.action('regenerate');f.action('generate');
 assert.equal(f.generations(),1,'stale panel cannot start another paid generation');
 f.action('linger_interaction');
 assert.equal(f.hosts[0].isConnected,true);
 f.timeout(30000);assert.equal(f.hosts[0].isConnected,false,'panel expires after inactivity');
});
test('next trusted reply instantly retires any lingering acknowledgement',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);f.open(a);await sleep(0);
 f.resolve(0);await sleep(110);f.close(a);await sleep(380);
 assert.equal(f.hosts[0].isConnected,true);
 f.click(b);f.open(b);await sleep(0);
 assert.equal(f.hosts[0].isConnected,false,'old inert host removed before next reply');
 assert.equal(f.generations(),2,'second reply generates exactly once');
 f.resolve(1);await sleep(110);
 assert.equal(f.commands(),2,'second suggestion inserts into the new editor');
 assert.equal(b.editor.innerText,'中文 English 😀\nline');
});
test('manually closing retained interactive panel cannot block a fresh reply',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');f.click(a);f.open(a);await sleep(0);
 f.resolve(0);await sleep(110);f.close(a);await sleep(380);
 assert.equal(f.hosts[0].isConnected,true);
 f.action('dismiss');assert.equal(f.hosts[0].isConnected,false);
 f.click(b);f.open(b);await sleep(0);
 assert.equal(f.generations(),2);
 f.resolve(1);await sleep(110);assert.equal(f.commands(),2);
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


test('successful fill is not replaced by internal editor lifecycle text',async()=>{
 const f=flow(),p=f.post('101'),replacement=f.post('102');f.click(p);f.open(p);await sleep(0);f.resolve(0);await sleep(100);assert.equal(f.commands(),1);
 f.entries([{node:replacement.editor,modal:true,contextMatches:true,contextStatusId:null}]);
 assert.ok(!f.statuses.some(x=>/关联已停止|editor_replaced_or_closed|competing_activation|association_expired/.test(x)));
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
 f.click(a);f.timeout(9000);f.click(b);f.open(a);await sleep(0);
 assert.equal(f.generations(),0);
});

test('recovery remains blocked while any old dialog or editor is still visible',async()=>{
 const f=flow(),a=f.post('101'),b=f.post('102');b.article.post.sourceText='a distinct second post';
 f.click(a);f.timeout(9000);f.open(a);f.click(b);
 assert.equal(f.generations(),0);
 f.close(a);f.click(b);f.open(b);await sleep(0);
 assert.equal(f.generations(),1);
});

test('fresh sessions remain available after 30s, 90s, 3m and 5m idle gaps',async()=>{
 const f=flow();
 let now=0;
 for(const [i,gap] of [30_000,90_000,180_000,300_000].entries()){
  now+=gap;f.time(now);
  const p=f.post(String(200+i));p.article.post.sourceText=`idle gap post ${i}`;
  f.click(p);f.open(p);await sleep(0);
  assert.equal(f.generations(),i+1);
  f.close(p);
 }
 assert.equal(f.generations(),4);
});

test('an expired bound editor closed after background-style time passage permits the next session',async()=>{
 const f=flow(),a=f.post('301'),b=f.post('302');
 f.click(a);f.open(a);await sleep(0);f.time(180_000);f.timeout(60_000);f.close(a);
 f.click(b);f.open(b);await sleep(0);
 assert.equal(f.generations(),2);
});



test('a permanent home composer does not lock recovery after a rejected reply modal closes',async()=>{
 const f=flow({homeComposer:true}),a=f.post('401'),b=f.post('402');
 b.article.post.sourceText='distinct next post';
 f.click(a);f.entries([{node:a.editor,modal:true,contextMatches:false,contextStatusId:null}]);
 f.close(a);f.click(b);f.open(b);await sleep(0);
 assert.equal(f.generations(),1);
 f.resolve(0);await sleep(100);assert.equal(f.commands(),1);
});

test('media/modal reflow keeps one generation and rebinds only to verified target editor',async()=>{
 const f=flow(),p=f.post('101'),newNode=f.post('102');
 f.click(p);f.open(p);await sleep(0);
 assert.equal(f.generations(),1);
 f.entries([]); // X briefly unmounts its media-rich reply composer.
 f.entries([{node:newNode.editor,modal:true,contextMatches:true,contextStatusId:'101'}]);
 await sleep(0);
 assert.equal(f.generations(),1,'editor remount must not restart generation before focus');
 f.focus(newNode.editor);
 await sleep(0);
 assert.equal(f.generations(),1,'editor remount must never regenerate or double-debit');
 f.resolve(0);await sleep(110);
 assert.equal(f.commands(),1);
 assert.equal(newNode.editor.innerText,'中文 English 😀\nline');
 assert.equal(p.editor.innerText,'');
});

test('a Reply button inside an X media-viewer dialog still activates the text-only assistant',async()=>{
 const f=flow(),p=f.post('101');
 const baseClosest=p.control.closest;
 p.control.closest=selector=>selector==='[role="dialog"]'?{}:baseClosest(selector);
 f.click(p);f.open(p);await sleep(0);
 assert.equal(f.generations(),1,'a media viewer is not a reply composer submit button');
 f.resolve(0);await sleep(110);
 assert.equal(f.commands(),1);
});

test("captured quote with auto disabled exposes manual copy and never charges without user click",async()=>{
 const f=flow({autoGenerateOnReply:false}),p=f.post("101");
 p.article.querySelector=s=>s==='[data-testid="quoteTweet"]'?{}:null;
 f.click(p);
 p.article.isConnected=false;
 f.document.activeElement=p.editor;
 f.entries([{node:p.editor,modal:true,contextMatches:null,contextStatusId:null,
   contextDetail:"awaiting_captioned_quote_parent"}]);
 f.timeout(800);
 await sleep(0);
 assert.equal(f.hosts.length,1,"visible safe fallback mounts without full parent match");
 assert.ok(f.statuses.some(s=>s.includes("复制")));
 assert.equal(f.generations(),0,"fallback never auto-generates or charges");
 f.action("generate");
 await sleep(0);
 assert.equal(f.generations(),1,"manual generate uses the captured source");
 f.resolve(0);
 await sleep(115);
 assert.equal(f.commands(),0,"copy-only must never call native editor insertion");
});
test("unverified modal never triggers quote copy-only fallback without trusted quote and unique focused editor",async()=>{
 for(const mode of ["ordinary","wrong_id","unfocused","preexisting","draft"]){
   const f=flow(),p=f.post("101");
   if(mode!=="ordinary")p.article.querySelector=s=>s==='[data-testid="quoteTweet"]'?{}:null;
   if(mode==="preexisting")f.open(p);
   f.click(p);
   if(mode!=="preexisting")f.document.activeElement=p.editor;
   if(mode!=="preexisting")f.entries([{node:p.editor,modal:true,contextMatches:mode==="wrong_id"?false:null,
     contextStatusId:mode==="wrong_id"?"999":null,contextDetail:"awaiting_captioned_quote_parent"}]);
   if(mode==="unfocused")f.document.activeElement=null;
   if(mode==="draft")p.editor.innerText="user draft";
   f.timeout(800);
   await sleep(0);
   assert.equal(f.hosts.length,0,mode);
   assert.equal(f.generations(),0,mode);
 }
});

test("trusted user can explicitly fill captured quote once when automatic generation is off",async()=>{
 const f=flow({autoGenerateOnReply:false}),p=f.post("101");
 p.article.querySelector=s=>s==='[data-testid="quoteTweet"]'?{}:null;
 f.click(p);
 p.article.isConnected=false;
 f.document.activeElement=p.editor;
 f.entries([{node:p.editor,modal:true,contextMatches:null,contextStatusId:null,
   contextDetail:"awaiting_captioned_quote_parent"}]);
 f.timeout(800);await sleep(0);
 assert.equal(f.generations(),0);
 f.action("generate");await sleep(0);assert.equal(f.generations(),1);
 f.resolve(0);await sleep(0);
 assert.ok(f.statuses.includes("experimental_fill_available"));
 f.action("confirm-fill",{userGesture:false,style:"natural",reply:"中文 English 😀\nline"});
 assert.equal(f.commands(),0,"programmatic/inert confirmation never writes");
 f.action("confirm-fill",{userGesture:true,style:"natural",reply:"中文 English 😀\nline"});
 await sleep(115);
 assert.equal(f.commands(),1,"explicit user action inserts once");
 assert.equal(p.editor.innerText,"中文 English 😀\nline");
 f.action("confirm-fill",{userGesture:true,style:"natural",reply:"中文 English 😀\nline"});
 assert.equal(f.commands(),1,"cannot insert a second time");
 assert.equal(f.generations(),1,"no new AI request");
});
test("manual confirmed fill rejects another editor, wrong ID, drafted content and tab focus loss",async()=>{
 for(const mode of ["other_editor","wrong_id","draft","blur","wrong_payload"]){
   const f=flow({autoGenerateOnReply:false}),p=f.post("101");
   p.article.querySelector=s=>s==='[data-testid="quoteTweet"]'?{}:null;
   f.click(p);p.article.isConnected=false;f.document.activeElement=p.editor;
   f.entries([{node:p.editor,modal:true,contextMatches:null,contextStatusId:null,
     contextDetail:"awaiting_captioned_quote_parent"}]);
   f.timeout(800);await sleep(0);f.action("generate");await sleep(0);f.resolve(0);await sleep(0);
   if(mode==="other_editor")f.entries([{node:{...p.editor},modal:true,contextMatches:null,contextStatusId:null}]);
   if(mode==="wrong_id")f.entries([{node:p.editor,modal:true,contextMatches:false,contextStatusId:"999"}]);
   if(mode==="draft")p.editor.innerText="user draft";
   if(mode==="blur")f.document.hasFocus=()=>false;
   f.action("confirm-fill",{userGesture:true,style:"natural",reply:mode==="wrong_payload"?"other":"中文 English 😀\nline"});
   await sleep(0);
   assert.equal(f.commands(),0,mode);
 }
});
test("experimental insert control exists only with explicit user gesture and does not alter regular generate",()=>{
 const ui=readFileSync(new URL("../content/inline-assistant.js",import.meta.url),"utf8");
 assert.match(ui,/data-action="confirm-fill"/);
 assert.match(ui,/if\(!event\.isTrusted \|\| !candidates\.length/);
 assert.match(ui,/showExperimentalFill/);
});

test("captured quote auto-on Reply generates and inserts exactly once into its unique new composer",async()=>{
 const f=flow(),p=f.post("101");
 p.article.querySelector=s=>s==='[data-testid="quoteTweet"]'?{}:null;
 f.click(p);p.article.isConnected=false;f.document.activeElement=p.editor;
 f.entries([{node:p.editor,modal:true,contextMatches:null,contextStatusId:null,
   contextDetail:"awaiting_captioned_quote_parent"}]);
 f.timeout(800);
 await sleep(0);
 assert.equal(f.hosts.length,1);
 assert.equal(f.generations(),1,"auto-enabled quote starts exactly one AI generation");
 assert.equal(f.commands(),0,"no native insertion before AI result");
 f.resolve(0);
 await sleep(115);
 assert.equal(f.commands(),1,"AI response fills only the captured fresh composer");
 assert.equal(p.editor.innerText,'中文 English 😀\nline');
 assert.equal(f.generations(),1,"no repeat AI request");
 assert.ok(f.statuses.every(s=>!s.includes("无法准确匹配原帖和回复框")));
});
test("auto quote never inserts after user edits, editor replacement, wrong identity, focus loss or route change",async()=>{
 for(const mode of ["draft","replacement","wrong_id","blur","route"]){
   const f=flow(),p=f.post("101");
   p.article.querySelector=s=>s==='[data-testid="quoteTweet"]'?{}:null;
   f.click(p);p.article.isConnected=false;f.document.activeElement=p.editor;
   f.entries([{node:p.editor,modal:true,contextMatches:null,contextStatusId:null}]);
   f.timeout(800);await sleep(0);
   assert.equal(f.generations(),1,"one permitted request prior to invalidation");
   if(mode==="draft")p.editor.innerText="user draft";
   if(mode==="replacement")f.entries([{node:{...p.editor},modal:true,contextMatches:null,contextStatusId:null}]);
   if(mode==="wrong_id")f.entries([{node:p.editor,modal:true,contextMatches:false,contextStatusId:"999"}]);
   if(mode==="blur")f.document.hasFocus=()=>false;
   if(mode==="route")f.route("https://x.com/search");
   f.resolve(0);
   await sleep(115);
   assert.equal(f.commands(),0,mode);
 }
});
test("auto quote does not run for non-quote posts or when auto-generation is disabled",async()=>{
 const f=flow({autoGenerateOnReply:false}),p=f.post("101");
 p.article.querySelector=s=>s==='[data-testid="quoteTweet"]'?{}:null;
 f.click(p);p.article.isConnected=false;f.document.activeElement=p.editor;
 f.entries([{node:p.editor,modal:true,contextMatches:null,contextStatusId:null}]);
 f.timeout(800);await sleep(0);
 assert.equal(f.generations(),0);
 assert.equal(f.commands(),0);
});

test("fast quote path starts generation after stable editor checks without waiting for legacy 800ms",async()=>{
 const f=flow(),p=f.post("101");
 p.article.querySelector=s=>s==='[data-testid="quoteTweet"]'?{}:null;
 f.click(p);p.article.isConnected=false;f.document.activeElement=p.editor;
 f.entries([{node:p.editor,modal:true,contextMatches:null,contextStatusId:null,
   contextDetail:"awaiting_captioned_quote_parent"}]);
 f.timeout(360);await sleep(145);
 assert.equal(f.generations(),1,"AI request starts on stable 360ms+120ms path");
 assert.equal(f.commands(),0,"cannot insert until response");
 f.resolve(0);await sleep(112);
 assert.equal(f.commands(),1);
 f.timeout(800);await sleep(0);
 assert.equal(f.generations(),1,"legacy backup never duplicates generation");
});
test("quote early candidate missing retains original 800ms fallback and exactly once insertion",async()=>{
 const f=flow(),p=f.post("101");
 p.article.querySelector=s=>s==='[data-testid="quoteTweet"]'?{}:null;
 f.click(p);p.article.isConnected=false;
 f.timeout(360);await sleep(0);
 assert.equal(f.generations(),0);
 f.document.activeElement=p.editor;
 f.entries([{node:p.editor,modal:true,contextMatches:null,contextStatusId:null}]);
 f.timeout(800);await sleep(0);
 assert.equal(f.generations(),1);
 f.resolve(0);await sleep(112);
 assert.equal(f.commands(),1);
});
test("burst DOM mutations coalesce to a single editor-association scan without delaying focus",async()=>{
 const f=flow(),p=f.post("101");
 f.click(p);f.open(p);await sleep(0);
 const before=f.snapshotCalls();
 for(let i=0;i<12;i++)f.mutate();
 await sleep(0);
 assert.equal(f.snapshotCalls(),before+1,"one scan across 12 synchronous mutation batches");
});
test("successful auto quote produces a success timing sample rather than incomplete",async()=>{
 const f=flow({performanceTracing:true}),p=f.post("101");
 await sleep(0);
 p.article.querySelector=s=>s==='[data-testid="quoteTweet"]'?{}:null;
 f.time(100);f.click(p);
 p.article.isConnected=false;f.document.activeElement=p.editor;
 f.entries([{node:p.editor,modal:true,contextMatches:null,contextStatusId:null}]);
 f.time(460);f.timeout(360);await sleep(145);
 assert.equal(f.generations(),1);
 f.time(650);f.resolve(0);await sleep(115);
 assert.equal(f.commands(),1);
 const report=f.perfReport();
 assert.equal(report.outcomes.success,1,JSON.stringify(report));
 assert.equal(report.outcomes.incomplete||0,0);
 assert.ok(report.metrics.reply_to_bind.p50>=360);
 assert.ok(report.metrics.elapsedMs.p50>=550);
});
