(() => {
  const api=globalThis.ZaneReplyCopilotContent ||= {};
  const STANDARD='[contenteditable="true"][role="textbox"],[data-testid="tweetTextarea_0"][contenteditable="true"]';
  const EDITABLE='[contenteditable]:not([contenteditable="false"]),textarea,[role="textbox"]';
  const CONTROL='button,[role="button"],a';
  const tags=new Set(['button','a','div','span','svg','path','article','section','main','dialog','textarea','input','p','g','use']);
  const roles=new Set(['button','link','group','dialog','textbox','article','presentation','menu','menuitem','region','main','none']);
  const testids=new Set(['reply','tweet','tweetText','tweetTextarea_0','tweetTextarea_1','tweetButton','tweetButtonInline','User-Name','cellInnerDiv','primaryColumn','layers','sheetDialog','confirmationSheetDialog','toolBar','tweetPhoto','videoPlayer','videoComponent','quoteTweet','card.wrapper','like','retweet','unretweet','unlike','bookmark','caret']);
  const languages=new Set(['zh','en','ja','ko','es','fr','de','it','pt','ru','ar','id','vi','th','tr','hi','pl','nl','uk']);
  const attr=(node,key)=>node?.getAttribute?.(key)||'';
  const kind=(set,v)=>!v?'none':set.has(v)?v:'other';
  const nodes=(root,selector)=>Array.from(root?.querySelectorAll?.(selector)||[]).slice(0,100);
  const n=(root,selector)=>Math.min(100,root?.querySelectorAll?.(selector)?.length||0);
  const vis=node=>Boolean(node?.isConnected&&!node.closest?.('[aria-hidden="true"],[hidden]')&&node.getClientRects?.().length&&getComputedStyle(node).visibility!=='hidden');
  const nv=(root,selector)=>nodes(root,selector).filter(vis).length;
  const near=(node,selector)=>node?.closest?.(selector)||null;
  function describe(node){
    if(!node)return null;
    return {tag:kind(tags,String(node.localName||'').toLowerCase()),role:kind(roles,attr(node,'role')),
      testId:kind(testids,attr(node,'data-testid')),ariaLabelPresent:Boolean(attr(node,'aria-label')),
      editable:node.isContentEditable===true};
  }
  function route(){
    const p=location.pathname;
    if(p==='/home'||p==='/')return 'home';
    if(/^\/[^/]+\/status\/\d+\/(?:photo|video)(?:\/|$)/.test(p))return 'media';
    if(/^\/[^/]+\/status\/\d+(?:\/|$)/.test(p))return 'post_detail';
    if(p==='/search')return 'search';
    if(p.startsWith('/compose/'))return 'compose';
    if(/^\/[^/]+\/?$/.test(p)&&!['/explore','/notifications','/messages','/settings','/i'].includes(p))return 'profile';
    return 'other';
  }
  function postShape(node){
    const article=near(node,'article'),tweet=near(node,'[data-testid="tweet"]');
    const root=article||tweet;
    const extracted=article&&api.postExtractor?.extractPost?.(article);
    return {article:Boolean(article),tweetContainer:Boolean(tweet),
      textNodes:n(root,'[data-testid="tweetText"]'),timeNodes:n(root,'time'),
      statusLinks:n(root,'a[href*="/status/"]'),mediaNodes:n(root,'[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="videoComponent"]'),
      identityVerified:Boolean(article&&api.postExtractor?.postIdentity?.(article)),
      mainTextPresent:Boolean(article&&api.postExtractor?.postText?.(article)),quoteTextPresent:Boolean(extracted?.ok&&extracted.quoteOnly&&extracted.quotedText)};
  }
  function gestureShape(target,event){
    const nearest=near(target,CONTROL),recognized=api.replyDetector?.findReplyControl?.(target,event);
    const ancestors=[];let outerRecognized=false;
    for(let x=target;x&&ancestors.length<8;x=x.parentElement){
      ancestors.push(describe(x));
      if(x!==nearest&&api.replyDetector?.isReplyControl?.(x))outerRecognized=true;
    }
    const testIdNode=near(target,'[data-testid="reply"]');
    return {target:describe(target),nearestControl:describe(nearest),ancestors,
      rule:recognized?(attr(recognized,'data-testid')==='reply'?'testid':'label'):'unrecognized',
      replyTestIdAncestor:Boolean(testIdNode),outerRecognized,
      insideDialog:Boolean(near(target,'[role="dialog"],dialog')),
      post:postShape(recognized||nearest||target)};
  }
  function layout(){
    const editors=nodes(document,EDITABLE).filter(vis);
    const active=document.activeElement;
    const lang=(document.documentElement?.lang||'').split(/[-_]/)[0].toLowerCase();
    const focus=editors.find(x=>x===active||x.contains?.(active));
    return {pageType:route(),language:languages.has(lang)?lang:'other',
      viewportWidth:Math.min(10000,Math.round(innerWidth/100)*100),viewportHeight:Math.min(10000,Math.round(innerHeight/100)*100),
      articles:n(document,'article'),tweetContainers:n(document,'[data-testid="tweet"]'),
      standardReplyControls:n(document,'[data-testid="reply"]'),standardEditors:nv(document,STANDARD),
      roleDialogs:nv(document,'[role="dialog"]'),nativeDialogs:nv(document,'dialog[open]'),
      editableCandidates:editors.length,inlineCandidates:editors.filter(x=>!near(x,'[role="dialog"],dialog')).length,
      nonstandardCandidates:editors.filter(x=>!x.matches(STANDARD)).length,
      dialogStandardEditors:editors.filter(x=>x.matches(STANDARD)&&near(x,'[role="dialog"]')).length,
      focusedEditor:describe(focus),focusedInsideDialog:Boolean(focus&&near(focus,'[role="dialog"],dialog')),
      candidates:editors.slice(0,5).map(x=>({node:describe(x),standard:x.matches(STANDARD),insideRoleDialog:Boolean(near(x,'[role="dialog"]')),insideNativeDialog:Boolean(near(x,'dialog')),focused:x===active||x.contains?.(active)===true}))};
  }
  function render(host,source){
    const present=Boolean(host?.isConnected);
    if(!present)return {source:'none',connected:false};
    const r=host.getBoundingClientRect(),s=getComputedStyle(host),panel=host.shadowRoot?.querySelector('.panel');
    const left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
    const intersects=right>left&&bottom>top;
    let covered=null;
    if(intersects&&s.display!=='none'&&s.visibility!=='hidden'){
      const points=[[.2,.2],[.5,.5],[.8,.2],[.2,.8],[.8,.8]];
      let hits=0,checks=0;
      for(const [x,y] of points){const hit=document.elementFromPoint(left+(right-left)*x,top+(bottom-top)*y);if(hit){checks++;if(hit===host||host.contains(hit)||hit.getRootNode?.().host===host)hits++;}}
      if(checks)covered=hits===0?'all':hits===checks?'none':'partial';
    }
    const styles=host.shadowRoot?.querySelectorAll('link[rel="stylesheet"]')||[];
    return {source,connected:true,intersectsViewport:intersects,displayHidden:s.display==='none',visibilityHidden:s.visibility==='hidden'||s.visibility==='collapse',
      transparent:Number(s.opacity)===0,collapsed:panel?.classList.contains('collapsed')===true,panelPresent:Boolean(panel),
      stylesheetCount:Math.min(4,styles.length),stylesheetsLoaded:Array.from(styles).filter(x=>Boolean(x.sheet)).length,
      occlusion:covered||'unknown',width:Math.min(10000,Math.round(r.width)),height:Math.min(10000,Math.round(r.height))};
  }
  // No observation until an explicit side-panel arm. No document text, raw attributes,
  // URL, post/account IDs, screenshots, keystrokes, coordinates or raw errors retained.
  function createRecorder(snapshot,{now=()=>performance.now(),later=setTimeout,clear=clearTimeout}={}){
    let run=null;
    const age=()=>run?.startedAt==null?0:Math.min(60000,Math.max(0,Math.round(now()-run.startedAt)));
    function reset(){if(run){for(const t of run.timers)clear(t);run=null;}}
    function sample(label){if(!run||run.finished)return;try{run.samples.push({label,atMs:age(),...snapshot()});}catch{run.sampleErrors++;}}
    function start(id){
      reset();run={id,startedAt:null,gesture:null,click:null,marks:[],samples:[],facts:[],timers:[],sampleErrors:0,finished:false};
      run.timers.push(later(reset,90000));sample('armed');return true;
    }
    function gesture(event,phase){
      if(!run||run.finished||!event.isTrusted||near(event.target,'[data-zane-reply-copilot]'))return;
      if(phase==='activation'&&event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
      if(run.startedAt===null){
        run.startedAt=now();try{run.gesture=gestureShape(event.target,event);}catch{run.sampleErrors++;}
        sample('before');
        for(const [ms,label] of [[0,'after_click'],[300,'300ms'],[1500,'1500ms'],[4500,'4500ms'],[9500,'9500ms'],[12000,'12000ms']]){
          run.timers.push(later(()=>{sample(label);if(ms===12000&&run)run.finished=true;},ms));
        }
      }
      if(phase==='click'&&!run.click&&age()<=2000){try{run.click=gestureShape(event.target,event);}catch{run.sampleErrors++;}}
    }
    function mark(stage,reason){
      if(!run||run.startedAt===null||run.finished||run.marks.length>=40)return;
      const previous=run.marks.at(-1);
      if(previous?.stage===stage&&previous?.reason===reason)return;
      run.marks.push({stage,reason,atMs:age()});
    }
    function facts(value){
      if(!run||run.startedAt===null||run.finished||run.facts.length>=12)return;
      const f={routeAllowed:value.routeAllowed===true,sourceUnchanged:value.sourceUnchanged===true,
        candidates:Math.min(100,value.editors.length),dialogs:Math.min(100,value.visibleDialogCount),
        editors:value.editors.slice(0,5).map(e=>({modal:e.modal===true,focused:e.focused===true,empty:e.empty===true,
          contextIdentityPresent:Boolean(e.contextStatusId),contextArticleCount:Math.min(100,e.contextArticleCount||0),
          contextTextPresent:e.contextTextPresent===true,contextTextMatches:e.contextTextMatches===true,
          contextMatches:e.contextMatches===null?'pending':e.contextMatches===true?'match':'mismatch'}))};
      if(JSON.stringify(run.facts.at(-1)?.value)===JSON.stringify(f))return;
      run.facts.push({atMs:age(),value:f});
    }
    function finish(id){
      if(!run||run.id!==id)return {state:'lost'};
      if(run.startedAt!==null&&!run.finished&&age()<12000)return {state:'recording'};
      const report={state:run.startedAt===null?'no_click':'complete',gesture:run.gesture,click:run.click,
        samples:run.samples,marks:run.marks,facts:run.facts,sampleErrors:run.sampleErrors};
      reset();return report;
    }
    return {start,gesture,mark,facts,finish,cancel(id){if(run?.id===id)reset();},reset};
  }
  api.layoutDiagnostics={layout,render,gestureShape,createRecorder};
})();
