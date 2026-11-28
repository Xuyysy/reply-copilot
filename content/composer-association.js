(() => {
  // All references and post identities stay in this content script's isolated world.
  function create({trusted,statusId,requestId,now,baselineModalCount,baselineEditors}) {
    const startedAt=now, previousEditors=new Set(baselineEditors);
    let state='waiting',reason='awaiting_new_editor',editor=null,boundDialog=null;
    function reject(why) {state='rejected';reason=why;editor=null;return result();}
    function result() {return {state,reason,editor};}
    if (!trusted) reject('untrusted_activation');
    else if (!/^\d+$/.test(statusId||'') || !requestId || !Number.isFinite(now)) reject('source_unverified');
    else if (baselineModalCount!==0) reject('preexisting_modal');
    return Object.freeze({statusId,requestId,interrupt:reject,evaluate(f) {
      if (state==='rejected') return result();
      if (!Number.isFinite(f.now)||f.now<startedAt) return reject('clock_invalid');
      if (f.now-startedAt>(state==='bound'?60000:9000)) return reject(state==='bound'?'operation_expired':'association_expired');
      if (!f.routeAllowed) return reject('route_changed');
      if (!f.sourceUnchanged) return reject('source_changed');
      const nodes=new Map();
      for (const candidate of f.editors) nodes.set(candidate.node,candidate);
      const candidates=[...nodes.values()];
      if (candidates.length>1) return reject('multiple_editors');
      if (state==='bound') {
        // React may briefly unmount the editor while mounting media/quote
        // attachments. The surrounding dialog can also disappear for a
        // frame. Wait for the caller's short close-grace check instead of
        // treating one empty snapshot as a permanent user cancellation.
        if (!candidates.length) {
          reason='awaiting_editor_remount';
          return {state,reason,editor:null};
        }
        const candidate=candidates[0];
        if (candidate.contextStatusId && candidate.contextStatusId!==statusId) return reject('context_identity_conflict');
        if (candidate.quarantinedContextMatch && candidate.contextStatusId!==statusId) return reject('stale_activation_ambiguous');
        if (candidate.contextMatches===null) {
          reason='awaiting_reply_context';
          return {state,reason,editor:null};
        }
        if (!candidate.contextMatches) return reject('reply_context_unconfirmed');
        if (candidate.node!==editor) {
          // A new *focused, empty* editor is safe to rebind only when it is
          // the same reply dialog or has the exact verified target status ID.
          // Never revive a pre-existing editor, carry a user's draft across,
          // or follow a different post.
          const sameDialog=Boolean(boundDialog && candidate.dialog===boundDialog);
          const verifiedId=candidate.contextStatusId===statusId;
          if (!candidate.modal || !candidate.empty ||
              previousEditors.has(candidate.node) || (!sameDialog && !verifiedId) ||
              (editor?.isConnected && globalThis.ZaneReplyCopilotContent?.composerAdapter?.hasContent?.(editor)))
            return reject('editor_replaced_or_closed');
          // The new editor can appear before it receives keyboard focus.
          // Wait for focusin just like initial binding, without switching
          // insertion targets or triggering another generation meanwhile.
          if(!candidate.focused){
            reason='awaiting_editor_focus';
            return {state,reason,editor:null};
          }
          editor=candidate.node;
          boundDialog=candidate.dialog||null;
          reason='verified_editor_remount';
          return result();
        }
        return result();
      }
      if (!candidates.length) return result();
      const candidate=candidates[0];
      if (previousEditors.has(candidate.node)) return reject('preexisting_editor');
      if (!candidate.modal) return reject('not_reply_modal');
      if (candidate.contextStatusId && candidate.contextStatusId!==statusId) return reject('context_identity_conflict');
      if (candidate.quarantinedContextMatch && candidate.contextStatusId!==statusId) return reject('stale_activation_ambiguous');
      if (candidate.contextMatches===null) {reason='awaiting_reply_context';return result();}
      if (!candidate.contextMatches) return reject('reply_context_unconfirmed');
      if (!candidate.empty) return reject('existing_draft');
      if (!candidate.focused) {reason='awaiting_editor_focus';return result();}
      state='bound';reason='new_focused_reply_editor';editor=candidate.node;boundDialog=candidate.dialog||null;
      return result();
    }});
  }
  globalThis.ZaneReplyCopilotContent ||= {};
  const editorSelector='[contenteditable="true"][role="textbox"], [data-testid="tweetTextarea_0"][contenteditable="true"]';
  function visible(node) {
    return Boolean(node?.isConnected && !node.closest('[aria-hidden="true"], [hidden]') && node.getClientRects().length && getComputedStyle(node).visibility!=='hidden');
  }
  const modernEditorSelector=editorSelector+',textarea';
  // The timeline and composer can roll out independently. A legacy post
  // may use a native XDS editor only with an independently verified reply
  // anchor and positive structural evidence; never widen legacy textboxes.
  function hybridNativeEditor(node) {
    if(node?.localName!=='textarea')return false;
    const dialog=node.closest?.('[role="dialog"]');
    const form=node?.closest?.('form');
    return Boolean(dialog?.matches?.('[data-slot="xds-modal-surface"]')&&
      form&&dialog.contains(form)&&form.closest('[data-media-upload-dropzone]')&&
      dialog.contains(form.closest('[data-media-upload-dropzone]')));
  }
  function selectorFor(doc,post) {
    return (post?post.modernLayout===true||post.replyRouteVerified===true:globalThis.ZaneReplyCopilotContent.postExtractor?.modernPage?.(doc))?modernEditorSelector:editorSelector;
  }
  function eligibleEditor(node,post){
    return (!post||post.modernLayout||node.localName!=='textarea'||(post.replyRouteVerified&&hybridNativeEditor(node)))&&visible(node);
  }
  function baseline(document,post) {
    const selector=selectorFor(document,post);
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const editors=[...document.querySelectorAll(selector)];
    // Media viewers and non-composer overlays are not existing reply
    // dialogs. Only a dialog with a visible editable target blocks a fresh
    // verified Reply click.
    const visibleEditors=editors.filter(node=>eligibleEditor(node,post));
    const composerDialogs=dialogs.filter(dialog=>visibleEditors.some(node=>dialog.contains(node)));
    return {baselineModalCount:composerDialogs.length,visibleEditorCount:visibleEditors.length,
      visibleReplyEditorCount:visibleEditors.filter(node=>node.closest('[role="dialog"]')).length,
      baselineEditors:editors};
  }
  function contextId(article,modernLayout=false,detailReference=null,expectedDetailId=null) {
    // Canonical ID from the author's timestamp, never a random quote link.
    const extractor=globalThis.ZaneReplyCopilotContent.postExtractor;
    if(detailReference){
      // The recovered source uses the same canonical modal ID as the
      // ordinary legacy path. Additional owned evidence rejects conflicts;
      // it must not discard a normal independently verified permalink.
      const evidence=extractor.legacyDetailEvidence(article,detailReference);
      if(evidence.conflict||(evidence.otherCanonicalId&&evidence.otherCanonicalId!==expectedDetailId))
        return 'conflicting_status_links';
      if(evidence.statusId)return evidence.statusId;
      // A lone arbitrary link is not an independently verified permalink.
      if(evidence.otherCanonicalId)return null;
      const ordinary=extractor.postIdentity?.(article);
      return ordinary?.statusId||null;
    }
    if(modernLayout||extractor.isModernPost?.(article)){
      const evidence=extractor.modernIdentityEvidence(article);
      return evidence.identity?.statusId||(evidence.conflict?'conflicting_status_links':null);
    }
    const identity=extractor.postIdentity?.(article);
    if (identity?.statusId) return identity.statusId;
    // Preserve fail-closed behavior for a modal with conflicting post links.
    // An unknown parent can use verified text; conflicting IDs cannot.
    const ids=new Set();
    for(const anchor of article?.querySelectorAll?.('a[href*="/status/"]')||[]) {
      if(anchor.closest?.('article')!==article || extractor.isQuoteContent?.(anchor,article)||extractor.legacyIdentityContent?.(anchor))continue;
      try{
        const url=new URL(anchor.href);
        const match=url.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/);
        if(url.protocol==='https:' && /^(?:www\.)?(?:x\.com|twitter\.com)$/.test(url.hostname) && match)ids.add(match[1]);
      }catch{}
    }
    return ids.size>1?'conflicting_status_links':null;
  }
  const normalized=text=>(text||'').replace(/\s+/g,' ').trim();
  // Exclude embedded quote nodes consistently from modal parent candidates.
  // Read-only DOM inspection, never a guessed reply-target ID.
  function inQuotedCard(node) {
    if(node?.closest?.('[data-testid="quoteTweet"], [data-testid="card.wrapper"]'))return true;
    const card=node?.closest?.('div[role="link"]');
    return Boolean(card?.querySelector?.('[data-testid="User-Name"]') &&
      card?.querySelector?.('[data-testid="tweetText"]'));
  }
  function capturePost(post,initialUrl=globalThis.location?.href,timelinePreview=null) {
    // Captioned quotes require extra hydration patience, ordinary posts do not.
    // Discover the quote only on the trusted capture, not on every modal scan.
    const markedQuote=Boolean(post.article?.querySelector?.('[data-testid="quoteTweet"]'));
    const roleLinkQuote=!markedQuote&&[...(post.article?.querySelectorAll?.('div[role="link"]')||[])]
      .some(card=>card.querySelector?.('[data-testid="User-Name"]')&&card.querySelector?.('[data-testid="tweetText"]'));
    const hasCapturedQuote=markedQuote||roleLinkQuote||
      Boolean(post.modernLayout&&post.article?.querySelector?.('[data-slot="embedded-tweet-frame"]'));
    const mediaSelector='[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"]';
    const mediaNode=post.article?.querySelector?.(mediaSelector+(post.modernLayout?'':',video'));
    const hasCapturedMedia=Boolean(mediaNode&&(mediaNode.localName!=='video'||mediaNode.matches?.(mediaSelector)||
      (mediaNode.closest('article')===post.article&&!globalThis.ZaneReplyCopilotContent.postExtractor.isQuoteContent(mediaNode,post.article))||
      post.article.querySelector(mediaSelector)||ownedDetailNodes(post.article,'video').length));
    const hasCapturedPhoto=[...(post.article?.querySelectorAll?.('a[href*="/photo/"]')||[])].some(a=>{
      if(a.closest('article')!==post.article)return false;
      try {const u=new URL(a.href);return u.protocol==='https:' && /^(?:www\.)?(?:x\.com|twitter\.com)$/.test(u.hostname) && new RegExp('^/[^/]+/status/'+post.statusId+'/photo/\\d+$').test(u.pathname);}catch{return false;}
    });
    // The rebuilt feed marks the quoted card, but its reply dialog may
    // render that same card as a plain article without a frame/permalink.
    // Capture only a single explicit immediate quote with its own identity.
    let modernCaptionQuote=null;
    if(post.modernLayout&&post.replyRouteVerified&&post.article){
      const frames=[...post.article.querySelectorAll(MODERN_FRAME)];
      if(frames.length===1){
        const frame=frames[0],articles=[...frame.querySelectorAll('article')];
        const bodies=[...frame.querySelectorAll(MODERN_BODY)];
        if(articles.length===1&&bodies.length===1&&articles[0].contains(bodies[0])&&
           frame.closest('article')===post.article&&frame.matches('[role="link"][data-href]')){
          try{
            const base=new URL(post.article.ownerDocument.baseURI),url=new URL(frame.getAttribute('data-href'),base);
            const id=url.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1];
            const text=normalized(globalThis.ZaneReplyCopilotContent.postExtractor.readOriginalText(bodies[0]));
            if(url.origin===base.origin&&url.protocol==='https:'&&id&&id!==post.statusId&&text&&(post.quoteOnly?text===normalized(post.quotedText):text!==normalized(post.sourceText))){
              const links=[...frame.querySelectorAll('a[aria-hidden="true"][href*="/status/"],a[data-base-ui-tooltip-trigger][href*="/status/"]')].filter(a=>!a.closest(MODERN_BODY));
              if(links.every(a=>{const u=new URL(a.getAttribute('href'),base);return u.origin===base.origin&&u.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1]===id;}))
                modernCaptionQuote=Object.freeze({id,text});
            }
          }catch{}
        }
      }
    }
    const legacyDetailRoute=!post.modernLayout&&initialUrl&&/\/status\/\d+(?:[/?#]|$)/.test(initialUrl);
    const detailPreviewSource=legacyDetailRoute?captureDetailPreviewSource(post,initialUrl):null;
    const detailQuoteSource=legacyDetailRoute&&hasCapturedQuote?captureDetailQuote(post.article,initialUrl,post.statusId):null;
    const timelineQuoteSource=!legacyDetailRoute&&!post.modernLayout&&hasCapturedQuote&&post.article?.nodeType===1?
      captureDetailQuote(post.article,initialUrl,post.statusId,true):null;
    const detailNativeVideo=Boolean(legacyDetailRoute&&ownedDetailNodes(post.article,'video').length);
    return {...post,hasCapturedPhoto,hasCapturedQuote,hasCapturedMedia:hasCapturedMedia||hasCapturedPhoto||detailNativeVideo,
      ...(detailPreviewSource?{detailPreviewSource}:{}),
      ...(detailQuoteSource?{detailQuoteSource}:{}),
      ...(timelineQuoteSource?{timelineQuoteSource}:{}),
      ...(detailPreviewSource&&timelinePreview?.statusId===post.statusId&&
        timelinePreview.sourceUrl===post.sourceUrl&&typeof timelinePreview.sourceText==='string'&&
        normalized(timelinePreview.sourceText)?{timelinePreview:Object.freeze({
          statusId:timelinePreview.statusId,sourceText:timelinePreview.sourceText,
          hasCapturedPhoto:timelinePreview.hasCapturedPhoto,hasCapturedMedia:timelinePreview.hasCapturedMedia,
          quoteOnly:timelinePreview.quoteOnly===true,hasCapturedQuote:timelinePreview.hasCapturedQuote===true
        })}:{}),
      ...(modernCaptionQuote?(post.quoteOnly?{modernQuoteOnly:modernCaptionQuote}:{modernCaptionQuote}):{})};
  }
  function sameContext(post,text) {
    const source=normalized(post.sourceText),copy=normalized(text);
    if(copy===source)return true;
    if(!(post.hasCapturedPhoto||post.hasCapturedMedia) || !source || !copy.startsWith(source+' '))return false;
    // X's modal can append a plain picture reference absent from feed text,
    // including a presentation space after https://. This is auxiliary text
    // comparison only: never navigate to it or treat it as identity evidence.
    return /^(?:(?:https:\/\/ ?)?pic\.(?:x|twitter)\.com\/[A-Za-z0-9]+\s*){1,4}$/.test(copy.slice(source.length).trim());
  }
  // A legacy reply preview may omit the parent permalink and render only
  // a shortened caption plus the media's presentation URL. Capture the
  // author/time from the exact clicked detail article before X opens it.
  // These values are transient DOM evidence, never diagnostic payloads.
  function detailRouteOwner(post,initialUrl){
    try{
      const u=new URL(initialUrl),source=new URL(post.sourceUrl);
      const m=u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
      if(u.protocol!=='https:'||!['x.com','twitter.com','www.x.com','www.twitter.com'].includes(u.hostname)||
         u.username||u.password||u.hash||!m||m[2]!==post.statusId||
         source.origin!==u.origin||source.pathname.replace(/\/$/,'')!==u.pathname.replace(/\/$/,''))return null;
      return m[1].toLowerCase();
    }catch{return null;}
  }
  function ownedDetailNodes(article,selector){
    const p=globalThis.ZaneReplyCopilotContent.postExtractor;
    return [...(article?.querySelectorAll?.(selector)||[])].filter(node=>
      node.closest('article')===article&&!p.isQuoteContent(node,article)&&
      !node.closest('[contenteditable="true"],[data-zane-reply-copilot]'));
  }
  // Native header links are preferable; compact previews can render an
  // unlinked @handle. Missing is not a contradiction, ambiguous is.
  function detailAuthor(article,initialUrl){
    const headers=ownedDetailNodes(article,'[data-testid="User-Name"]');
    if(headers.length!==1)return headers.length>1?'!conflict':null;
    const handles=new Set();
    for(const node of headers[0].querySelectorAll('a[href]')){
      if(node.closest('article')!==article||node.closest('[data-testid="User-Name"]')!==headers[0])continue;
      try{
        const base=new URL(initialUrl),u=new URL(node.getAttribute('href'),base);
        const match=u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
        if(u.origin===base.origin&&!u.username&&!u.password&&!u.hash&&!u.search&&match)handles.add(match[1].toLowerCase());
      }catch{}
    }
    if(handles.size>1)return '!conflict';
    if(handles.size===1)return handles.values().next().value;
    for(const node of headers[0].querySelectorAll('span,div')){
      if(node.children.length||node.closest('article')!==article)continue;
      const match=normalized(node.textContent).match(/^@([A-Za-z0-9_]{1,15})$/);
      if(match)handles.add(match[1].toLowerCase());
    }
    return handles.size>1?'!conflict':handles.size===1?handles.values().next().value:null;
  }
  function detailTimestamp(article){
    const times=ownedDetailNodes(article,'time[datetime]').filter(n=>!n.closest('[data-testid="tweetText"]'));
    if(times.length!==1)return null;
    const raw=times[0].getAttribute('datetime');
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw||''))return null;
    const value=Date.parse(raw);
    return Number.isFinite(value)?value:null;
  }
  function expandControls(article){
    const matches=ownedDetailNodes(article,'[data-testid="tweet-text-show-more-link"],button,a,[role="button"]').filter(n=>
      n.matches('[data-testid="tweet-text-show-more-link"]')||
      /^(?:show more|read more|显示更多|顯示更多|查看更多|展开全文|全文を表示|さらに表示|もっと見る|voir plus|mostrar más|mehr anzeigen)$/i.test(normalized(n.textContent)));
    // A wrapper and its native link/button may both match; count one control.
    return matches.filter(n=>!matches.some(other=>other!==n&&other.contains(n)));
  }
  function presentationNormalize(text,media){
    let s=normalized((text||'').normalize('NFC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,''));
    if(media)s=s.replace(/(?:\s+(?:https:\/\/\s?)?pic\.(?:x|twitter)\.com\/[A-Za-z0-9]+){1,4}$/i,'').trim();
    return s;
  }
  // A native expansion link can independently name the parent even when
  // the modal's timestamp is unlinked. It is not an ordinary body hyperlink.
  function detailExpansionId(article,initialUrl,controls=expandControls(article)){
    const ids=new Set();
    for(const control of controls){
      for(const link of [control,...control.querySelectorAll('a[href]')]){
        if(!link.matches('a[href]')||link.closest('article')!==article||
           inQuotedCard(link)||!(control.matches('[data-testid="tweet-text-show-more-link"]')||
           link.matches('[data-testid="tweet-text-show-more-link"]')))continue;
        try{
          const base=new URL(initialUrl),url=new URL(link.getAttribute('href'),base);
          const match=url.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/(\d+)\/?$/);
          if(url.origin===base.origin&&!url.username&&!url.password&&!url.hash&&match)ids.add(match[1]);
        }catch{}
      }
    }
    return ids.size>1?'!conflict':ids.size===1?ids.values().next().value:null;
  }
  function detailLinkToken(node){
    if(!node.matches('a[href]'))return null;
    try{
      const url=new URL(node.getAttribute('href'),node.ownerDocument.baseURI);
      // Compare the actual hyperlink target, not shortened display labels.
      // Only unambiguous X t.co redirect tokens; no link fetching/resolving.
      if(url.protocol==='https:'&&url.hostname==='t.co'&&!url.username&&!url.password&&
         !url.search&&!url.hash&&/^\/[A-Za-z0-9]+$/.test(url.pathname)){
        const label=normalized(node.textContent);
        if(/^(?:https?:\/\/)?pic\.(?:x|twitter)\.com\//i.test(label))return null;
        return ' \uE000'+url.pathname.slice(1)+'\uE001 ';
      }
    }catch{}
    return null;
  }
  function detailBodies(article,media,readExpands=()=>expandControls(article)){
    const bodies=ownedDetailNodes(article,'[data-testid="tweetText"]');
    if(bodies.length!==1)return {texts:[],expanded:false};
    const body=bodies[0],expands=readExpands();
    if(expands.length>1)return {texts:[],expanded:false};
    const expand=expands[0],inside=expand&&body.contains(expand);
    // Keep two representations: rendered text and DOM text (including emoji
    // alt). Hidden background articles can change innerText on modal open.
    // Do not remove arbitrary links, words or punctuation.
    const read=(node,links=false)=>{
      if(node===expand||node.nodeType===1&&node.matches('[data-zane-reply-copilot],[data-testid="tweetTranslation"],[data-testid="translation"],.immersive-translate-translation,.immersive-translate-translation-wrapper,.immersive-translate-target-translation-block-wrapper,.immersive-translate-target-translation-inline-wrapper,[data-imt-translation-only="1"],[data-immersive-translate-translation],[data-immersive-translate-translation-element]'))return '';
      if(node.nodeType===3)return node.textContent||'';
      if(node.nodeType!==1)return '';
      if(node.tagName==='IMG')return node.getAttribute('alt')||'';
      if(node.tagName==='BR')return ' ';
      if(links){const token=detailLinkToken(node);if(token)return token;}
      const result=[...node.childNodes].map(child=>read(child,links)).join('');
      return /^(?:DIV|P|LI)$/.test(node.tagName)?' '+result+' ':result;
    };
    const stripLabel=s=>{
      s=normalized(s);
      const label=inside?normalized(expand.textContent):'';
      if(label&&s.endsWith(label))s=s.slice(0,-label.length).trim();
      return presentationNormalize(s,media);
    };
    const rendered=globalThis.ZaneReplyCopilotContent.postExtractor.readOriginalText(body);
    const texts=[...new Set([stripLabel(rendered),presentationNormalize(read(body),media),presentationNormalize(read(body,true),media)].filter(Boolean))];
    return {texts,expanded:Boolean(expand)};
  }
  function captureDetailPreviewSource(post,initialUrl){
    const owner=detailRouteOwner(post,initialUrl);
    if(!owner||!post.article||!normalized(post.sourceText))return null;
    const author=detailAuthor(post.article,initialUrl);
    if(author&&author!==owner)return null;
    const media=Boolean(ownedDetailNodes(post.article,'[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="videoComponent"],video').length);
    const body=detailBodies(post.article,media);
    return Object.freeze({owner,author,time:detailTimestamp(post.article),
      texts:Object.freeze([...new Set([presentationNormalize(post.sourceText,media),...body.texts].filter(Boolean))])});
  }
  // Preserve the exact caption that the already-working timeline path
  // would have used, only on a trusted navigation to the same verified ID.
  // A single short-lived record, not a persistent feed cache.
  function captureTimelinePreview(article,initialUrl){
    if(!article?.isConnected||article.closest('[role="dialog"]')||
       article.parentElement?.closest('article,[data-slot="embedded-tweet-frame"]'))return null;
    try{
      const u=new URL(initialUrl);
      if(u.protocol!=='https:'||!['x.com','twitter.com','www.x.com','www.twitter.com'].includes(u.hostname)||
         /\/status\/\d+(?:\/|$)/.test(u.pathname)||u.pathname.startsWith('/compose/'))return null;
    }catch{return null;}
    const post=globalThis.ZaneReplyCopilotContent.postExtractor.extractPost(article,initialUrl);
    if(!post.ok||post.modernLayout||post.legacyDetailIdentity||
       !normalized(post.sourceText)||post.sourceText.length>40000)return null;
    const captured=capturePost(post,initialUrl);
    return Object.freeze({statusId:post.statusId,sourceUrl:post.sourceUrl,sourceText:post.sourceText,
      hasCapturedPhoto:captured.hasCapturedPhoto,hasCapturedMedia:captured.hasCapturedMedia,
      quoteOnly:post.quoteOnly===true,hasCapturedQuote:captured.hasCapturedQuote});
  }
  function timelineEquivalent(post,candidate){
    if(!post.timelinePreview||post.timelinePreview.statusId!==post.statusId||!candidate?.text||
       post.timelinePreview.quoteOnly!==Boolean(post.quoteOnly)||
       post.timelinePreview.hasCapturedQuote!==Boolean(post.hasCapturedQuote))return false;
    return sameContext(post.timelinePreview,candidate.text);
  }
  // Capture exactly one explicit quoted card, independently of the outer
  // author. Never borrow its ID as the target. Read-only DOM evidence.
  function captureDetailQuote(article,initialUrl,outerId,corroborate=false){
    const cards=[...article.querySelectorAll('[data-testid="quoteTweet"],div[role="link"]')].filter(card=>
      card.closest('article')===article&&
      (card.matches('[data-testid="quoteTweet"]')||
       card.querySelector('[data-testid="User-Name"]')&&card.querySelector('[data-testid="tweetText"]')));
    const roots=cards.filter(card=>!cards.some(other=>other!==card&&other.contains(card)));
    if(!roots.length)return null;
    if(roots.length!==1)return {conflict:true};
    const card=roots[0],bodies=[...card.querySelectorAll('[data-testid="tweetText"]')];
    if(bodies.length!==1)return {conflict:true};
    const ids=new Set();
    for(const time of card.querySelectorAll('time')){
      const link=time.closest('a[href*="/status/"]');
      if(!link||!card.contains(link))continue;
      try{
        const base=new URL(initialUrl),u=new URL(link.getAttribute('href'),base);
        const match=u.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status\/(\d+)(?:\/history)?\/?$/);
        if(u.origin!==base.origin||!match||u.username||u.password||u.hash)return {conflict:true};
        ids.add(match[1]);
      }catch{return {conflict:true};}
    }
    if(ids.size>1||ids.has(outerId))return {conflict:true};
    const body=bodies[0];
    const text=normalized(globalThis.ZaneReplyCopilotContent.postExtractor.readOriginalText(body));
    // Only media within this one captured quote card, not outer media.
    const media=Boolean(card.querySelector('[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="videoComponent"],video'));
    const mediaPresentation=link=>/^(?:https:\/\/ ?)?pic\.(?:x|twitter)\.com\/[A-Za-z0-9]+$/i.test(normalized(link.textContent))&&
      (/^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(link.href)||/^https:\/\/pic\.(?:x|twitter)\.com\/[A-Za-z0-9]+$/i.test(link.href));
    const links=[...body.querySelectorAll('a[href]')].filter(link=>!mediaPresentation(link)).map(link=>link.href);
    const presentations=[...body.querySelectorAll('a[href]')].filter(mediaPresentation).map(link=>link.href);
    let owner=null,time=null;
    if(corroborate){
      const headers=[...card.querySelectorAll('[data-testid="User-Name"]')];
      if(headers.length!==1)return {conflict:true};
      const handles=new Set();
      for(const a of headers[0].querySelectorAll('a[href]')){
        try{
          const u=new URL(a.getAttribute('href'),initialUrl),base=new URL(initialUrl);
          const m=u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
          if(u.origin===base.origin&&!u.username&&!u.password&&!u.hash&&!u.search&&m)handles.add(m[1].toLowerCase());
        }catch{}
      }
      if(handles.size>1)return {conflict:true};
      if(!handles.size)for(const n of headers[0].querySelectorAll('span,div')){
        if(n.children.length)continue;
        const m=normalized(n.textContent).match(/^@([A-Za-z0-9_]{1,15})$/);
        if(m)handles.add(m[1].toLowerCase());
      }
      if(handles.size>1)return {conflict:true};
      owner=handles.values().next().value||null;
      // A legacy clickable quote card may have an unlinked timestamp,
      // while its owned photo/video still carries a canonical status ID.
      // Only native media inside this card can supply that identity.
      // Do not use the outer body or the card's ordinary text links.
      const marker='[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="videoComponent"],video';
      for(const link of card.querySelectorAll('a[href*="/status/"]')){
        if(body.contains(link)||link.closest('article')!==article)continue;
        const mediaNode=link.closest(marker);
        if(!(mediaNode&&card.contains(mediaNode))&&!link.querySelector(marker))continue;
        try{
          const u=new URL(link.getAttribute('href'),initialUrl),base=new URL(initialUrl);
          const m=u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/(?:photo|video)\/\d+\/?$/);
          if(!m||u.origin!==base.origin||u.username||u.password||u.hash)continue;
          if(!owner)continue;
          if(m[1].toLowerCase()!==owner)return {conflict:true};
          ids.add(m[2]);
        }catch{}
      }
      if(ids.size>1||ids.has(outerId))return {conflict:true};
      const timestamps=[...card.querySelectorAll('time[datetime]')].filter(n=>!body.contains(n));
      if(timestamps.length>1)return {conflict:true};
      const raw=timestamps[0]?.getAttribute('datetime');
      if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw||'')){
        const parsed=Date.parse(raw);if(Number.isFinite(parsed))time=parsed;
      }
    }
    return text?Object.freeze({id:ids.values().next().value||null,text,media,links:Object.freeze(links),presentations:Object.freeze(presentations),owner,time}):{conflict:true};
  }
  function sameCapturedQuote(source,modal){
    if(!source||!modal||source.conflict||modal.conflict||
       (source.id&&modal.id&&source.id!==modal.id))return false;
    if(JSON.stringify(source.links)!==JSON.stringify(modal.links))return false;
    if(source.text===modal.text&&JSON.stringify(source.presentations)===JSON.stringify(modal.presentations))return true;
    // A known native quote's image/video can become a trailing pic link
    // in the reply modal. Never strip arbitrary URLs or another quote's
    // text; require matching independent quote ID and owned source media.
    return Boolean(source.media&&source.id&&source.id===modal.id&&
      presentationNormalize(source.text,true)===presentationNormalize(modal.text,true)&&
      presentationNormalize(source.text,true));
  }
  // Recognize only an exact native link to the independently verified
  // embedded post. A truncated display label, t.co alone, or any other
  // post link cannot be removed. Keep unrelated links in the comparison.
  function sameTimelineQuote(source,modal){
    if(!source||!modal||source.conflict||modal.conflict||
       (source.id&&modal.id&&source.id!==modal.id)||
       (source.owner&&modal.owner&&source.owner!==modal.owner)||
       (source.time!==null&&modal.time!==null&&source.time!==modal.time))return false;
    if(sameCapturedQuote(source,modal))return true;
    // An unlinked inner timestamp can still independently corroborate
    // a known quoted ID. Never use relative time, display name or prefix.
    return Boolean(source.id&&(!modal.id||modal.id===source.id)&&source.owner&&
      source.owner===modal.owner&&source.time!==null&&source.time===modal.time&&
      sameCapturedQuote(source,{...modal,id:source.id}));
  }
  function quoteProjection(article,quoteId,initialUrl,quoteOwner=null){
    if(!quoteId)return null;
    const bodies=ownedDetailNodes(article,'[data-testid="tweetText"]');
    if(bodies.length!==1)return null;
    const body=bodies[0],anchors=[...body.querySelectorAll('a[href]')];
    const last=anchors.at(-1);
    if(!last)return null;
    const target=raw=>{try{
      const base=new URL(initialUrl),u=new URL(raw,base);
      return u.origin===base.origin&&!u.username&&!u.password&&!u.hash&&
        u.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/(\d+)\/?$/)?.[1]===quoteId;
    }catch{return false;}};
    if(!target(last.href)){
      // X may render the attached quote as t.co with a full expanded
      // destination in native metadata. Require an exact canonical
      // status URL and matching known quote owner; no network resolving.
      try{
        const u=new URL(last.href),base=new URL(initialUrl);
        if(u.protocol!=='https:'||u.hostname!=='t.co'||u.username||u.password||
           u.search||u.hash||!/^\/[A-Za-z0-9]+$/.test(u.pathname)||!quoteOwner)return null;
        const destinations=['data-expanded-url','title'].map(name=>last.getAttribute(name)).filter(Boolean);
        if(!destinations.length||!destinations.every(raw=>{
          if(!/^https:\/\//.test(raw)||!target(raw))return false;
          const v=new URL(raw);
          return v.origin===base.origin&&v.pathname.split('/')[1]?.toLowerCase()===quoteOwner;
        }))return null;
      }catch{return null;}
    }
    const text=normalized(globalThis.ZaneReplyCopilotContent.postExtractor.readOriginalText(body));
    const label=normalized(last.innerText||last.textContent);
    if(!label||!text.endsWith(' '+label))return null;
    return {text:text.slice(0,-label.length).trim(),links:anchors.slice(0,-1).map(link=>link.href)};
  }
  function detailQuoteCheck(post,article,initialUrl){
    if(!post.hasCapturedQuote)return {conflict:Boolean(captureDetailQuote(article,initialUrl,post.statusId)),matched:false};
    const captured=post.detailQuoteSource,modal=captureDetailQuote(article,initialUrl,post.statusId);
    if(!modal)return {conflict:false,matched:false};
    if(!sameCapturedQuote(captured,modal))return {conflict:true,matched:false};
    return {conflict:false,matched:Boolean(captured.id&&modal.id===captured.id)};
  }
  function detailPreviewBefore(article,editor,dialog){
    return visible(article)&&article.closest('[role="dialog"]')===dialog&&
      !article.contains(editor)&&!article.closest('[contenteditable="true"],[data-zane-reply-copilot]')&&
      Boolean(article.compareDocumentPosition(editor)&4);
  }
  // Only within a single synchronous snapshot. Do not cache across
  // DOM mutations, focus events, generation or pre-insertion validation.
  // Lazy evaluation preserves the old short-circuit behavior.
  function scanDetailArticle(post,article,initialUrl){
    const once=read=>{let done=false,value;return ()=>{if(!done){value=read();done=true;}return value;};};
    const expands=once(()=>expandControls(article));
    return {
      owner:once(()=>detailRouteOwner(post,initialUrl)),
      evidence:once(()=>globalThis.ZaneReplyCopilotContent.postExtractor.legacyDetailEvidence(article,initialUrl)),
      expands,
      expansionId:once(()=>detailExpansionId(article,initialUrl,expands())),
      author:once(()=>detailAuthor(article,initialUrl)),
      time:once(()=>detailTimestamp(article)),
      bodies:once(()=>detailBodies(article,post.hasCapturedMedia,expands)),
      quote:once(()=>detailQuoteCheck(post,article,initialUrl))
    };
  }
  function detailContextConflict(post,scan){
    const owner=scan.owner(),evidence=scan.evidence();
    const expansionId=scan.expansionId();
    const author=scan.author(),time=scan.time(),captured=post.detailPreviewSource;
    return Boolean(expansionId&&expansionId!==post.statusId)||evidence.conflict||(evidence.statusId&&evidence.statusId!==post.statusId)||
      (evidence.otherCanonicalId&&evidence.otherCanonicalId!==post.statusId)||
      Boolean(author&&author!==owner)||
      Boolean(captured&&captured.time!==null&&time!==null&&captured.time!==time);
  }
  function compactDetailPreview(post,article,editor,dialog,text,initialUrl,currentUrl,quarantinedPosts,scan,sourceScan){
    const captured=post.detailPreviewSource,owner=scan.owner();
    if(!captured||!owner||captured.owner!==owner||
       post.quoteOnly||!article?.matches?.('article[data-testid="tweet"]')||
       !detailPreviewBefore(article,editor,dialog)||!routeAllowed(initialUrl,currentUrl,post.statusId,true)||
       editor.closest('[inert],[aria-hidden="true"]')||
       article.querySelector('article,[data-slot="embedded-tweet-frame"]')||
       (!post.hasCapturedQuote&&article.querySelector('[data-testid="quoteTweet"]'))||
       (post.hasCapturedQuote&&scan.quote().conflict))return false;
    try{
      const u=new URL(currentUrl);
      if(u.pathname!=='/compose/post'||u.hash||u.username||u.password)return false;
    }catch{return false;}
    const evidence=scan.evidence();
    if(!evidence.eligible||detailContextConflict(post,scan))return false;
    const author=scan.author(),timestamp=scan.time();
    if(post.article?.isConnected){
      const sourceAuthor=sourceScan.author(),sourceTime=sourceScan.time();
      if((sourceAuthor&&sourceAuthor!==owner)||
         (captured.time!==null&&sourceTime!==null&&sourceTime!==captured.time))return false;
      const current=sourceScan.bodies().texts;
      if(!current.some(v=>captured.texts.includes(v)))return false;
    }
    const matchingTime=captured.time!==null&&timestamp===captured.time;
    const matchingAuthor=author===owner;
    const expansionId=scan.expansionId();
    const modal=scan.bodies();
    if(!modal.texts.length)return false;
    const oldAmbiguous=quarantinedPosts.some(old=>old?.statusId!==post.statusId&&(
      modal.texts.some(v=>{
        const q=presentationNormalize(old.sourceText,old.hasCapturedMedia||old.hasCapturedPhoto);
        const prefix=v.replace(/(?:\u2026|\.{3})$/,'').trim();
        return q&&(q===v||(prefix.length>=40&&q.startsWith(prefix)));
      })||(matchingTime&&old?.detailPreviewSource?.owner===owner&&old.detailPreviewSource.time===timestamp)));
    if(oldAmbiguous)return false;
    // A native Show more permalink is strong independent target evidence;
    // as with the normal verified-ID path, display differences are allowed.
    // The source body, route, editor and contradictory metadata were checked.
    if(expansionId===post.statusId&&modal.expanded)return true;
    // Editor-first corroboration: the state machine has already required a
    // trusted captured click, no old modal, one new focused empty editor.
    // The modal itself need not repeat a permalink or exact datetime.
    // A timestamp/author/status contradiction still fails closed.
    for(const full of captured.texts)for(const value of modal.texts){
      if(full===value&&(matchingAuthor||matchingTime||Array.from(value).length>=40))return true;
      const prefix=value.replace(/(?:\u2026|\.{3})$/,'').trim();
      const marked=modal.expanded||prefix!==value;
      const length=Array.from(prefix).length;
      // Some compact previews omit the expansion control; allow only a long
      // exact prefix with the same native handle, not general similarity.
      if(full.length>prefix.length&&full.startsWith(prefix)&&
         ((marked&&length>=40&&(matchingAuthor||matchingTime))||
          (marked&&length>=80)||(matchingAuthor&&length>=100)))return true;
      // Native long previews may wrap CJK text and emoji differently. For
      // a positively marked long preview with matching author, compare
      // exact characters after removing presentation whitespace and VS16.
      // Do not accept arbitrary edits, translated text, or different URLs.
      if(marked&&matchingAuthor){
        const compact=s=>s.replace(/[\s\uFE0E\uFE0F]/g,'');
        const long=compact(full),short=compact(prefix);
        if(Array.from(short).length>=80&&long.startsWith(short))return true;
      }
    }
    return false;
  }
  function routeAllowed(initial,current,statusId,modern=false) {
    if(!modern&&initial===current)return true;
    try {
      const a=new URL(initial),b=new URL(current);
      if(!modern)return a.origin===b.origin&&b.pathname==='/compose/post'&&(!b.searchParams.has('in_reply_to')||b.searchParams.get('in_reply_to')===statusId);
      if(a.origin!==b.origin)return false;
      if(b.pathname!=='/compose/post')return initial===current;
      if(b.searchParams.has('quote')||b.searchParams.has('quote_tweet_id'))return false;
      return !b.searchParams.has('in_reply_to')||
        globalThis.ZaneReplyCopilotContent.replyDetector.replyRouteId(current,initial)===statusId;
    }catch{return false;}
  }
  const MODERN_BODY='div[dir="auto"].whitespace-pre-wrap';
  const MODERN_FRAME='[data-slot="embedded-tweet-frame"]';
  // Only the preview BEFORE the editor can be the original post. Exclude
  // nested dialogs, quotes, the textarea's visual mirror, and our own UI.
  function beforeEditor(node,editor,dialog) {
    return visible(node)&&node.closest('[role="dialog"]')===dialog&&
      !node.contains(editor)&&!node.closest('[inert],[contenteditable="true"],[data-zane-reply-copilot]')&&
      Boolean(node.compareDocumentPosition(editor)&4);
  }
  function linklessPreviewConflict(dialog,editor,post,initialUrl) {
    for(const node of dialog.querySelectorAll('a[aria-hidden="true"][href*="/status/"],[data-href*="/status/"],a[data-base-ui-tooltip-trigger][href*="/status/"]')){
      if(node.closest('article')||node.closest(MODERN_FRAME)||inQuotedCard(node)||
         node.closest(MODERN_BODY)||node.contains(editor)||
         node.closest('[role="dialog"]')!==dialog||!(node.compareDocumentPosition(editor)&4))continue;
      try {
        const url=new URL(node.getAttribute('data-href')||node.getAttribute('href'),initialUrl);
        const base=new URL(initialUrl),id=url.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1];
        if(url.origin!==base.origin||id!==post.statusId)return true;
      }catch{return true;}
    }
    return false;
  }
  // Fallback only for a canonically captured legacy feed post whose
  // existing exact-ID/text fast path failed. No feed scan, prefetch or
  // delay; require independent modal time or native route evidence.
  function verifiedTimelinePreview(post,article,editor,dialog,initialUrl,currentUrl,original,quarantinedPosts,report){
    const result=(value,reason)=>{if(report)report.reason=reason;return value;};
    if(!article||!post.article?.isConnected||!original?.ok||
       !detailPreviewBefore(article,editor,dialog)||editor.closest('[inert],[aria-hidden="true"]')||
       !article.matches('article[data-testid="tweet"]')||article.querySelector('article,[data-slot="embedded-tweet-frame"]'))return result(null,'shape_missing');
    if(original.statusId!==post.statusId||original.sourceUrl!==post.sourceUrl||
       normalized(original.sourceText)!==normalized(post.sourceText))return result(false,'source_changed');
    let owner,routeId;
    try{
      const initial=new URL(initialUrl),current=new URL(currentUrl),source=new URL(post.sourceUrl);
      const m=source.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
      if(initial.protocol!=='https:'||!['x.com','twitter.com','www.x.com','www.twitter.com'].includes(initial.hostname)||
         initial.origin!==source.origin||current.origin!==initial.origin||!m||m[2]!==post.statusId||
         /\/status\/\d+(?:\/|$)/.test(initial.pathname)||initial.pathname.startsWith('/compose/'))return null;
      if(current.pathname!=='/compose/post'||current.hash||current.username||current.password||
         current.searchParams.has('quote')||current.searchParams.has('quote_tweet_id')||
         current.searchParams.getAll('in_reply_to').length>1)return false;
      owner=m[1].toLowerCase();routeId=current.searchParams.get('in_reply_to');
      if(routeId!==null&&routeId!==post.statusId)return false;
    }catch{return null;}
    const source=scanDetailArticle(post,post.article,initialUrl),modal=scanDetailArticle(post,article,initialUrl);
    const sourceAuthor=source.author(),modalAuthor=modal.author();
    if((sourceAuthor&&sourceAuthor!==owner)||(modalAuthor&&modalAuthor!==owner))return result(false,'outer_author_conflict');
    const sourceTime=source.time(),modalTime=modal.time();
    if(sourceTime!==null&&modalTime!==null&&sourceTime!==modalTime)return result(false,'outer_time_conflict');
    const sourceEvidence=source.evidence(),modalEvidence=modal.evidence();
    if([sourceEvidence,modalEvidence].some(e=>e.conflict||(e.statusId&&e.statusId!==post.statusId)||
         (e.otherCanonicalId&&e.otherCanonicalId!==post.statusId)))return result(false,'outer_identity_conflict');
    const expandedId=modal.expansionId();
    if(expandedId&&expandedId!==post.statusId)return false;
    const sourceQuote=captureDetailQuote(post.article,initialUrl,post.statusId,true);
    let modalQuote=captureDetailQuote(article,initialUrl,post.statusId,true);
    const outerCorroborated=sourceAuthor===owner&&modalAuthor===owner&&
      sourceEvidence.eligible&&modalEvidence.eligible&&
      (routeId===post.statusId||modalEvidence.statusId===post.statusId||expandedId===post.statusId||
       (sourceTime!==null&&sourceTime===modalTime));
    // A compact modal can omit the inner permalink and replace the
    // source's native media with a pic link. Recover the INNER identity
    // only from an exact attached quote destination plus the same author
    // and exact quote content, after independently confirming the outer.
    // This is never a way to infer the parent from a quote URL.
    if(outerCorroborated&&post.hasCapturedQuote&&sourceQuote?.id&&sourceQuote.owner&&
       modalQuote&&!modalQuote.conflict&&!modalQuote.id&&modalQuote.owner===sourceQuote.owner&&
       (sourceQuote.time===null||modalQuote.time===null||sourceQuote.time===modalQuote.time)&&
       quoteProjection(article,sourceQuote.id,initialUrl,sourceQuote.owner)){
      const candidate={...modalQuote,id:sourceQuote.id};
      if(sameTimelineQuote(sourceQuote,candidate))modalQuote=candidate;
    }
    if(report)Object.assign(report,{sourceQuoteId:Boolean(sourceQuote?.id),modalQuoteId:Boolean(modalQuote?.id),
      quoteOwnerMatch:Boolean(sourceQuote?.owner&&sourceQuote.owner===modalQuote?.owner),
      quoteTimeMatch:Boolean(sourceQuote?.time!=null&&sourceQuote.time===modalQuote?.time),
      outerTimeMatch:Boolean(sourceTime!==null&&sourceTime===modalTime)});
    if(post.hasCapturedQuote){
      if(sourceQuote?.conflict||modalQuote?.conflict||
         (sourceQuote&&modalQuote&&!sameTimelineQuote(sourceQuote,modalQuote))||
         (post.timelineQuoteSource&&sourceQuote&&!sameTimelineQuote(post.timelineQuoteSource,sourceQuote)))return result(false,'quote_conflict');
      if(!sourceQuote||!modalQuote)return result(null,'quote_missing');
    }else if(sourceQuote||modalQuote)return result(false,'unexpected_quote');
    // Missing evidence is not an explicit contradiction. Preserve the
    // existing hydration wait, but never let known conflicts reach it.
    if(!outerCorroborated)return result(null,'outer_evidence_missing');
    if(post.quoteOnly){
      return Boolean(sourceQuote?.id&&sourceQuote.id===modalQuote?.id&&sourceQuote.text===normalized(post.quotedText)&&
        !quarantinedPosts.some(old=>old?.statusId!==post.statusId&&sameContext(old,post.sourceText)));
    }
    const full=source.bodies(),short=modal.bodies();
    if(!full.texts.length||!short.texts.length)return null;
    // Rendered labels can be truncated or identical for different links.
    // The visible body link destinations must agree, independently of
    // text variants. Extra source links are allowed only after a marked
    // native expansion. Exclude the native Show more control itself.
    const hrefs=target=>ownedDetailNodes(target,'[data-testid="tweetText"] a[href]')
      .filter(link=>!link.closest('[data-testid="tweet-text-show-more-link"]'))
      .map(link=>link.href);
    const sourceLinks=hrefs(post.article),modalLinks=hrefs(article);
    // Feed and modal can represent the same attached quote differently:
    // a trailing exact quote permalink may be present in only one body.
    // Require the same independently identified quote in both before
    // comparing without that one verified presentation link.
    const quotedIdentityMatch=Boolean(sourceQuote?.id&&modalQuote&&
      (sourceQuote.id===modalQuote.id||(!modalQuote.id&&sourceQuote.owner&&sourceQuote.owner===modalQuote.owner&&
       sourceQuote.time!==null&&sourceQuote.time===modalQuote.time)));
    if(quotedIdentityMatch){
      const s=quoteProjection(post.article,sourceQuote.id,initialUrl,sourceQuote.owner),m=quoteProjection(article,sourceQuote.id,initialUrl,sourceQuote.owner);
      const sText=s?.text||normalized(post.sourceText),mText=m?.text||normalized(globalThis.ZaneReplyCopilotContent.postExtractor.postText(article));
      if((s||m)&&sText&&sText===mText&&JSON.stringify(s?.links||sourceLinks)===JSON.stringify(m?.links||modalLinks)&&
         !quarantinedPosts.some(old=>old?.statusId!==post.statusId&&
           (normalized(old.sourceText)===sText||sameContext(old,mText))))return result(true,'quote_projection_matched');
    }
    if(modalLinks.some((href,i)=>href!==sourceLinks[i])||
       (!short.expanded&&sourceLinks.length!==modalLinks.length))return result(false,'body_links_conflict');
    const matches=(long,value)=>{
      if(long===value)return true;
      const prefix=value.replace(/(?:\u2026|\.{3})$/,'').trim();
      return short.expanded&&Array.from(prefix).length>=40&&
        long.length>prefix.length&&long.startsWith(prefix);
    };
    if(quarantinedPosts.some(old=>old?.statusId!==post.statusId&&short.texts.some(value=>
      matches(presentationNormalize(old.sourceText,old.hasCapturedMedia||old.hasCapturedPhoto),value))))return false;
    const matched=full.texts.some(long=>short.texts.some(value=>matches(long,value)));
    return result(matched,matched?'body_matched':'body_text_conflict');
  }
  function snapshot(document,post,initialUrl,currentUrl,now,quarantinedPosts=[],includeCompactEvidence=false) {
    const api=globalThis.ZaneReplyCopilotContent;
    const original=post.article?.isConnected&&!post.legacyDetailIdentity?api.postExtractor.extractPost(post.article):null;
    const sourceUnchanged=!post.article?.isConnected||(post.legacyDetailIdentity?
      api.postExtractor.revalidateLegacyDetailSource(post,initialUrl):Boolean(original?.ok&&original.statusId===post.statusId));
    const nodes=new Set();
    const selector=selectorFor(document,post);
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    let visibleDialogCount=0;
    for (const dialog of dialogs) {
      let found=false;
      for (const editor of dialog.querySelectorAll(selector)) if(nodes.has(editor)||eligibleEditor(editor,post)){nodes.add(editor);found=true;}
      if(found)visibleDialogCount++;
    }
    const detailScans=post.detailPreviewSource?new Map():null;
    const scanFor=article=>{
      let scan=detailScans.get(article);
      if(!scan){scan=scanDetailArticle(post,article,initialUrl);detailScans.set(article,scan);}
      return scan;
    };
    const editors=[...nodes].map(node=>{
      const dialog=node.closest('[role="dialog"]');
      const modernContext=post.modernLayout===true||Boolean(post.replyRouteVerified&&hybridNativeEditor(node));
      const routeId=modernContext&&post.replyRouteVerified?api.replyDetector.replyRouteId(currentUrl,initialUrl):null;
      const articles=[...dialog.querySelectorAll('article')].filter(a=>visible(a)&&!a.contains(node)
        && !inQuotedCard(a) &&
        (!modernContext||!a.closest?.('[data-slot="embedded-tweet-frame"]')));
      // Quoted posts/media can add extra article nodes in the modal.
      // Identify the ONE article whose canonical status ID matches the
      // clicked target; never equate the first article with the parent.
      let candidates=articles.map(article=>({
        article, id:contextId(article,post.modernLayout===true,post.legacyDetailIdentity?initialUrl:null,post.statusId), text:api.postExtractor.postText(article)
      }));
      // On some rich-media reply modals X renders the original tweetText
      // directly in the dialog, without wrapping it in an article. The
      // fallback is STRICTLY scoped to this opened reply dialog, never
      // the feed behind it. A quoted preview cannot masquerade as the root.
      const bareTexts=[...dialog.querySelectorAll('[data-testid="tweetText"]')]
        .filter(textNode=>visible(textNode)&&!textNode.closest('article')&&
          !inQuotedCard(textNode)&&!textNode.closest('[contenteditable="true"]')&&(!modernContext||beforeEditor(textNode,node,dialog)));
      for(const textNode of bareTexts){
        const text=normalized(api.postExtractor.readOriginalText?.(textNode)||textNode.innerText||textNode.textContent);
        if(text)candidates.push({article:null,id:null,text});
      }
      // Real rebuilt X can show an unlinked DIV preview rather than an
      // article. This is supplementary evidence, never a text-only ID.
      if(modernContext)for(const textNode of dialog.querySelectorAll(MODERN_BODY)){
        if(!beforeEditor(textNode,node,dialog)||textNode.closest('article')||
           textNode.closest(MODERN_FRAME)||inQuotedCard(textNode))continue;
        const text=normalized(api.postExtractor.readOriginalText(textNode));
        if(text)candidates.push({article:null,id:null,text,node:textNode});
      }
      // Real captioned quote reply: linkless outer caption + one plain
      // embedded article BEFORE the same textarea. Do not discard arbitrary
      // extra articles. Require the trusted native route, exact two texts,
      // distinct captured quote ID, no conflicting canonical identity and
      // caption-before-quote ordering. Keep all ordinary/legacy rules intact.
      const routeQuote=post.modernLayout&&post.replyRouteVerified&&!post.quoteOnly&&post.modernCaptionQuote;
      const matchesCapturedQuote=(candidate,evidence)=>{
        const article=candidate?.article;
        if(!article||!evidence||normalized(candidate.text)!==evidence.text||
           (candidate.id!==null&&candidate.id!==evidence.id)||
           !beforeEditor(article,node,dialog)||article.querySelector('article,[data-slot="embedded-tweet-frame"]')||
           article.querySelectorAll(MODERN_BODY).length!==1)return false;
        const links=[...article.querySelectorAll('a[aria-hidden="true"][href*="/status/"],a[data-base-ui-tooltip-trigger][href*="/status/"],[data-href*="/status/"]')].filter(a=>!a.closest(MODERN_BODY));
        return links.every(a=>{try{
          const u=new URL(a.getAttribute('data-href')||a.getAttribute('href'),initialUrl);
          return u.origin===new URL(initialUrl).origin&&u.pathname.match(/^\/[^/]+\/status\/(\d+)\/?$/)?.[1]===evidence.id;
        }catch{return false;}});
      };
      const outOfOrderArticle=modernContext&&articles.some(article=>!beforeEditor(article,node,dialog));
      // A positively identified quote may hydrate before its caption.
      if(routeQuote&&routeId===post.statusId&&candidates.length===1&&articles.length===1&&
         matchesCapturedQuote(candidates[0],routeQuote))candidates=[];
      if(routeQuote&&routeId===post.statusId&&
         candidates.length===2&&articles.length===1){
        const quoted=candidates.find(c=>c.article),caption=candidates.find(c=>!c.article);
        const article=quoted?.article;
        if(article&&caption?.node&&caption.id===null&&sameContext(post,caption.text)&&
           matchesCapturedQuote(quoted,routeQuote)&&
           !article.contains(caption.node)&&Boolean(caption.node.compareDocumentPosition(article)&4)&&
           !quarantinedPosts.some(old=>old?.statusId!==post.statusId&&sameContext(old,caption.text)))candidates=[caption];
      }
      let unmarkedQuoteText='';
      const quoteOnlyEvidence=post.modernQuoteOnly;
      if(modernContext&&post.quoteOnly&&quoteOnlyEvidence&&routeId===post.statusId&&
         candidates.length===1&&articles.length===1&&matchesCapturedQuote(candidates[0],quoteOnlyEvidence)){
        unmarkedQuoteText=quoteOnlyEvidence.text;candidates=[];
      }
      const matching=candidates.filter(item=>item.id===post.statusId);
      // Only quote-only posts need this extra DOM check. X can show the
      // outer author/timestamp without an outer tweetText in the modal.
      // Require BOTH the verified outer ID and the same quoted preview.
      const quotePreview=post.quoteOnly && post.quotedText ? (()=>{
        // The modal can mount the parent timestamp before the embedded quote.
        // A missing preview is not a contradiction of an EXACT parent ID;
        // a visible, different preview remains a hard conflict.
        const marked=[...dialog.querySelectorAll('[data-testid="quoteTweet"] [data-testid="tweetText"]')];
        const roleCards=[...dialog.querySelectorAll('div[role="link"]')]
          .filter(card=>card.querySelector?.('[data-testid="User-Name"]'))
          .map(card=>card.querySelector?.('[data-testid="tweetText"]')).filter(Boolean);
        const nodes=[...new Set([...marked,...roleCards])];
        return {seen:nodes.length>0,matches:nodes.some(node=>
          normalized(api.postExtractor.readOriginalText?.(node)||node.innerText||node.textContent)===normalized(post.quotedText))};
      })() : {seen:false,matches:false};
      const capturedQuote=post.detailQuoteSource||post.timelineQuoteSource;
      const projectedQuoteMatch=Boolean(post.quoteOnly&&quotePreview.seen&&!quotePreview.matches&&
        capturedQuote&&matching.length===1&&matching[0].article&&
        sameCapturedQuote(capturedQuote,captureDetailQuote(matching[0].article,initialUrl,post.statusId)));
      const quotedPreviewMatches=quotePreview.matches||projectedQuoteMatch;
      const exactText=candidates.filter(item=>sameContext(post,item.text));
      // X sometimes omits the parent permalink in a quote/video reply modal,
      // while leaving a separate quoted article. A UNIQUE source-text match
      // is valid fallback evidence, even when the modal has several articles.
      // An explicitly identified DIFFERENT parent never becomes a match.
      const uniqueText=exactText.length===1?exactText[0]:null;
      const primary=matching.length===1?matching[0]
        :uniqueText&&(uniqueText.id===null)?uniqueText
        :candidates.length===1?candidates[0]:null;
      const text=primary?.text||'';
      let statusId=primary?.id||null;
      const quarantinedContextMatch=Boolean(primary&&text&&quarantinedPosts.some(old=>
        old?.statusId!==post.statusId&&sameContext(old,text)&&statusId!==post.statusId));
      // If the post ID is present it wins, even if X changed the display
      // text for translation. Otherwise demand a unique original-text match;
      // missing modal context should WAIT for React, not be rejected.
      // Require either the original exact parent ID in the dialog, or
      // the independently verified click-link AND current route ID with a
      // unique matching, linkless preview. Never bind by text alone.
      const modernQuotes=post.modernLayout&&post.quoteOnly?
        articles.flatMap(a=>api.postExtractor.modernQuoteTexts?.(a)||[]):[];
      const routeConflict=Boolean(modernContext&&linklessPreviewConflict(dialog,node,post,initialUrl));
      const editorUnsafe=modernContext&&node.localName==='textarea'&&
        (node.disabled||node.readOnly||node.getAttribute('aria-disabled')==='true'||
         node.getAttribute('aria-readonly')==='true'||!node.getAttribute('aria-label')||
         node.closest('[inert],[data-slot="embedded-tweet-frame"]')||node.closest('article'));
      const routeQuoteNodes=post.modernLayout&&post.quoteOnly?
        [...dialog.querySelectorAll(MODERN_FRAME+' '+MODERN_BODY)].filter(n=>beforeEditor(n,node,dialog)):[];
      const routeQuoteText=routeQuoteNodes.length===1&&!unmarkedQuoteText?normalized(api.postExtractor.readOriginalText(routeQuoteNodes[0])):routeQuoteNodes.length===0?unmarkedQuoteText:'';
      const quoteRoutePreview=post.modernLayout&&post.quoteOnly&&candidates.length===0&&routeQuoteText&&
        routeQuoteText===normalized(post.quotedText)&&!quarantinedPosts.some(old=>old?.statusId!==post.statusId&&sameContext(old,routeQuoteText));
      const ownRoutePreview=modernContext&&!post.quoteOnly&&candidates.length===1&&primary?.article===null&&
        primary?.id===null&&sameContext(post,primary.text);
      const linkless=modernContext&&post.replyRouteVerified&&routeId===post.statusId&&
        !routeConflict&&!quarantinedContextMatch&&(ownRoutePreview||quoteRoutePreview);
      const modernMatch=!modernContext?null:
        editorUnsafe||routeConflict||outOfOrderArticle||candidates.some(c=>c.id&&c.id!==post.statusId)||candidates.length>1?false:
        post.replyRouteVerified&&routeId!==post.statusId?null:
        linkless?true:
        matching.length!==1?null:
        modernQuotes.length>0&&!modernQuotes.every(t=>normalized(t)===normalized(post.quotedText))?false:true;
      if(linkless&&modernMatch===true)statusId=routeId;
      const detailScan=detailScans&&!modernContext&&primary?.article?scanFor(primary.article):null;
      const detailQuoteEvidence=detailScan&&post.hasCapturedQuote?detailScan.quote():null;
      const compactDetailConflict=Boolean(detailScan&&
        (detailContextConflict(post,detailScan)||detailQuoteEvidence?.conflict));
      const compactDetailMatch=Boolean(post.detailPreviewSource&&!modernContext&&sourceUnchanged&&!compactDetailConflict&&
        candidates.length===1&&primary?.article&&(!primary.id||primary.id===post.statusId)&&
        compactDetailPreview(post,primary.article,node,dialog,text,initialUrl,currentUrl,quarantinedPosts,detailScan,scanFor(post.article)));
      // Reuse the ordinary legacy association rules for detail recovery:
      // an independently verified parent ID wins; a unique matching
      // timeline caption (captured on navigation) is ordinary text evidence.
      // Keep the stronger detail source, route and dialog fences.
      const priorTimelineMatch=Boolean(post.detailPreviewSource&&post.timelinePreview&&
        !modernContext&&sourceUnchanged&&!compactDetailConflict&&candidates.length===1&&
        primary?.article&&detailPreviewBefore(primary.article,node,dialog)&&
        (!primary.id||primary.id===post.statusId)&&timelineEquivalent(post,primary)&&
        !quarantinedPosts.some(old=>old?.statusId!==post.statusId&&
          (sameContext(old,primary.text)||sameContext(old,post.timelinePreview.sourceText))));
      const detailExactMatch=Boolean(!post.quoteOnly&&post.legacyDetailIdentity&&post.detailPreviewSource&&
        sourceUnchanged&&candidates.length===1&&primary?.article&&
        detailPreviewBefore(primary.article,node,dialog)&&!primary.id&&sameContext(post,text)&&
        (post.legacyDetailKind==='owned'||detailScan.author()===post.detailPreviewSource.owner));
      const verifiedQuoteOnly=Boolean(post.quoteOnly&&post.detailPreviewSource&&detailQuoteEvidence?.matched&&
        sourceUnchanged&&candidates.length===1&&primary?.article&&
        detailPreviewBefore(primary.article,node,dialog)&&!compactDetailConflict&&
        detailScan.author()===post.detailPreviewSource.owner&&
        !quarantinedPosts.some(old=>old?.statusId!==post.statusId&&sameContext(old,post.sourceText)));
      const detailMatch=post.legacyDetailIdentity?
        candidates.some(c=>(c.id&&c.id!==post.statusId)||(c.article&&!detailPreviewBefore(c.article,node,dialog)))||matching.length>1||compactDetailConflict?false:
        matching.length===1&&candidates.length===1?(!post.quoteOnly||!quotePreview.seen||quotedPreviewMatches):
        verifiedQuoteOnly||(!post.quoteOnly&&(compactDetailMatch||priorTimelineMatch||detailExactMatch))?true:null:null;
      const existingContextMatches=post.legacyDetailIdentity?detailMatch:modernContext?modernMatch:post.quoteOnly
        ? !candidates.length?null
          :matching.length>1||compactDetailConflict?false
          :matching.length===1?(!quotePreview.seen || quotedPreviewMatches)
          :verifiedQuoteOnly?true
          // Quote text alone cannot identify the reply target. Wait for
          // X's outer parent to hydrate instead of rejecting prematurely.
          :candidates.some(item=>Boolean(item.id))?false:null
        :!candidates.length?null
          :matching.length>1||compactDetailConflict?false
          // A uniquely verified parent status ID is the strongest evidence.
        // X may hydrate its caption text later, especially around quotes.
        :matching.length===1?true
          // An explicit other parent/status identity must still fail closed.
          :candidates.some(item=>Boolean(item.id))?false
          // Preserve the original, unique exact-text fallback only when
          // no conflicting status IDs appear in the opened reply dialog.
          :compactDetailMatch||priorTimelineMatch?true
          :uniqueText&&!uniqueText.id&&exactText.length===1?true
          // Only captioned quote layouts get a hydration grace; unrelated
          // non-quote or media text mismatches stay strict/fail-closed.
          :post.hasCapturedQuote?null
          :candidates.length===1&&!normalized(text)&&!statusId?null
          :false;
      const timelineEvidence=includeCompactEvidence&&post.hasCapturedQuote?{}:null;
      const timelineFallback=existingContextMatches!==true&&!modernContext&&!post.legacyDetailIdentity&&
        !post.detailPreviewSource&&sourceUnchanged&&candidates.length===1&&primary?.article&&!primary.id?
        verifiedTimelinePreview(post,primary.article,node,dialog,initialUrl,currentUrl,original,quarantinedPosts,timelineEvidence):null;
      const contextMatches=timelineFallback===null?existingContextMatches:timelineFallback;
      const compactEvidence=includeCompactEvidence&&detailScan?{
        expansion:detailScan.expands().length===1,
        expansionIdPresent:Boolean(detailScan.expansionId()),
        authorMatches:detailScan.author()===post.detailPreviewSource.owner,
        timestampPresent:detailScan.time()!==null,
        conflict:compactDetailConflict,
        matched:compactDetailMatch,
        timelinePreviewPresent:Boolean(post.timelinePreview),timelinePreviewMatched:priorTimelineMatch,
        sourceTextVariants:Math.min(5,post.detailPreviewSource.texts.length),
        modalTextVariants:Math.min(5,detailScan.bodies().texts.length)
      }:null;
      const contextDetail=routeConflict?"route_preview_conflict":
        linkless&&contextMatches===true?"verified_route_preview":
        modernContext&&post.replyRouteVerified&&contextMatches===null?"awaiting_route_preview":
        contextMatches===true?"verified_context"
        :matching.length>1?"duplicate_parent_identity"
        :matching.length===1&&post.quoteOnly&&quotePreview.seen&&!quotedPreviewMatches?"quote_preview_mismatch"
        :!candidates.length?"awaiting_parent_article"
        :matching.length===0&&candidates.some(item=>Boolean(item.id))?"different_parent_identity"
        :post.quoteOnly?"awaiting_verified_parent"
        :post.hasCapturedQuote?"awaiting_captioned_quote_parent":"unconfirmed_context";
      return {node,dialog,modal:Boolean(dialog),focused:node===document.activeElement,
        empty:!api.composerAdapter.hasContent(node),contextStatusId:statusId,
        quarantinedContextMatch,
        contextArticleCount:articles.length,contextTextPresent:Boolean(normalized(text)||routeQuoteText),
        contextTextMatches:Boolean(primary&&exactText.includes(primary)||quoteRoutePreview),
        contextMatches,contextDetail,compactEvidence,timelineEvidence};
    });
    return {now,editors,visibleDialogCount,routeAllowed:routeAllowed(initialUrl,currentUrl,post.statusId,post.modernLayout===true||post.legacyDetailIdentity===true),
      sourceUnchanged};
  }
  globalThis.ZaneReplyCopilotContent.composerAssociation={create,baseline,snapshot,capturePost,captureTimelinePreview};
})();
