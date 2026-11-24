(() => {
  const api=globalThis.ZaneReplyCopilotContent ||= {};
  const STANDARD='[contenteditable="true"][role="textbox"],[data-testid="tweetTextarea_0"][contenteditable="true"]';
  const EDITABLE='[contenteditable]:not([contenteditable="false"]),textarea,[role="textbox"]';
  const CONTROL='button,[role="button"],a';
  const tags=new Set(['button','a','div','span','svg','path','article','section','main','dialog','textarea','input','p','g','use']);
  const roles=new Set(['button','link','group','dialog','textbox','article','presentation','menu','menuitem','region','main','none']);
  const testids=new Set(['reply','tweet','tweetText','tweetTextarea_0','tweetTextarea_1','tweetButton','tweetButtonInline','User-Name','cellInnerDiv','primaryColumn','layers','sheetDialog','confirmationSheetDialog','toolBar','tweetPhoto','videoPlayer','videoComponent','quoteTweet','card.wrapper','like','retweet','unretweet','unlike','bookmark','caret']);
  const actions=new Set(['reply','retweet','like','bookmark','share','generic']);
  const slots=new Set(['embedded-tweet-frame']);
  const MODERN_WRAPPER='div[role="link"][data-href]';
  const MODERN_BODY='div[dir="auto"].whitespace-pre-wrap';
  const CANONICAL='a[aria-hidden="true"][href*="/status/"]';
  const QUOTE_FRAME='[data-slot="embedded-tweet-frame"]';
  const PORTAL='[data-base-ui-portal]';
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
      editable:node.isContentEditable===true,
      engagementAction:kind(actions,attr(node,'data-engagement-action')),
      slot:kind(slots,attr(node,'data-slot')),
      permalinkWrapper:node.matches?.(MODERN_WRAPPER)===true,
      baseUiPortal:node.hasAttribute?.('data-base-ui-portal')===true,
      readOnly:node.localName==='textarea'?node.readOnly===true:null,
      disabled:node.localName==='textarea'?node.disabled===true:null,
      insideInert:Boolean(near(node,'[inert]'))};
  }
  // Structural evidence is deliberately data-free. Only fixed semantic
  // flags, enums, bounded counts and tree-local parent indexes are retained.
  // No arbitrary class/attribute names, values, DOM text, IDs, URL strings,
  // exact coordinates, input contents or selection contents.
  const STRUCT_ATTRS=['data-testid','data-engagement-action','data-slot','data-href','data-base-ui-portal','data-post-avatar','data-state','data-app-version','data-open','data-disabled','aria-label','aria-labelledby','aria-describedby','aria-modal','aria-hidden','aria-controls','aria-expanded','aria-pressed','aria-disabled','role','href','contenteditable','tabindex','dir','type','name','id','class','placeholder','disabled','readonly','required','maxlength','hidden','inert','autocomplete','form','open','data-lexical-editor','data-slate-editor','data-placeholder','data-focus-guard'];
  const STRUCT_CLASSES=['group/post','whitespace-pre-wrap','x-middot-group','sr-only','flex','grid','relative','absolute','fixed','overflow-hidden','overflow-auto','pointer-events-none','ProseMirror','DraftEditor-root','public-DraftEditor-content'];
  function linkKind(raw){
    if(!raw)return 'none';
    if(raw.startsWith('#'))return 'fragment';
    try{
      const u=new URL(raw,document.baseURI||location.href);
      if(u.protocol!=='https:')return 'other';
      if(!['x.com','twitter.com','www.x.com','www.twitter.com'].includes(u.hostname))return 'external';
      if(/^\/[^/]+\/status\/\d+\/?$/.test(u.pathname))return 'status';
      if(/^\/[^/]+\/status\/\d+\/(?:photo|video)(?:\/|$)/.test(u.pathname))return 'status_media';
      if(u.pathname.startsWith('/compose/'))return 'compose';
      if(/^\/[^/]+\/?$/.test(u.pathname))return 'single_segment';
      return 'x_other';
    }catch{return 'other';}
  }
  function labelKind(node){
    // Exact or coarse semantic categories only, never export the label.
    const label=attr(node,'aria-label').normalize('NFKC').trim().toLowerCase();
    if(!label)return 'none';
    if(/^(reply|回复|回覆|返信|답글|responder|répondre|antworten)$/.test(label))return 'reply';
    if(/^(replying to|回复给|回复对象)(?:\s|[:：]|$)/.test(label))return 'reply_context';
    if(/^(reply|回复)\s+\d/.test(label)||/^\d[\d,.]*\s+repl(?:y|ies)(?:\b|$)/.test(label))return 'reply_count';
    if(/^(post|tweet|发布|发帖|ポスト)$/.test(label))return 'post';
    if(/^(close|关闭|cancel|取消)$/.test(label))return 'close';
    if(/^(search|搜索|検索)$/.test(label))return 'search';
    return 'other';
  }
  function structuralNode(node,parentIndex){
    const d=describe(node);
    return {parentIndex,tag:d.tag,role:d.role,testId:d.testId,engagementAction:d.engagementAction,slot:d.slot,
      flags:STRUCT_ATTRS.filter(k=>node.hasAttribute?.(k)),
      classes:STRUCT_CLASSES.filter(k=>node.classList?.contains(k)),
      labelKind:labelKind(node),hrefKind:linkKind(attr(node,'href')),dataHrefKind:linkKind(attr(node,'data-href')),
      childCount:Math.min(100,node.children?.length||0),
      otherAttributeCount:Math.min(100,Math.max(0,(node.attributes?.length||0)-STRUCT_ATTRS.filter(k=>node.hasAttribute?.(k)).length)),
      classCount:Math.min(100,node.classList?.length||0),
      editable:d.editable,focused:node===document.activeElement,
      openShadow:Boolean(node.shadowRoot),
      hasTextChild:Array.from(node.childNodes||[]).slice(0,30).some(x=>x.nodeType===3&&Boolean(x.nodeValue?.trim())),
      insideInert:d.insideInert};
  }
  function structureTree(root){
    if(!root||root.nodeType!==1)return null;
    const result=[],queue=[{node:root,parentIndex:null,depth:0}];
    let truncated=false;
    for(let i=0;i<queue.length&&result.length<48;i++){
      const {node,parentIndex,depth}=queue[i],index=result.length;
      result.push(structuralNode(node,parentIndex));
      const children=node.children||[];
      if(depth>=7){if(children.length)truncated=true;continue;}
      for(const child of children){
        if(queue.length>=48){truncated=true;break;}
        queue.push({node:child,parentIndex:index,depth:depth+1});
      }
    }
    return {nodes:result,truncated};
  }
  function ancestry(node,max=12){
    const out=[];
    for(let x=node;x&&x.nodeType===1&&out.length<max;x=x.parentElement||x.getRootNode?.().host||null)
      out.push(structuralNode(x,null));
    return out;
  }
  function detailSnapshot(){
    const dialogs=nodes(document,'[role="dialog"],dialog[open]').filter(vis).slice(0,2);
    const focus=document.activeElement;
    const focused=focus?.nodeType===1&&focus!==document.body?focus:null;
    return {dialogTrees:dialogs.map(structureTree),focusPath:ancestry(focused),
      // Only a representative editor/ancestor, not the entire feed or page.
      editorPaths:nodes(document,EDITABLE).filter(vis).slice(0,3).map(e=>ancestry(e,8))};
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
    const modern=Boolean(article&&api.postExtractor?.isModernPost?.(article));
    const evidence=modern?api.postExtractor?.modernIdentityEvidence?.(article):null;
    return {article:Boolean(article),tweetContainer:Boolean(tweet),
      textNodes:n(root,'[data-testid="tweetText"]'),timeNodes:n(root,'time'),
      statusLinks:n(root,'a[href*="/status/"]'),mediaNodes:n(root,'[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="videoComponent"]'),
      modernAdapter:modern,modernIdentityConflict:evidence?.conflict===true,
      modernWrapperPresent:Boolean(near(article,MODERN_WRAPPER)),
      modernBodyNodes:n(root,MODERN_BODY),modernCanonicalLinks:n(root,CANONICAL),
      modernQuoteFrames:n(root,QUOTE_FRAME),
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
    const source=recognized||nearest||target;
    const root=near(source,MODERN_WRAPPER)||near(source,'article')||source?.parentElement;
    const composed=typeof event?.composedPath==='function'?event.composedPath():[];
    const path=composed.filter(x=>x?.nodeType===1).slice(0,12).map(x=>structuralNode(x,null));
    return {target:describe(target),nearestControl:describe(nearest),ancestors,
      rule:recognized?(attr(recognized,'data-testid')==='reply'?'testid':attr(recognized,'data-engagement-action')==='reply'?'engagement':'label'):'unrecognized',
      replyTestIdAncestor:Boolean(testIdNode),outerRecognized,
      insideDialog:Boolean(near(target,'[role="dialog"],dialog')),
      post:postShape(source),controlPath:ancestry(source),composedPath:path,
      postTree:structureTree(root)};
  }
  // Fixed selector counts only: no URLs, hash/version strings, raw HTML,
  // script source, arbitrary attribute values or post/editor text exported.
  function modernBundlePresent(){
    for(const node of nodes(document,'script[src]')){
      try{
        const url=new URL(node.getAttribute('src'),location.href);
        if(url.protocol==='https:'&&url.hostname==='abs.twimg.com'&&
          url.pathname.startsWith('/x-web/x-web/entry-client-'))return true;
      }catch{}
    }
    return false;
  }
  function dialogShapes(){
    return nodes(document,'[role="dialog"],dialog[open]').filter(vis).slice(0,3).map(d=>({
      node:describe(d),ariaModal:attr(d,'aria-modal')==='true',
      insideBaseUiPortal:Boolean(near(d,PORTAL)),
      articles:n(d,'article'),modernBodyNodes:n(d,MODERN_BODY),
      modernWrappers:n(d,MODERN_WRAPPER),modernCanonicalLinks:n(d,CANONICAL),
      modernQuoteFrames:n(d,QUOTE_FRAME),
      legacyBodyNodes:n(d,'[data-testid="tweetText"]'),
      standardEditors:nv(d,STANDARD),textareaEditors:nv(d,'textarea'),
      editors:nv(d,EDITABLE),focusedInside:d.contains(document.activeElement)
    }));
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
      modernAppMarker:Boolean(document.documentElement?.hasAttribute?.('data-app-version')),
      modernReplyControls:n(document,'[data-engagement-action="reply"]'),textareaCandidates:nv(document,'textarea'),
      modernBundlePresent:modernBundlePresent(),modernPostWrappers:n(document,MODERN_WRAPPER),
      modernBodyNodes:n(document,MODERN_BODY),modernCanonicalLinks:n(document,CANONICAL),
      modernQuoteFrames:n(document,QUOTE_FRAME),baseUiPortals:n(document,PORTAL),
      legacyBodyNodes:n(document,'[data-testid="tweetText"]'),
      dialogTextareaCandidates:nv(document,'[role="dialog"] textarea,dialog[open] textarea'),
      dialogs:dialogShapes(),
      documentFocused:document.hasFocus?.()===true,
      pageVisible:document.visibilityState==='visible',
      readyState:['loading','interactive','complete'].includes(document.readyState)?document.readyState:'unknown',
      hasReplyRouteParameter:(()=>{try{return new URL(location.href).searchParams.has('in_reply_to');}catch{return false;}})(),
      forms:n(document,'form'),openShadowHosts:nodes(document,'article, [role="dialog"], dialog[open]').filter(x=>Boolean(x.shadowRoot)).length,
      translateMarkers:n(document,'.immersive-translate-translation,.immersive-translate-target-translation-block-wrapper,.immersive-translate-target-translation-inline-wrapper,[data-immersive-translate-translation]'),
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
    function sample(label,force=false){
      if(!run||(run.finished&&!force))return;
      try{run.samples.push({label,atMs:age(),...snapshot()});}catch{run.sampleErrors++;}
    }
    function detail(label){
      if(!run||run.details.length>=3)return;
      try{run.details.push({label,atMs:age(),...detailSnapshot()});}catch{run.sampleErrors++;}
    }
    function start(id){
      reset();run={id,startedAt:null,gesture:null,click:null,marks:[],samples:[],details:[],facts:[],timers:[],sampleErrors:0,finished:false,gestureTarget:null,clickRelation:null,additionalClicks:0,marksTruncated:false,factsTruncated:false};
      run.timers.push(later(reset,90000));sample('armed');return true;
    }
    function gesture(event,phase){
      if(!run||run.finished||!event.isTrusted||near(event.target,'[data-zane-reply-copilot]'))return;
      if(phase==='activation'&&event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
      if(run.startedAt===null){
        run.startedAt=now();run.gestureTarget=event.target;
        try{run.gesture=gestureShape(event.target,event);}catch{run.sampleErrors++;}
        sample('before');
        for(const [ms,label] of [[0,'after_click'],[300,'300ms'],[1500,'1500ms'],[4500,'4500ms'],[9500,'9500ms'],[12000,'12000ms'],[20000,'20000ms'],[30000,'30000ms']]){
          run.timers.push(later(()=>{sample(label);if(ms===300||ms===1500)detail(label);
            if(ms===30000&&run)run.finished=true;},ms));
        }
      }
      if(phase==='click'){
        if(!run.click&&age()<=2000){
          try{
            const first=run.gestureTarget,current=event.target;
            const a=near(first,'article'),b=near(current,'article');
            const c=near(first,CONTROL),d=near(current,CONTROL);
            run.clickRelation={sameNode:first===current,sameArticle:Boolean(a&&a===b),sameControl:Boolean(c&&c===d)};
            run.click=gestureShape(current,event);
          }catch{run.sampleErrors++;}
          finally{run.gestureTarget=null;}
        }else run.additionalClicks=Math.min(100,run.additionalClicks+1);
      }
    }
    function mark(stage,reason){
      if(!run||run.startedAt===null||run.finished)return;
      if(run.marks.length>=64){run.marksTruncated=true;return;}
      const previous=run.marks.at(-1);
      if(previous?.stage===stage&&previous?.reason===reason)return;
      run.marks.push({stage,reason,atMs:age()});
    }
    function facts(value){
      if(!run||run.startedAt===null||run.finished)return;
      if(run.facts.length>=20){run.factsTruncated=true;return;}
      const f={routeAllowed:value.routeAllowed===true,sourceUnchanged:value.sourceUnchanged===true,
        candidates:Math.min(100,value.editors.length),dialogs:Math.min(100,value.visibleDialogCount),
        editors:value.editors.slice(0,5).map(e=>({modal:e.modal===true,focused:e.focused===true,empty:e.empty===true,
          editor:describe(e.node),
          contextDetail:e.contextDetail,
          contextIdentityPresent:Boolean(e.contextStatusId),contextArticleCount:Math.min(100,e.contextArticleCount||0),
          contextTextPresent:e.contextTextPresent===true,contextTextMatches:e.contextTextMatches===true,
          contextMatches:e.contextMatches===null?'pending':e.contextMatches===true?'match':'mismatch'}))};
      if(JSON.stringify(run.facts.at(-1)?.value)===JSON.stringify(f))return;
      run.facts.push({atMs:age(),value:f});
    }
    function finish(id){
      if(!run||run.id!==id)return {state:'lost'};
      if(run.startedAt!==null&&!run.finished&&age()<12000)return {state:'recording'};
      if(run.startedAt!==null){sample('finish',true);detail('finish');}
      const report={state:run.startedAt===null?'no_click':'complete',gesture:run.gesture,click:run.click,
        samples:run.samples,details:run.details,marks:run.marks,facts:run.facts,sampleErrors:run.sampleErrors,
        clickCaptured:Boolean(run.click),clickRelation:run.clickRelation,additionalClicks:run.additionalClicks,
        marksTruncated:run.marksTruncated,factsTruncated:run.factsTruncated,recordedMs:age()};
      reset();return report;
    }
    return {start,gesture,mark,facts,finish,cancel(id){if(run?.id===id)reset();},reset};
  }
  api.layoutDiagnostics={layout,render,gestureShape,createRecorder};
})();
